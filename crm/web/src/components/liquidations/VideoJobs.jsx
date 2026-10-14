import { useEffect, useState } from 'react';
import Button from '../buttons/Button';
import { VideoIcon, CheckCircleIcon, WarningIcon, CloseIcon } from '../icons';
import {
  STEPS, stepIndex, overallPct, stageLine, clock, leftWords, uploadLeft,
} from './videoProgress';

/**
 * VIDEOS BECOMING TRANSCRIPTS (his call 2026-10-14): one card each, from the
 * upload to the saved .txt. The steps with ticks, one bar for the whole job,
 * a running clock and a rough "about X left", and Cancel while it works.
 *
 * `cards` are already merged by the caller: an upload still on its way
 * (stage 'uploading', its own %) or a server job (polled every 2 seconds).
 */
export default function VideoJobs({ cards, onCancel, onDismiss, onRetry, onOpen }) {
  const working = cards.some((c) => c.status === 'working');
  const now = useTick(working);
  if (!cards.length) return null;
  return (
    <ul className="space-y-2" aria-label="Videos being transcribed">
      {cards.map((c) => <VideoCard key={c.key} card={c} now={now} onCancel={onCancel} onDismiss={onDismiss} onRetry={onRetry} onOpen={onOpen} />)}
    </ul>
  );
}

/** A clock that ticks each second while anything is working. */
function useTick(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const TONE = {
  working: 'border-border bg-surface',
  done: 'border-success-strong/30 bg-success-tint',
  failed: 'border-danger/30 bg-danger-tint',
  cancelled: 'border-border bg-surface-sunken',
};

function VideoCard({ card, now, onCancel, onDismiss, onRetry, onOpen }) {
  const { status, stage } = card;
  // THE CLOCK BETWEEN ANSWERS: what the server said, plus the seconds since.
  const since = status === 'working' ? Math.max(0, (now - card.seenAt) / 1000) : 0;
  const elapsed = (card.elapsedSec ?? 0) + since;
  const left = status !== 'working' ? null
    : stage === 'uploading' ? uploadLeft(card.uploadPct, elapsed)
      : card.leftSec == null ? null : Math.max(0, card.leftSec - since);
  const pct = status === 'done' ? 100 : overallPct(card);
  const at = stepIndex(stage);

  return (
    <li className={`rounded border px-3 py-2.5 text-sm ${TONE[status] ?? TONE.working}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${status === 'done' ? 'text-success-strong' : status === 'failed' ? 'text-danger' : 'text-accent-strong'}`}>
          {status === 'done' ? <CheckCircleIcon width={18} height={18} /> : status === 'failed' ? <WarningIcon width={18} height={18} /> : <VideoIcon width={18} height={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text" title={card.fileName}>{card.fileName}</p>
          <p className={`mt-0.5 text-xs ${status === 'failed' ? 'text-danger' : status === 'done' ? 'text-success-strong' : 'text-text-muted'}`} aria-live="polite">
            {status === 'failed' ? (card.error || 'It could not be transcribed.')
              : status === 'cancelled' ? 'Cancelled. Nothing was saved.'
                : status === 'done' ? `Transcript saved as ${card.docName ?? 'a .txt'}`
                  : card.cancelling ? 'Cancelling…' : stageLine(card)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === 'working' && (
            <span className="tabular-nums text-xs text-text-muted" title="Time so far">{clock(elapsed)}</span>
          )}
          {status === 'working' && (
            <Button variant="secondary" size="sm" disabled={card.cancelling} onClick={() => onCancel(card)}>
              {card.cancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
          {status === 'done' && card.docId && <Button variant="accent" size="sm" onClick={() => onOpen(card)}>Open transcript</Button>}
          {status === 'failed' && <Button variant="secondary" size="sm" onClick={() => onRetry(card)}>Try again</Button>}
          {status !== 'working' && (
            <Button variant="quiet" size="icon" aria-label={`Dismiss ${card.fileName}`} title="Dismiss" onClick={() => onDismiss(card)}>
              <CloseIcon width={14} height={14} />
            </Button>
          )}
        </div>
      </div>

      {status === 'working' && (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${card.fileName} progress`}>
            <div className="h-full rounded-full bg-accent-strong transition-[width] duration-500 ease-out" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {STEPS.slice(0, -1).map((s, i) => (
                <li key={s.key} className={`flex items-center gap-1 ${i < at ? 'text-success-strong' : i === at ? 'font-semibold text-accent-strong' : 'text-text-faint'}`}>
                  <span aria-hidden="true">{i < at ? '✓' : i === at ? '●' : '○'}</span>
                  {s.label}
                </li>
              ))}
            </ol>
            {leftWords(left) && <span className="text-[11px] text-text-muted">{leftWords(left)}</span>}
          </div>
        </>
      )}
    </li>
  );
}
