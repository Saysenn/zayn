import { useState } from 'react';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import { Skeleton } from '../display/Skeleton';
import { DownloadIcon } from '../icons';
import { SettingRow, Choice, Swatches } from './ExportControls';

/**
 * ***************************************************
 * * THE LIQUIDATIONS EXPORT (his call 2026-10-13)
 * ***************************************************
 *
 * The expenses export's own shape and controls: which columns, which
 * companies, which colour. One screen, no tabs. Everything it offers is
 * SERVED (/liquidations/export-options), never listed here as well.
 *
 * `shownCount` is what the page's filters and search leave; "Every company"
 * ignores them. Offered only when the two differ.
 */
export default function LiquidationsExportModal({
  options, loading, busy, shownCount, totalCount, onExport, onClose,
}) {
  const columns = options?.columns ?? [];
  const palettes = options?.palettes ?? [];
  const optional = columns.filter((c) => !c.required);
  const required = columns.filter((c) => c.required);
  const allFields = optional.map((c) => c.field);

  // `null` is untouched: every column, the commonest export.
  const [picked, setPicked] = useState(null);
  const [palette, setPalette] = useState(null);
  const filtered = shownCount !== totalCount;
  const [onlyShown, setOnlyShown] = useState(true);

  const chosen = picked ?? allFields;
  const activePalette = palette ?? options?.defaultPalette ?? palettes[0]?.id;

  return (
    <Modal title="Export liquidations" onClose={busy ? () => {} : onClose}>
      {loading ? (
        <Skeleton className="h-44 rounded-lg" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select
              multiple
              size="form"
              searchable
              className="min-w-0 flex-1"
              value={chosen}
              onChange={(v) => setPicked(Array.isArray(v) ? v : [])}
              options={optional.map((c) => ({ value: c.field, label: c.label }))}
              label={`Columns · ${chosen.length} of ${optional.length}`}
              placeholder="Pick the columns"
              hint={`${required.map((c) => c.label).join(' and ')} is always written.`}
            />
            <Button size="form" className="shrink-0" onClick={() => setPicked(allFields)}>All</Button>
          </div>

          <SettingRow label="Companies">
            {filtered ? (
              <Choice
                value={onlyShown}
                onChange={setOnlyShown}
                options={[
                  { value: true, label: `The ${shownCount} shown` },
                  { value: false, label: `Every company (${totalCount})` },
                ]}
              />
            ) : (
              <span className="text-xs text-text-muted">Every company ({totalCount})</span>
            )}
          </SettingRow>

          <SettingRow label="Colour">
            <Swatches colors={palettes} value={activePalette} onChange={setPalette} />
          </SettingRow>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button size="md" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button
              size="md"
              variant="primary"
              disabled={busy}
              phase={busy ? 'working' : 'idle'}
              onClick={() => onExport({ columns: chosen, palette: activePalette, onlyShown: filtered && onlyShown })}
            >
              <DownloadIcon width={15} height={15} />
              {busy ? 'Building…' : 'Export'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
