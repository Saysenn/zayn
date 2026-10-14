const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const video = require('./videoTranscript.helper');

/**
 * A VIDEO BECOMES ITS TRANSCRIPT, AND IS NEVER KEPT (his call 2026-10-14).
 * The real ffmpeg on a real (made up) video; the transcription, the summary
 * and the save are stand-ins, so no money and no database.
 */

const ffmpeg = require('ffmpeg-static');
const make = (out, args) => new Promise((resolve, reject) => {
  execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], (err) => (err ? reject(err) : resolve(out)));
});

let dir;
const saved = [];
test.before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-test-'));
  video.deps.canTranscribe = () => true;
  video.deps.transcribe = async () => 'We agreed to send the creditors list by Friday.';
  video.deps.summarise = async () => ({ summary: 'A call about the creditors list.', keyPoints: ['Creditors list due Friday'] });
  video.deps.storeDoc = async (liquidationId, file) => { saved.push({ liquidationId, ...file }); return { id: 99, file_name: file.originalName }; };
  video.deps.changed = () => {};
});
test.after(() => fs.rm(dir, { recursive: true, force: true }));

test('A VIDEO WITH SPEECH becomes one .txt, and the video and its sound are gone', async () => {
  const clip = await make(path.join(dir, 'site call.mp4'), [
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest',
  ]);
  const job = video.start(7, { videoPath: clip, fileName: 'site call.mp4' });
  await job.done;
  assert.equal(job.status, 'done', job.error);
  assert.equal(saved.at(-1).originalName, 'site call (transcript).txt');
  const text = saved.at(-1).buffer.toString('utf8');
  assert.match(text, /^Transcript of site call\.mp4/);
  assert.match(text, /SUMMARY\nA call about the creditors list\./);
  assert.match(text, /- Creditors list due Friday/);
  assert.match(text, /FULL TRANSCRIPT\nWe agreed to send the creditors list by Friday\./);
  assert.ok(job.durationSec > 2 && job.durationSec < 4, `duration ${job.durationSec}`);
  await assert.rejects(fs.stat(clip), 'the video is not kept');
  await assert.rejects(fs.stat(path.join(video.TEMP_ROOT, job.id)), 'its sound is not kept');
  assert.equal(video.forCompany(7).at(-1).docId, 99);
});

test('A VIDEO WITH NO SOUND fails plainly, nothing saved, nothing kept', async () => {
  const before = saved.length;
  const clip = await make(path.join(dir, 'silent.mp4'), ['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=1']);
  const job = video.start(7, { videoPath: clip, fileName: 'silent.mp4' });
  await job.done;
  assert.equal(job.status, 'failed');
  assert.match(job.error, /no sound/i);
  assert.equal(saved.length, before);
  await assert.rejects(fs.stat(clip));
});

test('A FILE THAT IS NOT REALLY A VIDEO fails plainly, and is removed', async () => {
  const fake = path.join(dir, 'broken.mov');
  await fs.writeFile(fake, 'not a video');
  const job = video.start(7, { videoPath: fake, fileName: 'broken.mov' });
  await job.done;
  assert.equal(job.status, 'failed');
  assert.match(job.error, /could not be read|no sound/i);
  await assert.rejects(fs.stat(fake));
});

test('CANCEL MID-WAY: nothing saved, nothing kept, said as cancelled', async () => {
  const before = saved.length;
  const was = video.deps.transcribe;
  let release;
  video.deps.transcribe = () => new Promise((r) => { release = () => r('words'); });
  const clip = await make(path.join(dir, 'to cancel.mp4'), [
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest',
  ]);
  const job = video.start(7, { videoPath: clip, fileName: 'to cancel.mp4' });
  while (job.stage !== 'transcribing') await new Promise((r) => setTimeout(r, 20)); // eslint-disable-line no-await-in-loop
  assert.ok(video.cancel(7, job.id));
  assert.equal(video.cancel(8, job.id), null, 'another company cannot cancel it');
  release();
  await job.done;
  video.deps.transcribe = was;
  assert.equal(job.status, 'cancelled');
  assert.equal(job.error, null);
  assert.equal(saved.length, before);
  await assert.rejects(fs.stat(clip));
  await assert.rejects(fs.stat(path.join(video.TEMP_ROOT, job.id)));
});

test('NO TRANSCRIPTION SET UP: said at once, the video removed', async () => {
  const was = video.deps.canTranscribe;
  video.deps.canTranscribe = () => false;
  const fake = path.join(dir, 'x.mp4');
  await fs.writeFile(fake, 'x');
  const job = video.start(7, { videoPath: fake, fileName: 'x.mp4' });
  video.deps.canTranscribe = was;
  assert.equal(job.status, 'failed');
  assert.match(job.error, /not set up/);
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(fs.stat(fake));
});

test('A VIDEO SENT FROM HER CHAT is followed by the chat, with its company; a page one is not', async () => {
  const fromChat = path.join(dir, 'chat.mp4');
  const fromPage = path.join(dir, 'page.mp4');
  await fs.writeFile(fromChat, 'x');
  await fs.writeFile(fromPage, 'x');
  const was = video.deps.canTranscribe;
  video.deps.canTranscribe = () => false; // ends at once: only the listing is under test
  const a = video.start(9, { videoPath: fromChat, fileName: 'chat.mp4', names: ['Quarry Lane Ltd'], origin: 'chat' });
  const b = video.start(9, { videoPath: fromPage, fileName: 'page.mp4', names: ['Quarry Lane Ltd'] });
  video.deps.canTranscribe = was;
  const listed = video.fromChat().map((j) => j.id);
  assert.ok(listed.includes(a.id));
  assert.ok(!listed.includes(b.id));
  assert.equal(video.view(a).company, 'Quarry Lane Ltd');
});

test('THE TRANSCRIPT MARKS EACH PART\'S TIME, in order', () => {
  const t = video.transcriptText({ fileName: 'long.mp4', durationSec: 1250, takenOn: '14 October 2026', summary: null, parts: ['one', 'two', ''] });
  assert.ok(t.indexOf('[0:00]\none') < t.indexOf('[10:00]\ntwo'));
  assert.match(t, /\[20:00\]\n\(no speech in this part\)/);
  assert.match(t, /Length: 20:50/);
  assert.equal(video.isVideo('a.MKV'), true);
  assert.equal(video.isVideo('a.pdf', 'application/pdf'), false);
});
