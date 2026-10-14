import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { VideoIcon, CheckCircleIcon, WarningIcon } from '../icons';
import { DocNameLink } from './forms/FileChip';
import { stepIndex, STEPS, overallPct, stageLine, clock, leftWords } from '../liquidations/videoProgress';

/**
 * A VIDEO SENT TO A COMPANY FROM HER CHAT (his call 2026-10-14), followed
 * here until its transcript is saved: the steps, one bar, a running clock,
 * Cancel, then the .txt to open. Her tone, so it sits in V1 and V2 alike.
 * The same job as the Liquidations page's card (videoTranscript.helper).
 *
 * `nudge` changes with every turn, so a job she has just started is asked
 * for at once rather than on the next tick.
 */
const KEY = ['diane-video-jobs'];

export default function ChatVideoJobs({ nudge }) {
  const { data, dataUpdatedAt, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => apiService.liquidations.chatVideoJobs(),
    refetchInterval: (q) => ((q.state.data?.jobs ?? []).some((j) => j.status === 'working') ? 2000 : false),
  });
  useEffect(() => { refetch(); }, [nudge, refetch]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [cancelling, setCancelling] = useState(() => new Set());
  const jobs = (data?.jobs ?? []).filter((j) => !dismissed.has(j.id));
  const working = jobs.some((j) => j.status === 'working');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  if (!jobs.length) return null;
  const cancel = (j) => {
    setCancelling((s) => new Set(s).add(j.id));
    apiService.liquidations.cancelVideoJob(j.liquidationId, j.id).catch(() => null).finally(() => refetch());
  };

  return (
    <ul className="mb-2 space-y-1.5" aria-label="Videos being transcribed">
      {jobs.map((j) => {
        const since = j.status === 'working' ? Math.max(0, (now - (dataUpdatedAt || now)) / 1000) : 0;
        const left = j.status === 'working' && j.leftSec != null ? Math.max(0, j.leftSec - since) : null;
        const at = stepIndex(j.stage);
        const stopping = cancelling.has(j.id) && j.status === 'working';
        return (
          <li key={j.id} className="rounded-md border border-diane-line/40 bg-diane-panel/70 px-3 py-2 text-[11px] text-white/85">
            <div className="flex items-center gap-2">
              <span className={j.status === 'done' ? 'text-diane-signal' : j.status === 'failed' ? 'text-diane-alert' : 'text-diane-signal/80'}>
                {j.status === 'done' ? <CheckCircleIcon width={14} height={14} /> : j.status === 'failed' ? <WarningIcon width={14} height={14} /> : <VideoIcon width={14} height={14} />}
              </span>
              <span className="min-w-0 flex-1 truncate" title={`${j.fileName} → ${j.company ?? ''}`}>
                {j.fileName}<span className="text-white/40"> → {j.company}</span>
              </span>
              {j.status === 'working' && <span className="tabular-nums text-white/50">{clock((j.elapsedSec ?? 0) + since)}</span>}
              {j.status === 'working' && (
                <button
                  type="button"
                  disabled={stopping}
                  onClick={() => cancel(j)}
                  className="min-h-0 rounded border border-diane-line/50 bg-transparent px-2 py-0.5 text-[10px] text-diane-dim hover:border-diane-alert/70 hover:text-diane-alert disabled:opacity-50"
                >
                  {stopping ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
              {j.status !== 'working' && (
                <button
                  type="button"
                  onClick={() => setDismissed((s) => new Set(s).add(j.id))}
                  aria-label={`Dismiss ${j.fileName}`}
                  className="min-h-0 border-0 bg-transparent p-0 text-white/40 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
            {j.status === 'working' ? (
              <>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallPct(j)} aria-label={`${j.fileName} progress`}>
                  <div className="h-full rounded-full bg-diane-signal transition-[width] duration-500" style={{ width: `${Math.max(4, overallPct(j))}%` }} />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[10px]">
                  <span className="text-diane-dim">
                    {stopping ? 'Cancelling…' : stageLine(j)}
                    <span className="ml-2 text-white/35">
                      {STEPS.slice(1, -1).map((s, i) => (i + 1 < at ? '✓' : i + 1 === at ? '●' : '○')).join(' ')}
                    </span>
                  </span>
                  {leftWords(left) && <span className="text-white/45">{leftWords(left)}</span>}
                </div>
              </>
            ) : (
              <p className={`mt-1 ${j.status === 'failed' ? 'text-diane-alert' : j.status === 'cancelled' ? 'text-white/50' : 'text-diane-dim'}`}>
                {j.status === 'failed' ? (j.error || 'It could not be transcribed.')
                  : j.status === 'cancelled' ? 'Cancelled. Nothing was saved.'
                    : (
                      <>
                        Transcript saved to {j.company}:{' '}
                        <DocNameLink file={{
                          liquidationId: j.liquidationId,
                          docId: j.docId,
                          name: j.docName,
                          mime: 'text/plain',
                          url: `/api/v1/liquidations/${j.liquidationId}/docs/${j.docId}`,
                        }}
                        >
                          {j.docName}
                        </DocNameLink>
                      </>
                    )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
