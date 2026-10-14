// ***************************************************
// * A VIDEO BECOMING ITS TRANSCRIPT, as the card shows it (2026-10-14)
// ***************************************************
//
// Plain functions, so the bar, the step and the timer are tested without a
// browser. The server says the stage, the part and the seconds; the card
// ticks the clock between its answers.

export const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|avi|webm|wmv|flv|mpeg|mpg|3gp|ts|mts|m2ts|ogv)$/i;
export const isVideoFile = (file) => VIDEO_EXT.test(file?.name ?? '') || /^video\//i.test(file?.type ?? '');
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export const STEPS = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'extracting', label: 'Extracting sound' },
  { key: 'transcribing', label: 'Transcribing' },
  { key: 'summarising', label: 'Writing summary' },
  { key: 'saved', label: 'Saved' },
];
export const stepIndex = (stage) => Math.max(0, STEPS.findIndex((s) => s.key === stage));

/**
 * The whole job as one bar, 0 to 100. Upload is the first fifth, hearing
 * the parts most of the rest: that is where the time goes.
 */
export function overallPct({ stage, uploadPct = 0, part = 0, parts = 0 }) {
  switch (stage) {
    case 'uploading': return Math.round(Math.min(100, Math.max(0, uploadPct)) * 0.2);
    case 'extracting': return 25;
    case 'transcribing': return Math.round(30 + (parts ? (Math.max(0, part - 1) / parts) : 0) * 60);
    case 'summarising': return 93;
    case 'saved': return 100;
    default: return 0;
  }
}

/** The line under the name: what is happening now. */
export function stageLine({ stage, uploadPct = 0, part = 0, parts = 0 }) {
  switch (stage) {
    case 'uploading': return `Uploading ${Math.round(uploadPct)}%`;
    case 'extracting': return 'Extracting the sound…';
    case 'transcribing': return parts > 1 ? `Transcribing part ${part || 1} of ${parts}…` : 'Transcribing…';
    case 'summarising': return 'Writing the summary…';
    case 'saved': return 'Transcript saved';
    default: return '';
  }
}

/** 0:42, 12:05, 1:02:03. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "about 3 min left", never a false precision. Null when it cannot say. */
export function leftWords(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  if (seconds <= 5) return 'almost done';
  if (seconds < 60) return 'under a minute left';
  const min = Math.round(seconds / 60);
  return `about ${min} min left`;
}

/** Seconds left to upload, from the rate so far. Null until there is a rate. */
export function uploadLeft(uploadPct, elapsedSec) {
  if (!uploadPct || uploadPct >= 100 || elapsedSec < 1) return null;
  return (elapsedSec / uploadPct) * (100 - uploadPct);
}
