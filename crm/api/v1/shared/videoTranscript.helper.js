const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// ***************************************************
// * A VIDEO BECOMES ITS TRANSCRIPT (his call 2026-10-14)
// ***************************************************
//
// A call recording, a site walk-round, a voice note filmed on a phone: the
// words are what the Liquidations page needs, not the video. So a video is
// never kept. Its sound is taken out (ffmpeg), heard in parts (the same
// transcription as Diane's microphone), summed up by her model, and saved
// as one .txt on the company. That .txt is an ordinary document: listed,
// opened in the viewer, read and searched by Diane like any other.
//
// THE WORK RUNS AFTER THE UPLOAD ANSWERS, so a long video never times out a
// request. The page asks for the job every two seconds and shows its stage,
// its part and a timer. Jobs live in memory: a server restart forgets them,
// and the temp files go with the next start (sweepTemp).
//
// Only the sound is understood. What is on screen is not read (agreed).

const VIDEO = /\.(mp4|m4v|mov|mkv|avi|webm|wmv|flv|mpeg|mpg|3gp|ts|mts|m2ts|ogv)$/i;
const isVideo = (name, mime = '') => VIDEO.test(String(name)) || /^video\//i.test(String(mime));
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

// TEN MINUTES A PART: well under the transcription's 25 MB and its length
// limit, at 32 kbps mono (about 2.4 MB a part).
const PART_SECONDS = 600;
// Before the first part is heard there is nothing measured: a guess.
const GUESS_SECONDS_PER_PART = 25;
const SUMMARY_SECONDS = 10;
// A finished or failed job stays listed this long, so a reopened modal shows it.
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const TEMP_ROOT = path.join(os.tmpdir(), 'zayn-video');

const STAGES = ['uploading', 'extracting', 'transcribing', 'summarising', 'saved'];

/** What the work calls, replaceable in tests. */
const deps = {
  ffmpegPath: () => require('ffmpeg-static'), // eslint-disable-line global-require
  transcribe: (buffer, name, hint) => require('../agent/transcribe').transcribeAudio(buffer, name, { prompt: hint }), // eslint-disable-line global-require
  canTranscribe: () => require('../agent/transcribe').isConfigured(), // eslint-disable-line global-require
  summarise: (text, fileName, names) => summarise(text, fileName, names),
  storeDoc: (...a) => require('./liquidationDocs.helper').storeDoc(...a), // eslint-disable-line global-require
  changed: (liquidationId) => require('../sockets/index').broadcast(null, 'liquidations:changed', { id: liquidationId }), // eslint-disable-line global-require
  now: () => Date.now(),
};

const jobs = new Map();

/** The public view of a job: what the page shows. */
function view(job) {
  const elapsed = Math.round(((job.endedAt ?? deps.now()) - job.startedAt) / 1000);
  return {
    id: job.id,
    liquidationId: job.liquidationId,
    fileName: job.fileName,
    status: job.status,
    stage: job.stage,
    part: job.part,
    parts: job.parts,
    durationSec: job.durationSec,
    elapsedSec: elapsed,
    leftSec: job.status === 'working' ? secondsLeft(job) : 0,
    error: job.error,
    docId: job.docId,
    docName: job.docName,
    // Which company, by name, and where it was started (the page, or her chat).
    company: job.names?.[0] ?? null,
    origin: job.origin,
  };
}

/** A rough "about X left": measured per part once one is heard. */
function secondsLeft(job) {
  if (job.stage === 'extracting') {
    const parts = job.parts || Math.max(1, Math.ceil((job.durationSec || PART_SECONDS) / PART_SECONDS));
    return 5 + parts * GUESS_SECONDS_PER_PART + SUMMARY_SECONDS;
  }
  if (job.stage === 'transcribing') {
    const each = job.partTimes.length
      ? job.partTimes.reduce((a, b) => a + b, 0) / job.partTimes.length
      : GUESS_SECONDS_PER_PART;
    return Math.round((job.parts - job.partTimes.length) * each + SUMMARY_SECONDS);
  }
  if (job.stage === 'summarising') return SUMMARY_SECONDS;
  return 0;
}

/** "00:01:23.45" from ffmpeg's banner, in seconds. */
function durationOf(stderr) {
  const m = String(stderr).match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** "1:02:03" or "4:05". */
function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** The video's sound, as mono parts of PART_SECONDS, in order. */
function extractParts(job, videoPath, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(deps.ffmpegPath(), [
      '-hide_banner', '-nostdin', '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(PART_SECONDS), '-reset_timestamps', '1',
      path.join(outDir, 'part%03d.mp3'),
    ]);
    job.child = child;
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      if (job.durationSec == null) {
        job.durationSec = durationOf(stderr);
        if (job.durationSec) job.parts = Math.max(1, Math.ceil(job.durationSec / PART_SECONDS));
      }
    });
    child.on('error', reject);
    child.on('close', async (code) => {
      job.child = null;
      if (job.cancelled) return reject(new Cancelled());
      if (code !== 0) {
        const noSound = /does not contain any stream|Output file .* does not contain|matches no streams/i.test(stderr);
        return reject(new Error(noSound ? 'This video has no sound to transcribe.' : 'This video could not be read. Try saving it as MP4 and uploading again.'));
      }
      const names = (await fs.readdir(outDir)).filter((f) => /^part\d+\.mp3$/.test(f)).sort();
      if (!names.length) return reject(new Error('This video has no sound to transcribe.'));
      return resolve(names.map((n) => path.join(outDir, n)));
    });
  });
}

class Cancelled extends Error {}

/** A short summary and key points, by her model. Never invents: the words only. */
async function summarise(text, fileName, names = []) {
  // eslint-disable-next-line global-require
  const { getClient } = require('../agent/chatClient');
  const client = getClient();
  if (!client) return null;
  const r = await client.chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4.1',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: 'Below is the transcript of a video kept on a company in liquidation (UK business admin). '
        + 'Reply as JSON: {"summary": "3 to 5 plain sentences", "keyPoints": ["…"]}. Key points are who spoke or was named, '
        + 'dates, amounts, reference numbers, and actions agreed or asked for. Only what the transcript says: never guess, '
        + 'never add. UK English.'
        + (names.length ? ` Names on this company's file, for spelling only: ${names.join('; ')}. Where the transcript plainly mishears one of them, write it correctly; never add one that was not said.` : '')
        + '\n\n'
        + `Video: ${fileName}\n\n${text.slice(0, 120_000)}`,
    }],
  });
  const got = JSON.parse(String(r.choices?.[0]?.message?.content ?? '{}'));
  return {
    summary: String(got.summary ?? '').trim(),
    keyPoints: (Array.isArray(got.keyPoints) ? got.keyPoints : []).map((p) => String(p).trim()).filter(Boolean),
  };
}

/** The .txt that is kept. */
function transcriptText({ fileName, durationSec, takenOn, summary, parts }) {
  const lines = [
    `Transcript of ${fileName}`,
    `Length: ${durationSec ? clock(durationSec) : 'unknown'} · Transcribed: ${takenOn}`,
    'The video itself was not kept. Only its sound was transcribed: what was on screen is not in this text.',
    '',
  ];
  if (summary?.summary) lines.push('SUMMARY', summary.summary, '');
  if (summary?.keyPoints?.length) lines.push('KEY POINTS', ...summary.keyPoints.map((p) => `- ${p}`), '');
  lines.push('FULL TRANSCRIPT');
  parts.forEach((t, i) => {
    if (parts.length > 1) lines.push('', `[${clock(i * PART_SECONDS)}]`);
    lines.push(t || '(no speech in this part)');
  });
  return `${lines.join('\n').trim()}\n`;
}

/** The transcription's hint: the names to expect, in a sentence. */
const hintOf = (names) => (names?.length ? `UK business call. Names that may be said: ${names.join(', ')}.` : null);

const transcriptName = (fileName) => `${path.basename(fileName).replace(/\.[^.]+$/, '').slice(0, 170)} (transcript).txt`;

async function run(job, videoPath, byUser) {
  const outDir = path.join(TEMP_ROOT, job.id);
  try {
    await fs.mkdir(outDir, { recursive: true });
    job.stage = 'extracting';
    const files = await extractParts(job, videoPath, outDir);
    job.parts = files.length;
    // The video is not needed past here: gone at once, not at the end.
    await fs.rm(videoPath, { force: true });

    job.stage = 'transcribing';
    const heard = [];
    for (const [i, f] of files.entries()) {
      if (job.cancelled) throw new Cancelled();
      job.part = i + 1;
      const t0 = deps.now();
      // eslint-disable-next-line no-await-in-loop
      heard.push(String(await deps.transcribe(await fs.readFile(f), path.basename(f), hintOf(job.names)) ?? '').trim());
      job.partTimes.push((deps.now() - t0) / 1000);
    }
    if (job.cancelled) throw new Cancelled();
    if (!heard.some(Boolean)) throw new Error('No speech was heard in this video, so there was nothing to transcribe.');

    job.stage = 'summarising';
    const summary = await deps.summarise(heard.join('\n\n'), job.fileName, job.names).catch(() => null);
    if (job.cancelled) throw new Cancelled();

    const text = transcriptText({
      fileName: job.fileName,
      durationSec: job.durationSec,
      takenOn: new Date(deps.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      summary,
      parts: heard,
    });
    const doc = await deps.storeDoc(job.liquidationId, {
      buffer: Buffer.from(text, 'utf8'), originalName: transcriptName(job.fileName), mime: 'text/plain',
    }, byUser);
    job.docId = doc.id;
    job.docName = doc.file_name;
    job.stage = 'saved';
    job.status = 'done';
    deps.changed(job.liquidationId);
  } catch (err) {
    job.status = err instanceof Cancelled || job.cancelled ? 'cancelled' : 'failed';
    job.error = job.status === 'cancelled' ? null : (err.status === 503 ? 'Transcription is not set up on this computer.' : err.message);
  } finally {
    job.endedAt = deps.now();
    job.child = null;
    // NEVER KEPT: the video and its sound, whatever happened.
    await fs.rm(videoPath, { force: true }).catch(() => null);
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => null);
  }
}

/**
 * Starts the work on an uploaded video already on disk at `videoPath` (a
 * temp file this module now owns and removes). Answers at once.
 */
function start(liquidationId, { videoPath, fileName, names = [], origin = 'page' }, byUser = null) {
  forgetOld();
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    liquidationId: Number(liquidationId),
    fileName: path.basename(String(fileName)).slice(0, 200),
    // The company's own names (company, liquidator), so they are heard right.
    names: names.map((n) => String(n ?? '').trim()).filter(Boolean).slice(0, 10),
    origin: origin === 'chat' ? 'chat' : 'page',
    status: 'working',
    stage: 'extracting',
    part: 0,
    parts: 0,
    partTimes: [],
    durationSec: null,
    startedAt: deps.now(),
    endedAt: null,
    error: null,
    docId: null,
    docName: null,
    cancelled: false,
    child: null,
  };
  jobs.set(job.id, job);
  if (!deps.canTranscribe()) {
    job.status = 'failed';
    job.error = 'Transcription is not set up on this computer.';
    job.endedAt = deps.now();
    fs.rm(videoPath, { force: true }).catch(() => null);
  } else {
    job.done = run(job, videoPath, byUser);
  }
  return job;
}

/** Stops a job; its temp files go as it ends. */
function cancel(liquidationId, jobId) {
  const job = jobs.get(jobId);
  if (!job || job.liquidationId !== Number(liquidationId)) return null;
  if (job.status === 'working') {
    job.cancelled = true;
    job.child?.kill('SIGKILL');
  }
  return job;
}

/** One company's jobs, working first, then the recent finished ones. */
/** Every company's, started from her chat: what the chat's cards follow. */
function fromChat() {
  forgetOld();
  return [...jobs.values()].filter((j) => j.origin === 'chat').sort((a, b) => a.startedAt - b.startedAt).map(view);
}

function forCompany(liquidationId) {
  forgetOld();
  return [...jobs.values()]
    .filter((j) => j.liquidationId === Number(liquidationId))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(view);
}

function forgetOld() {
  const cut = deps.now() - KEEP_FINISHED_MS;
  for (const [k, j] of jobs) if (j.status !== 'working' && j.endedAt < cut) jobs.delete(k);
}

/**
 * Left from a run the server never finished (a restart): cleared on start.
 * OLD ONES ONLY: the suite starts a second API, and a fresh sweep would take
 * the files of a video the first is still working on.
 */
async function sweepTemp(olderThanMs = 6 * 60 * 60 * 1000) {
  const cut = deps.now() - olderThanMs;
  const walk = async (dir) => {
    const names = await fs.readdir(dir).catch(() => []);
    await Promise.all(names.map(async (n) => {
      const full = path.join(dir, n);
      const st = await fs.stat(full).catch(() => null);
      if (!st) return;
      if (st.isDirectory()) {
        await walk(full);
        if (st.mtimeMs < cut && n !== 'uploads') await fs.rm(full, { recursive: true, force: true }).catch(() => null);
      } else if (st.mtimeMs < cut) {
        await fs.rm(full, { force: true }).catch(() => null);
      }
    }));
  };
  await walk(TEMP_ROOT);
}

module.exports = {
  VIDEO, MAX_VIDEO_BYTES, PART_SECONDS, STAGES, TEMP_ROOT,
  isVideo, start, cancel, forCompany, fromChat, view, sweepTemp,
  transcriptText, transcriptName, durationOf, clock, deps, jobs,
};
