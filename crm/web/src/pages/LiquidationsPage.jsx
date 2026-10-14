import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import { useSocketEvent } from '../hooks/useSocket';
import { useStickyState } from '../hooks/useStickyState';
import PageHeader, { Toolbar, SearchInput } from '../components/layout/PageHeader';
import Select from '../components/forms/Select';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import { TableSkeleton } from '../components/display/Skeleton';
import { DownloadIcon, HourglassIcon, SearchIcon } from '../components/icons';
import Button from '../components/buttons/Button';
import { saveBlob } from '../helpers/api.helper';
import { useReportingMutation } from '../hooks/useReportingMutation';
import LiquidationsExportModal from '../components/export/LiquidationsExportModal';
import EditableCell from '../components/forms/EditableCell';
import { useOptimisticUpdate } from '../hooks/useOptimisticUpdate';
import TrackerRowModal from '../components/liquidations/TrackerRowModal';
import { formatMoney } from '../helpers/formatMoney';
import { LIQ_STAGES, stageOf, deadlineTone, shortDate } from '../configs/liquidationStages';

/**
 * ***************************************************
 * * THE LIQUIDATION TRACKER (his top priority, 2026-10-13)
 * ***************************************************
 *
 * One row per company being wound down, MOST URGENT FIRST: a passed
 * deadline, then the nearest. A deadline within a week is amber, a passed
 * one red. Director and mid come off the company's live deals, blank when
 * it has none. Click a row for everything else: the full contact log, the
 * documents, and every stage change with who made it.
 *
 * Its own page, beside Companies, rather than a column on it: these rows
 * carry a dozen things a company list has no room for.
 *
 * EVERY COMPANY WHOSE STATUS IS LIQUIDATION, and only those (his call
 * 2026-10-13). Nobody adds one here: setting the status on the company
 * page, or by Diane, is what puts it on this page.
 */
export const LIQ_KEY = ['liquidations'];

// Literal class names, so Tailwind's scan sees every one.
const DEADLINE_CLASS = {
  passed: 'font-semibold text-danger',
  soon: 'font-semibold text-warning',
};
const DEADLINE_LABEL = { passed: 'Passed', soon: 'Due soon' };
// What a cell offers. "Not set" is the select's own blank.
const STAGE_OPTIONS = LIQ_STAGES.map((s) => ({ value: s.value, label: s.label }));
const BLAMED_OPTIONS = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];

/** Long text in a cell: one line, cut, the whole of it on hover. */
function Clip({ children, width = 'max-w-[14rem]' }) {
  const value = children || '';
  return <span className={`block truncate ${width} ${value ? '' : 'text-text-faint'}`} title={value || undefined}>{value || '—'}</span>;
}

export default function LiquidationsPage() {
  // ALWAYS fetched on open: a company put into liquidation elsewhere is on it at once.
  const { data, isLoading, error } = useQuery({ queryKey: LIQ_KEY, queryFn: () => apiService.liquidations.list(), refetchOnMount: 'always' });
  // Another tab, Diane, or the company page moving its pay status.
  const queryClient = useQueryClient();
  // HELD WHILE A CELL IS OPEN, as the master sheet does: a refetch mid-edit
  // would put the old value back under the one being typed.
  const editingCells = useRef(0);
  const refresh = () => { if (!editingCells.current) queryClient.invalidateQueries({ queryKey: LIQ_KEY }); };
  const onEditingChange = (on) => { editingCells.current = Math.max(0, editingCells.current + (on ? 1 : -1)); };

  /**
   * CLICK A CELL, CHANGE IT (his call 2026-10-13, the master sheet's way):
   * shown at once, saved behind it, put back with a message if refused.
   * The page's list and the open panel share the key, so both move.
   */
  const cellEdit = useOptimisticUpdate({
    queryKey: LIQ_KEY,
    mutationFn: ({ id, fields }) => apiService.liquidations.update(id, fields),
    applyToCache: (old, { id, column, value }) => {
      if (Array.isArray(old?.rows)) return { ...old, rows: old.rows.map((r) => (r.id === id ? { ...r, [column]: value } : r)) };
      if (old?.row?.id === id) return { ...old, row: { ...old.row, [column]: value } };
      return old;
    },
    describe: ({ company, label }) => `${company}'s ${label}`,
  });
  const saveCell = (r, field, column, label, value) => cellEdit.mutate({
    id: r.id, fields: { [field]: value }, column, value, company: r.company_name, label,
  });
  useSocketEvent('liquidations:changed', refresh);
  useSocketEvent('companies:changed', refresh);

  const [filters, setFilters] = useStickyState('liquidations.filters', {});
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  const rows = data?.rows ?? [];
  const owners = data?.owners ?? [];
  const groups = useMemo(() => [...new Set(rows.flatMap((r) => r.groups ?? []))].sort(), [rows]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!filters.stage || (filters.stage === '__none' ? !r.stage : r.stage === filters.stage))
      && (!filters.group || (r.groups ?? []).includes(filters.group))
      && (!filters.owner || (filters.owner === '__none' ? !r.owner : r.owner === filters.owner))
      && (!q || [r.company_name, r.director, r.mid, r.liquidator].some((v) => String(v ?? '').toLowerCase().includes(q))));
  }, [rows, filters, search]);
  const passed = rows.filter((r) => deadlineTone(r.deadline, r.stage) === 'passed').length;
  const soon = rows.filter((r) => deadlineTone(r.deadline, r.stage) === 'soon').length;
  const filtersOn = Boolean(filters.stage || filters.group || filters.owner);

  // THE ROWS ON SCREEN as an Excel file, filters and search applied.
  // THE EXPORT: columns, companies and colour picked in its modal, as on Expenses.
  const [exportOpen, setExportOpen] = useState(false);
  const exportOptions = useQuery({
    queryKey: ['liquidation-export-options'], queryFn: () => apiService.liquidations.exportOptions(), enabled: exportOpen, staleTime: 60_000,
  });
  const exporter = useReportingMutation(async ({ ids, columns, palette }) => {
    const { blob, filename } = await apiService.liquidations.download(ids, { columns, palette });
    await saveBlob(blob, filename || 'liquidations.xlsx');
  }, { describe: ({ ids }) => `${ids.length} ${ids.length === 1 ? 'company' : 'companies'}`, verb: 'exported' });
  const exporting = exporter.isPending;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Liquidations"
        subtitle={[
          `${rows.length} ${rows.length === 1 ? 'company' : 'companies'}`,
          passed ? `${passed} past deadline` : null,
          soon ? `${soon} due within a week` : null,
        ].filter(Boolean).join(' · ')}
        actions={(
          <Button variant="quiet" disabled={isLoading || rows.length === 0} onClick={() => setExportOpen(true)}>
            <DownloadIcon width={15} height={15} />
            Export
          </Button>
        )}
      />

      <Toolbar
        search={(
          <SearchInput
            icon={SearchIcon}
            placeholder="Search company, people, liquidator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        filtersActive={filtersOn}
        filtersCount={[filters.stage, filters.group, filters.owner].filter(Boolean).length}
        storageKey="liquidations.panel"
        onClearFilters={() => { setFilters({}); setSearch(''); }}
        filters={(
          <>
            <Select size="sm" className="w-48" value={filters.stage ?? ''} placeholder="Any stage"
              options={[{ value: '__none', label: 'Not set' }, ...LIQ_STAGES.map((s) => ({ value: s.value, label: s.label }))]}
              onChange={(v) => setFilters((f) => ({ ...f, stage: v || undefined }))} />
            <Select size="sm" className="w-44" value={filters.group ?? ''} placeholder="All groups"
              options={groups.map((g) => ({ value: g, label: g }))}
              onChange={(v) => setFilters((f) => ({ ...f, group: v || undefined }))} />
            <Select size="sm" className="w-44" value={filters.owner ?? ''} placeholder="Any owner"
              options={[{ value: '__none', label: 'No owner' }, ...owners.map((o) => ({ value: o, label: o }))]}
              onChange={(v) => setFilters((f) => ({ ...f, owner: v || undefined }))} />
          </>
        )}
      />

      <ErrorState error={error} title="Couldn't load the liquidation tracker" />

      <div className="table-wrap">
        <table className="w-full min-w-[1700px] text-sm">
          <thead>
            <tr>
              {/* Pinned, so a row scrolled sideways still says whose it is. */}
              <th className="th sticky left-0 z-30">Company</th>
              <th className="th">Director</th>
              <th className="th">Mid</th>
              <th className="th">Group</th>
              <th className="th">Status</th>
              <th className="th">Current instructions</th>
              <th className="th">Deadline</th>
              <th className="th">Next action</th>
              <th className="th">Owner</th>
              <th className="th">Supporting docs</th>
              <th className="th">Blamed?</th>
              <th className="th">Liquidator</th>
              <th className="th">Last comm</th>
              <th className="th">Note</th>
              <th className="th text-right">Settlement</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} columns={15} />}
            {!isLoading && shown.length === 0 && (
              <EmptyState
                asRow
                colSpan={15}
                icon={HourglassIcon}
                title={rows.length ? 'No companies match' : 'No companies in liquidation'}
                hint={rows.length ? 'Try another search or clear the filters.' : "Set a company's status to Liquidation on its page and it shows here."}
              />
            )}
            {!isLoading && shown.map((r) => {
              const stage = stageOf(r.stage);
              const tone = deadlineTone(r.deadline, r.stage);
              return (
                <tr key={r.id} className="group cursor-pointer hover:bg-surface-sunken" onClick={() => setOpenId(r.id)}>
                  <td className="td sticky left-0 z-10 bg-surface group-hover:bg-surface-sunken">
                    <button type="button" className="min-h-0 border-0 bg-transparent p-0 font-semibold text-text hover:text-accent-strong"
                      onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>
                      {r.company_name}
                    </button>
                  </td>
                  <td className="td"><Clip width="max-w-[10rem]">{r.director}</Clip></td>
                  <td className="td"><Clip width="max-w-[10rem]">{r.mid}</Clip></td>
                  <td className="td">{(r.groups ?? []).join(', ') || <span className="text-text-faint">—</span>}</td>
                  <EditableCell type="select" options={STAGE_OPTIONS} value={r.stage ?? ''} onEditingChange={onEditingChange}
                    display={<span className={stage.badge}>{stage.label}</span>}
                    onSave={(v) => saveCell(r, 'stage', 'stage', 'stage', v || null)} />
                  <EditableCell className="max-w-[16rem]" value={r.instructions ?? ''} onEditingChange={onEditingChange}
                    onSave={(v) => saveCell(r, 'instructions', 'instructions', 'instructions', v ?? '')} />
                  <EditableCell type="date" value={r.deadline} onEditingChange={onEditingChange}
                    display={(
                      <span className="whitespace-nowrap">
                        <span className={`tabular-nums ${DEADLINE_CLASS[tone] ?? (r.deadline ? '' : 'text-text-faint')}`}>{shortDate(r.deadline)}</span>
                        {tone && <span className={`ml-2 text-xs ${DEADLINE_CLASS[tone]}`}>{DEADLINE_LABEL[tone]}</span>}
                      </span>
                    )}
                    onSave={(v) => saveCell(r, 'deadline', 'deadline', 'deadline', v || null)} />
                  <EditableCell className="max-w-[16rem]" value={r.next_action ?? ''} onEditingChange={onEditingChange}
                    onSave={(v) => saveCell(r, 'nextAction', 'next_action', 'next action', v ?? '')} />
                  <EditableCell type="select" options={owners} value={r.owner ?? ''} onEditingChange={onEditingChange}
                    onSave={(v) => saveCell(r, 'owner', 'owner', 'owner', v || null)} />
                  <td className="td tabular-nums">{r.doc_count ? `${r.doc_count} ${r.doc_count === 1 ? 'file' : 'files'}` : <span className="text-text-faint">—</span>}</td>
                  <EditableCell type="select" clearable={false} options={BLAMED_OPTIONS} value={r.blamed ? 'yes' : 'no'} onEditingChange={onEditingChange}
                    display={r.blamed ? <span className="badge badge-open">Yes</span> : <span className="text-text-muted">No</span>}
                    onSave={(v) => saveCell(r, 'blamed', 'blamed', 'blamed', v === 'yes')} />
                  <EditableCell className="max-w-[12rem]" value={r.liquidator ?? ''} onEditingChange={onEditingChange}
                    onSave={(v) => saveCell(r, 'liquidator', 'liquidator', 'liquidator', v ?? '')} />
                  <td className="td">
                    {r.last_comm
                      ? <Clip><span className="tabular-nums text-text-muted">{shortDate(r.last_comm.said_on)}</span> · {r.last_comm.body}</Clip>
                      : <span className="text-text-faint">—</span>}
                  </td>
                  <EditableCell className="max-w-[16rem]" value={r.note ?? ''} onEditingChange={onEditingChange}
                    onSave={(v) => saveCell(r, 'note', 'note', 'note', v ?? '')} />
                  <td className="td text-right tabular-nums">
                    {r.settlement != null
                      ? <span title="Settlement · allocated to the live deals a month">{formatMoney(r.settlement, r.currency)} <span className="text-text-muted">· {formatMoney(r.allocated ?? 0, r.currency)}</span></span>
                      : <span className="text-text-faint">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {exportOpen && (
        <LiquidationsExportModal
          options={exportOptions.data}
          loading={exportOptions.isLoading}
          busy={exporting}
          shownCount={shown.length}
          totalCount={rows.length}
          onClose={() => setExportOpen(false)}
          onExport={({ columns, palette, onlyShown }) => exporter.mutate(
            { ids: (onlyShown ? shown : rows).map((r) => r.id), columns, palette },
            { onSuccess: () => setExportOpen(false) },
          )}
        />
      )}

      {openId && <TrackerRowModal id={openId} owners={owners} onClose={() => setOpenId(null)} />}
    </div>
  );
}
