import { useState } from 'react';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import { Skeleton } from '../display/Skeleton';
import { DownloadIcon } from '../icons';
import { SettingRow, Choice, Swatches } from './ExportControls';

/**
 * ***************************************************
 * * The expenses export: four questions, NO TABS
 * ***************************************************
 *
 * NOT `MasterSheetExportModal`. That one is tabbed because a payout file is
 * a preset, a layout, a month, a breakdown design and a set of warnings.
 * A ledger is a list, and a tabbed modal over four short questions is four
 * clicks to see what fits on one screen.
 *
 * SAME CONTROLS, THOUGH. `SettingRow`, `Choice` and `Swatches` are the
 * master sheet modal's own, shared rather than redrawn: two export modals
 * answering the same kind of question two different ways is the fault
 * SettingRow exists to fix, one level up.
 *
 * Everything it offers is SERVED, never listed here as well.
 */

export default function ExpensesExportModal({
  options, loading, busy, month, onExport, onClose,
}) {
  const columns = options?.columns ?? [];
  const palettes = options?.palettes ?? [];
  const groups = options?.groups ?? [];

  const optional = columns.filter((c) => !c.required);
  const required = columns.filter((c) => c.required);
  const allFields = optional.map((c) => c.field);

  // `null` means untouched, which opens on everything: the commonest export
  // is the whole month. A default written out here as well would be one
  // fact in two places.
  const [picked, setPicked] = useState(null);
  const [chosenGroups, setChosenGroups] = useState([]);
  const [palette, setPalette] = useState(null);
  const [perGroup, setPerGroup] = useState(false);

  const chosen = picked ?? allFields;
  const activePalette = palette ?? options?.defaultPalette ?? palettes[0]?.id;

  // ONE FILE PER GROUP ONLY MEANS SOMETHING WITH A SPLIT TO MAKE. With one
  // group it is a zip holding one file, so the choice is not offered rather
  // than offered and ignored: a control that changes nothing is worse than
  // no control, because the next person assumes it did something.
  const groupsInPlay = chosenGroups.length === 0 ? groups.length : chosenGroups.length;
  const canSplit = groupsInPlay > 1;

  return (
    <Modal title={`Export expenses${month ? `, ${month}` : ''}`} onClose={busy ? () => {} : onClose}>
      {loading ? (
        <Skeleton className="h-52 rounded-lg" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select
              multiple
              size="form"
              searchable
              className="min-w-0 flex-1"
              value={chosenGroups}
              onChange={(v) => setChosenGroups(Array.isArray(v) ? v : [])}
              options={groups.map((g) => ({ value: g, label: g }))}
              label="Groups"
              placeholder="All"
              emptyLabel="No groups on this month's expenses"
            />
            <Select
              multiple
              size="form"
              searchable
              className="min-w-0 flex-1"
              value={chosen}
              onChange={(v) => setPicked(Array.isArray(v) ? v : [])}
              options={optional.map((c) => ({ value: c.field, label: c.label }))}
              // COUNTED OVER WHAT THIS LIST OFFERS, never over the file:
              // the two always written are named in the hint instead.
              label={`Columns · ${chosen.length} of ${optional.length}`}
              placeholder="Pick the columns"
              hint={`${required.map((c) => c.label).join(' and ')} are always written: a list of `
                + 'amounts belonging to nothing is not an expenses sheet.'}
            />
            <Button size="form" className="shrink-0" onClick={() => setPicked(allFields)}>
              All
            </Button>
          </div>

          <SettingRow label="Files">
            <Choice
              value={perGroup}
              onChange={setPerGroup}
              disabled={!canSplit}
              options={[
                { value: true, label: 'One per group, zipped' },
                { value: false, label: 'One workbook' },
              ]}
            />
            {!canSplit && (
              <span className="text-[11px] text-text-faint">
                One group, so there is nothing to split.
              </span>
            )}
            {perGroup && canSplit && (
              <span className="text-[11px] text-text-faint">
                {groupsInPlay} files. A row with no group gets its own rather than being left out.
              </span>
            )}
          </SettingRow>

          <SettingRow label="Colour">
            <Swatches colors={palettes} value={activePalette} onChange={setPalette} />
          </SettingRow>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => onExport({
                columns: chosen,
                groups: chosenGroups,
                palette: activePalette,
                perGroup: perGroup && canSplit,
              })}
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
