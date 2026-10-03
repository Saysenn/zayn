import { memo, useEffect, useState } from 'react';
import { useLogs, useClearLogs } from '../hooks/useLogs';
import { useSettings } from '../hooks/useSettings';
import Modal from '../components/modals/Modal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { confirm } from '../configs/confirms.config';
import Button from '../components/buttons/Button';
import Pagination from '../components/layout/Pagination';
import { TableSkeleton } from '../components/display/Skeleton';
import { TrashIcon } from '../components/icons';

const PAGE_SIZE = 20;

const LEVEL_CLASS = {
  error: 'badge-open',
  warn: 'badge-in_progress',
  info: 'badge-closed',
};

function LevelBadge({ level }) {
  return <span className={`badge ${LEVEL_CLASS[level] ?? 'badge-closed'}`}>{level}</span>;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const LogRow = memo(function LogRow({ log, onSelect }) {
  return (
    <tr className="hover:bg-surface-sunken cursor-pointer" onClick={() => onSelect(log)}>
      <td className="td whitespace-nowrap">{formatTime(log.created_at)}</td>
      <td className="td"><LevelBadge level={log.level} /></td>
      <td className="td capitalize">{log.source}</td>
      <td className="td max-w-md truncate">{log.message}</td>
    </tr>
  );
});

function LogDetailModal({ log, onClose }) {
  return (
    <Modal title={`${log.level.toUpperCase()} · ${log.source}`} onClose={onClose}>
      <p className="text-text-faint text-xs mb-1">{formatTime(log.created_at)}</p>
      <p className="font-semibold text-sm mb-3">{log.message}</p>
      {log.detail && (
        <div className="table-wrap">
          <pre className="bg-surface-sunken p-3 text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(log.detail, null, 2)}
          </pre>
        </div>
      )}
    </Modal>
  );
}

function ClearLogsModal({ source, level, onClose, onCleared }) {
  const { clear, isClearing, progress } = useClearLogs();
  const scope = [source && `source: ${source}`, level && `level: ${level}`].filter(Boolean).join(', ') || 'every source and level';

  async function handleConfirm() {
    await clear({ source, level });
    onCleared();
  }

  return (
    <ConfirmDialog
      {...confirm.clearLogs({ scope, progress })}
      busy={isClearing}
      onCancel={onClose}
      onConfirm={handleConfirm}
    >
      {isClearing && (
        <div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-text-faint">{progress}%</p>
        </div>
      )}
    </ConfirmDialog>
  );
}

export default function LogsPage() {
  const [source, setSource] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [clearing, setClearing] = useState(false);
  const { data: settings } = useSettings();

  useEffect(() => setPage(1), [source, level]);

  const { data: logs, total, isLoading, error } = useLogs({
    source: source || undefined,
    level: level || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const devMode = settings?.devMode ?? false;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">Logs</h1>
      </div>

      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <select className="input-inline" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="api">Diane (api)</option>
          <option value="agent">Whatbot (agent)</option>
        </select>
        <select className="input-inline" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
        </select>
        <span className="text-text-faint text-xs">Only captured while developer mode is on</span>
        {devMode && (
          <Button
            variant="danger"
            className="ml-auto inline-flex items-center gap-1.5"
            onClick={() => setClearing(true)}
          >
            <TrashIcon width={15} height={15} />
            Clear
          </Button>
        )}
      </div>

      {error && <div className="p-8 text-center text-text-muted text-sm">{error.message}</div>}

      {!isLoading && logs && logs.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          No logs recorded yet. Turn on developer mode in Settings to start capturing them.
        </div>
      )}

      {(isLoading || (logs && logs.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">Time</th>
                <th className="th">Level</th>
                <th className="th">Source</th>
                <th className="th">Message</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <TableSkeleton columns={4} />
                : logs.map((log) => <LogRow key={log.id} log={log} onSelect={setSelected} />)}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      {selected && <LogDetailModal log={selected} onClose={() => setSelected(null)} />}
      {clearing && (
        <ClearLogsModal
          source={source || undefined}
          level={level || undefined}
          onClose={() => setClearing(false)}
          onCleared={() => { setPage(1); setClearing(false); }}
        />
      )}
    </div>
  );
}
