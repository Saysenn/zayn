import { memo, useEffect, useState } from 'react';
import { useLogs, useClearLogs } from '../hooks/useLogs';
import { useSettings } from '../hooks/useSettings';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { bulkMessage, patchRows } from '../hooks/useBulkActions';
import { apiService } from '../configs/api.config';
import { saveBlob } from '../helpers/api.helper';
import Modal from '../components/modals/Modal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { confirm } from '../configs/confirms.config';
import Button from '../components/buttons/Button';
import PageHeader from '../components/layout/PageHeader';
import Pagination from '../components/layout/Pagination';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import { TableSkeleton } from '../components/display/Skeleton';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import { DownloadIcon, LogsIcon, TrashIcon } from '../components/icons';

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

const LogRow = memo(function LogRow({ log, onSelect, checked, onToggle }) {
  return (
    <tr
      className={`hover:bg-surface-sunken cursor-pointer ${checked ? 'row-selected' : ''}`}
      tabIndex={0}
      role="link"
      onClick={() => onSelect(log)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(log); }}
    >
      <td className="td w-8" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(log.id)} aria-label="Select log" />
      </td>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: settings } = useSettings();
  const { run } = useBulkActions();

  useEffect(() => setPage(1), [source, level]);

  const { data: logs, total, isLoading, error, refetch } = useLogs({
    source: source || undefined,
    level: level || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // Ticks are for the rows on screen: a page turn or a filter drops them.
  const sel = useRowSelection((logs ?? []).map((l) => l.id));

  const devMode = settings?.devMode ?? false;
  const filtered = Boolean(source || level);

  // Gone from the list the moment you confirm; back if the server refuses.
  function deleteSelected() {
    const ids = sel.ids;
    run({
      call: () => apiService.logs.deleteIds(ids),
      invalidates: [['logs']],
      optimistic: (qc) => patchRows(qc, [['logs']], ids, () => null),
      toast: bulkMessage('deleted', ids.length, 'log'),
      report: (data) => bulkMessage('deleted', data?.deleted ?? ids.length, 'log'),
      icon: 'trash',
      failure: `Couldn't delete ${ids.length} ${ids.length === 1 ? 'log' : 'logs'}`,
    });
    sel.clear();
    setConfirmDelete(false);
  }

  // The ticked rows as they are, for pasting into a bug report. Client
  // side: the page already holds every field the server sent.
  async function exportSelected() {
    const rows = (logs ?? []).filter((l) => sel.has(l.id));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const saved = await saveBlob(blob, `logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
    if (saved !== false) sel.clear();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logs"
        subtitle={total ? `${total} ${total === 1 ? 'log' : 'logs'}` : undefined}
        actions={devMode && (
          <Button variant="danger" onClick={() => setClearing(true)}>
            <TrashIcon width={16} height={16} />
            Clear logs
          </Button>
        )}
      />

      <div className="flex gap-2 items-center flex-wrap">
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
        <span className="text-text-faint text-xs">
          {devMode ? 'Recording: developer mode is on' : 'Only captured while developer mode is on'}
        </span>
      </div>

      <ErrorState error={error} title="Couldn't load logs" onRetry={refetch} />

      {/* Three different empties, because they mean three different things:
          a filter matched nothing, nothing has been recorded yet, or
          nothing CAN be recorded because developer mode is off. */}
      {!error && !isLoading && logs && logs.length === 0 && (
        <EmptyState
          icon={LogsIcon}
          title={filtered ? 'No logs match these filters' : 'No logs recorded yet'}
          hint={filtered
            ? 'Try All sources or All levels.'
            : devMode
              ? 'Errors will appear here as they happen.'
              : 'Turn on developer mode in Settings to start capturing them.'}
        />
      )}

      {(isLoading || (logs && logs.length > 0)) && (
        <div className="table-wrap">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th w-8"><SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} /></th>
                <th className="th">Time</th>
                <th className="th">Level</th>
                <th className="th">Source</th>
                <th className="th">Message</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <TableSkeleton columns={5} />
                : logs.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    onSelect={setSelected}
                    checked={sel.has(log.id)}
                    onToggle={sel.toggle}
                  />
                ))}
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
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${sel.count} ${sel.count === 1 ? 'log' : 'logs'}?`}
          detail="Only the ticked logs go. Every other log, and everything else in the CRM, is untouched."
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={deleteSelected}
        />
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={DownloadIcon} onClick={exportSelected}>Export JSON</BulkAction>
        <BulkAction icon={TrashIcon} variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </BulkAction>
      </BulkBar>
    </div>
  );
}
