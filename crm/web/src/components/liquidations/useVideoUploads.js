import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useNotifications } from '../../hooks/useNotifications';
import { MAX_VIDEO_BYTES } from './videoProgress';

/**
 * A COMPANY'S VIDEOS ON THEIR WAY TO BEING TRANSCRIPTS (2026-10-14).
 *
 * Two halves make one card: the upload, which only this page sees (its own
 * %, its own Cancel), and the server's job after it, asked for every two
 * seconds while one works. The job outlives the modal, so a reopened modal
 * shows it again; the upload's seconds are added to its clock while open.
 */
export function useVideoUploads(id, detailKey, docs, setViewing) {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const jobsKey = ['liquidations', id, 'video-jobs'];
  const [uploads, setUploads] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [cancelling, setCancelling] = useState(() => new Set());
  const [fresh, setFresh] = useState(null);
  const uploadSecs = useRef(new Map());
  // Finished before this modal opened: shown, never announced again.
  const announced = useRef(null);

  const { data, dataUpdatedAt } = useQuery({
    queryKey: jobsKey,
    queryFn: () => apiService.liquidations.videoJobs(id),
    refetchInterval: (q) => ((q.state.data?.jobs ?? []).some((j) => j.status === 'working') ? 2000 : false),
  });
  const jobs = data?.jobs ?? [];

  useEffect(() => {
    if (!data) return;
    if (!announced.current) {
      announced.current = new Set(jobs.filter((j) => j.status !== 'working').map((j) => j.id));
      return;
    }
    for (const j of jobs) {
      if (j.status === 'working' || announced.current.has(j.id)) continue;
      announced.current.add(j.id);
      if (j.status === 'done') {
        queryClient.invalidateQueries({ queryKey: detailKey });
        queryClient.invalidateQueries({ queryKey: ['liquidations'], exact: true });
        setFresh(j.docId);
        notify({ level: 'success', message: `Transcript saved: ${j.docName}` });
      } else if (j.status === 'failed') {
        notify({ level: 'error', message: `Couldn't transcribe ${j.fileName}`, detail: j.error });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // THE NEW TRANSCRIPT GLOWS a moment in the list, then settles.
  useEffect(() => {
    if (fresh == null) return undefined;
    const t = setTimeout(() => setFresh(null), 6000);
    return () => clearTimeout(t);
  }, [fresh]);

  const patch = (key, fields) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...fields } : x)));
  const drop = (key) => setUploads((u) => u.filter((x) => x.key !== key));

  function start(file) {
    if (file.size > MAX_VIDEO_BYTES) {
      notify({ level: 'error', message: `${file.name} is over 500 MB`, detail: 'Trim it or lower its quality, then upload it again.' });
      return;
    }
    const key = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    const startedAt = Date.now();
    setUploads((u) => [...u, { key, fileName: file.name, uploadPct: 0, startedAt, controller, status: 'working' }]);
    apiService.liquidations.addVideo(id, file, (pct) => patch(key, { uploadPct: pct }), controller.signal)
      .then((res) => {
        const job = res?.jobs?.[0];
        if (job) {
          uploadSecs.current.set(job.id, (Date.now() - startedAt) / 1000);
          queryClient.setQueryData(jobsKey, (old) => ({ jobs: [...(old?.jobs ?? []).filter((j) => j.id !== job.id), job] }));
        }
        drop(key);
        queryClient.invalidateQueries({ queryKey: jobsKey, exact: true });
      })
      .catch((err) => {
        if (err?.name === 'AbortError') { drop(key); return; }
        patch(key, { status: 'failed', error: err?.message || 'The upload failed.' });
      });
  }

  function cancel(card) {
    if (card.kind === 'upload') { card.controller?.abort(); return; }
    setCancelling((s) => new Set(s).add(card.id));
    apiService.liquidations.cancelVideoJob(id, card.id)
      .catch((err) => notify({ level: 'error', message: `Couldn't cancel ${card.fileName}`, detail: err.message }))
      .finally(() => queryClient.invalidateQueries({ queryKey: jobsKey, exact: true }));
  }

  function dismiss(card) {
    if (card.kind === 'upload') drop(card.key);
    else setDismissed((s) => new Set(s).add(card.id));
  }

  function open(card) {
    const doc = docs.find((d) => d.id === card.docId);
    setViewing(doc ?? { id: card.docId, file_name: card.docName });
  }

  const cards = [
    ...jobs.filter((j) => !dismissed.has(j.id)).map((j) => ({
      ...j,
      key: j.id,
      kind: 'job',
      cancelling: cancelling.has(j.id) && j.status === 'working',
      elapsedSec: (j.elapsedSec ?? 0) + (uploadSecs.current.get(j.id) ?? 0),
      seenAt: dataUpdatedAt || Date.now(),
    })),
    ...uploads.map((u) => ({
      key: u.key,
      kind: 'upload',
      fileName: u.fileName,
      status: u.status,
      stage: 'uploading',
      uploadPct: u.uploadPct,
      error: u.error,
      elapsedSec: 0,
      seenAt: u.startedAt,
      controller: u.controller,
    })),
  ];

  return { cards, start, cancel, dismiss, open, fresh };
}
