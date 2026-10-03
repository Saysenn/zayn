import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { saveBlob } from '../../helpers/api.helper';
import { monthLabel as sharedMonthLabel } from '../../helpers/monthLabel';
import CellInfo from '../display/CellInfo';
import { popup } from '../../configs/popups.config';
import { usePeopleFilters } from '../../hooks/usePeople';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from '../modals/Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import Toggle from '../forms/Toggle';
import BreakdownPicker from './BreakdownPicker';
import ExportWarnings from './ExportWarnings';
import { SettingRow, Choice, Swatches } from './ExportControls';
import { useBulkUpdateMasterSheetRows, useMasterSheetCellEdit } from '../../hooks/useMasterSheet';
import { DownloadIcon } from '../icons';

/**
 * Export the master sheet, or generate the next month's.
 *
 * Same shape as the People page's ExportModal on purpose — pick what,
 * narrow it, pick a format, see the count before you commit. A second
 * export dialog that worked differently would mean the same task behaved
 * differently depending on which page you started from.
 *
 * WHAT IS ACTUALLY NEW HERE is the month. "Export current" hands over the
 * sheet as it stands; "Generate for a month" rolls every row forward and
 * recomputes payable days and amounts against that month, which is the
 * boss's own routine done in one click instead of by hand.
 *
 * NOTHING IS WRITTEN. The roll happens in memory on the way out
 * (v1/masterSheet/rollToMonth.js). The CRM stays the record of what WAS
 * agreed; the generated sheet is a proposal the boss edits and uploads
 * back through the normal path. A wrong roll costs a regenerate.
 */

/**
 * THE RUN IS ALWAYS THIS MONTH. There is no picker.
 *
 * It used to offer this month and the next two, and in a year nobody chose
 * anything but the first. A payroll run is made for the month you are in;
 * a future month is generated when you get there, off a sheet that by then
 * says what it actually pays. Offering it invited a file dated for a month
 * whose presets nobody had set yet, whose total would read almost zero,
 * and there is no way to tell that apart from a broken export.
 *
 * The month is still a parameter everywhere below it. It is just derived
 * rather than chosen, so the tab name is the only place it is stated and
 * it can never disagree with the file.
 */
/**
 * ===============================
 * * CONTRACT: the month is the one on the ADMIN'S clock
 * ===============================
 *
 * This was UTC. The admin is on Pacific time, so for the last seven hours
 * of every month the modal offered next month's sheet, named it in the tab,
 * and generated a file whose total read almost zero.
 *
 * The API's half is `TIMEZONE` in `v1/shared/presetMonth.helper.js`, which
 * has to name the same zone this browser is in. Each side pins its own half:
 * this one with `masterSheetExportModal.test.jsx`.
 */
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 'August 2026', for the tab that names the month it will generate. The
// shared one, which also refuses to print "Invalid Date" for a malformed
// month. MonthlySheet.jsx keeps its own on purpose: that one returns null so
// the PDF can omit the line entirely.
const monthLabel = (month) => sharedMonthLabel(month, true);

/**
 * Each mode is a PRESET (which rows) and a TEMPLATE (what shape), because
 * picking "Cash" means both: only the rows paid in cash, in the cash
 * layout. Keeping the pair here rather than making the admin choose twice
 * is the whole point of the tabs.
 *
 * `month` is the only one that also rolls the figures forward.
 */
/**
 * WHAT COMES OUT, as one named choice.
 *
 *   ONE_BOOK      one workbook, one tab, the Group column carrying the group
 *   GROUP_TABS    one workbook, a tab per group, the TAB carrying it
 *   ZIPPED        one file per group, zipped
 *
 * The group has to be carried by something, or a re-upload cannot put the
 * rows back: the column does it in the first, the tab name in the other two.
 */
const SHAPE = Object.freeze({ ONE_BOOK: 'one', GROUP_TABS: 'tabs', ZIPPED: 'zip' });

const MODES = [
  {
    key: 'current',
    label: 'Master sheet',
    preset: 'expensing',
    template: 'master-sheet',
    columnPicker: true,
    // OPENS ON EVERY COLUMN, alone among the tabs. This is the working copy
    // of the sheet, so a column left out is an edit nobody can make.
    allColumns: true,
    // THE PROOFREADING SWITCH, on this tab alone. This is the copy somebody
    // fills in, so "what is missing" is a question only asked here. On a
    // payout file the blanks are somebody else's business.
    marks: true,
    // A TAB PER GROUP, and this is the only template that can build one.
    // The option was offered on every tab and honoured by one, so picking
    // it on Cash or Bank promised five tabs and delivered a single sheet.
    // It is also this tab's DEFAULT, his call 2026-09-22: one file to
    // open, split the way he reads it, and the tab name is what puts each
    // row back in its group on a re-upload.
    groupTabs: true,
    // WHO, on this tab too. His call 2026-09-23: the boss sent out a file
    // holding one person's deals, so the CRM has to be able to make one.
    // The same control the payout tabs have had all along, not a second
    // one: it already narrows WITH the groups, so picking both is those
    // people in those groups, which is exactly what a per group split of
    // one person's deals needs.
    people: true,
    // THE HEADER BAND'S COLOUR. Every other document could be coloured and
    // this one could not, because the picker rides with the breakdown and
    // this file has no breakdown.
    headerColor: true,
  },
  {
    key: 'month',
    // Named for the month it will actually generate. Resolved at RENDER,
    // not here: this array is built once at import, so a tab left open
    // across the 1st would keep advertising last month.
    label: (month) => `Generate for ${monthLabel(month)}`,
    preset: 'expensing',
    template: 'monthly-sheet',
    rolls: true,
    // The only layout with anything to switch on. Every other mode writes
    // its own totals and has no shape to choose.
    totals: true,
    columnPicker: true,
  },
  {
    // THE BREAKDOWNS ON THEIR OWN, one tab per group, no deal rows. Same
    // rows and the same block as the month tab: the difference is who
    // reads it. That tab is for checking a person's row, this is for
    // counting out the money, and handing the second reader 96 rows to
    // scroll past is handing them the wrong document.
    key: 'division',
    hidden: true,
    label: 'Division Sheet',
    preset: 'expensing',
    template: 'division-sheet',
    // ROLLS, like the month tab. Both render the same breakdown off the
    // same rows, so one rolling and the other not would put two different
    // figures for one group in two files generated minutes apart.
    rolls: true,
    // The design picker, because the whole file IS the breakdown. No
    // column picker: there are no deal columns in it to choose.
    totals: true,
  },
  {
    key: 'expensing',
    hidden: true,
    label: 'Expensing',
    preset: 'expensing',
    template: 'expensing',
    people: true,
    columnPicker: true,
  },
  {
    key: 'cash',
    hidden: true,
    label: 'Cash',
    preset: 'cash',
    template: 'cash',
    people: true,
    columnPicker: true,
  },
  {
    key: 'bank',
    hidden: true,
    label: 'Bank',
    preset: 'bank',
    template: 'bank',
    people: true,
    // EVERY LAYOUT'S COLUMNS ARE A CHOICE NOW. Expensing, Cash and Bank had
    // fixed shapes on purpose — "a column missing from one of those is a
    // broken payout file rather than a shorter one" — and that reasoning
    // survives as the DEFAULT: each opens on exactly the columns it has
    // always written, in the same order, so an export nobody touches is the
    // document it always was. Only "Name of individual" cannot be dropped.
    columnPicker: true,
    // THE SWITCH IS A SECOND PAIR, not a flag on this one. Everything else
    // in this modal picks rows by picking a preset, and a Bank sheet over
    // everyone is a different document with a different name
    // ("NEXUS - BANK DETAILS - …"), so it gets the preset and template that
    // say so rather than quietly widening this pair's filter.
    wider: {
      preset: 'bank-details',
      template: 'bank-details',
      on: 'Everyone, so the people who will never be bank are in it too',
      off: 'Only the people paid by transfer',
    },
  },
  {
    key: 'driver',
    hidden: true,
    label: 'Driver',
    // No row in tb_mastersheet carries a driver role, so this would export
    // an empty file today. It was SHOWN but not selectable, on the
    // reasoning that a missing tab reads as forgotten; hidden since
    // 2026-09-23, so that reasoning is suspended rather than gone.
    // `comingSoon` stays for the day it comes back.
    comingSoon: true,
  },
];

// PDF IS OFF ON EVERY MODE FOR NOW — no mode carries `pdf: true`. The three
// payout sheets never had a layout (templateFor falls back to the breakdown
// shape when asked for one that does not exist, which hands over a document
// in the wrong shape without saying so), and the two that did are held back
// with them so the format means one thing everywhere rather than working on
// two tabs out of six. The route, the print page and the PDF templates all
// stay; re-enabling is `pdf: true` back on a mode. Logged in docs/todo.md.
// ON since 2026-09-08. It was off because every fix waited on the server
// before the row changed, which is the wrong feel in a modal; the row fixes
// go through useMasterSheetCellEdit now, which paints and rolls back.
const SHOW_EXPORT_WARNINGS = true;

const MODE_BY_KEY = new Map(MODES.map((m) => [m.key, m]));

/**
 * ===============================
 * * HIDDEN, NOT DELETED. His call 2026-09-23, "for now".
 * ===============================
 * Division Sheet, Expensing, Cash and Bank are off the modal while the
 * master sheet tab is the one being worked on. Each carries its own
 * `hidden: true`, the same way a totals switch does, so bringing one back
 * is deleting one line rather than rebuilding an entry out of git.
 *
 * THE ENTRIES STAY IN `MODE_BY_KEY`, which is not an oversight. Their
 * templates, presets and column sets are still served, still tested and
 * still reachable by Diane and by a link somebody already has; only the
 * tiles are gone. Dropping them from the map as well would make such a
 * link resolve to the master sheet WITHOUT SAYING SO, which is worse than
 * either showing the tab or refusing it.
 */
const SHOWN_MODES = MODES.filter((m) => !m.hidden);

/**
 * The two shape switches, on the month tab alone.
 *
 * OFF BY DEFAULT, so Generate hands back the working sheet's own shape
 * split one tab per group, and each switch adds to it. They change the
 * LAYOUT and never the rows, which is why the count above them does not
 * move when either is flipped.
 */
const TOTALS = [
  {
    // A total under each COMPANY, not each person. The tab is laid out one
    // company at a time now, the way the boss writes the sheet, so a
    // person's rows are no longer contiguous and a total under them would
    // sit under a fragment. The API still accepts the old `personTotals`
    // name so a saved link keeps its setting.
    key: 'companyTotals',
    // NAME ON SCREEN, STATES BEHIND THE ICON. A switch labelled with a
    // whole sentence that changes as you flip it gives the eye nothing
    // fixed to find, and three of them stacked read as a paragraph with
    // toggles in it. The name never moves; what each position does is a
    // hover away.
    name: 'Company totals',
    on: 'A total under each company',
    off: 'No total under each company',
    // HIDDEN, AND OFF, NOT JUST INVISIBLE. A hidden control whose value
    // still travels is the worst of both: nothing on screen explains a
    // block appearing in the file. So a hidden switch is dropped from the
    // params too, and the server's own default (off) is what applies. Show
    // it again by deleting this line — the switch and its wiring are
    // untouched.
    hidden: true,
  },
  {
    key: 'groupTotals',
    name: 'Group total',
    on: 'A total for the group at the foot of its tab',
    off: 'No total for the group',
    hidden: true,
  },
  // "Include breakdown" WAS HERE and is now a picker, not a switch. There
  // is more than one shape of that block, and a second control that only
  // means something while the first is on is a pair nobody can predict. Off
  // is a choice in the list instead. See BreakdownPicker.
];

// SettingRow and Choice moved to ExportControls.jsx on 2026-09-14,
// when the expenses export modal needed the same two controls.


// What the modal actually renders and sends. A hidden switch keeps its
// definition above so bringing it back is deleting one line, but it is not
// drawn and its value never leaves the browser.
const SHOWN_TOTALS = TOTALS.filter((t) => !t.hidden);

/**
 * ===============================
 * * THE MARKING SWITCHES, on the Master sheet tab alone
 * ===============================
 * Separate from TOTALS, which are about LAYOUT on the month tab. These
 * change nothing about which rows are in the file or what they add up to:
 * they paint what is already there so a gap is findable.
 *
 * Its own list for the same reason TOTALS is one: a second marking switch
 * later is one entry here and nothing else.
 */
const MARKS = [
  {
    key: 'tintEmpty',
    name: 'Tint empty cells',
    on: 'Empty cells shaded red, so the gaps are findable',
    off: 'Empty cells left plain',
  },
  {
    /**
     * HIS WORDS IN THE END DATE CELL. His call 2026-09-22.
     *
     * The cell is blank on a deal with no end date, and the reason is
     * already known: his own "Going concern" or "Reviewed monthly", or the
     * tick somebody put on the status screen. Off, the file says nothing
     * and he has to remember which is which. On, the cell says it, on
     * yellow.
     *
     * A DEAL WITH A REAL DATE IS UNTOUCHED either way.
     */
    key: 'showRates',
    name: 'Rates applied column',
    on: 'A last column saying what went on top, in words: added 5% · 1% fx fee',
    off: 'No rates column',
  },
  {
    key: 'includeTags',
    name: 'Include tags',
    on: 'Blank end dates say why, on yellow: Going concern or Reviewed monthly',
    off: 'Blank end dates left empty',
    // IT WRITES INTO THE END DATE CELL, so with that column dropped it has
    // nowhere to write and does nothing. Four of the five presets drop it,
    // and the switch sat there promising something it could not do. Named
    // as a COLUMN rather than a preset: the picker is free, and somebody
    // unticking the column by hand has the same problem.
    needs: 'end_on',
  },
];

/**
 * A switch, its NAME, and what each position does behind an icon.
 *
 * The name is the only thing that stays put. Labelling a toggle with a
 * sentence that rewrites itself as you flip it means the eye has to reread
 * the line to find out what the control even is, and three of those
 * stacked read as a paragraph somebody dropped switches into.
 *
 * `info`, not `warning`: which shape a file comes out in is context, and
 * nobody has to act on it. See CellInfo for the rule.
 */
function SwitchRow({ checked, onChange, name, on, off }) {
  return (
    <label className="flex items-center gap-2.5">
      <Toggle checked={checked} onChange={onChange} label={name} />
      <span className="flex items-center gap-1 text-sm">
        {name}
        <CellInfo {...popup.exportToggle({ name, on, off })} />
      </span>
    </label>
  );
}

export default function MasterSheetExportModal({ group: initialGroup, onClose }) {
  const [mode, setMode] = useState('current');
  // Always this month, never chosen. Held as a value rather than called
  // inline because the tab label, the count request and the download all
  // have to agree on one month, and three separate calls to currentMonth()
  // would disagree for one render across midnight on the 1st.
  const [month] = useState(currentMonth);
  // Seeded from the page's own group filter, so "export what I'm looking
  // at" needs no re-picking, and still editable here.
  // A LIST now. Seeded from the page's own group filter when it has one.
  const [group, setGroup] = useState(() => (initialGroup ? [initialGroup] : []));
  // WHO, on the payout tabs. Empty is everyone, the same as Groups: a
  // cleared filter is no filter anywhere else in the CRM and a second rule
  // here would be one nobody could predict. It narrows WITH the group rather
  // than instead of it, so three people in NEXUS means those three.
  const [people, setPeople] = useState([]);
  // Bank only: whether the file covers everyone or only the transfers.
  const [wider, setWider] = useState(false);
  // OFF BY DEFAULT, his call 2026-09-12. One workbook is one file you can
  // open and read; a zip has to be saved, extracted and opened a group at a
  // time, which is work before you have seen anything. Forwarding a single
  // group's sheet is the exception, so splitting is the deliberate act.
  /**
   * ===============================
   * * THREE FILE SHAPES, and only one of them is several files
   * ===============================
   * It was a boolean, because there were two answers. His call
   * 2026-09-22 adds the third: ONE workbook with a tab per group, which is
   * the working file split the way he reads it rather than a zip he has to
   * open five times.
   *
   * Named values rather than two booleans: "not multiFile and perGroupTabs"
   * is a state somebody has to decode, and a fourth shape later would be a
   * third boolean and eight combinations for four answers.
   *
   * GROUP_TABS IS THE DEFAULT, his call 2026-09-22. It is how he reads the
   * sheet, it is still ONE file to open, and the tab name is what puts each
   * row back in its group on a re-upload. ZIPPED stays the deliberate act
   * for the same reason as before: a zip is work before you have seen
   * anything.
   */
  const [fileShape, setFileShape] = useState(SHAPE.GROUP_TABS);
  // null when idle, otherwise { phase, percent } from the download.
  const [progress, setProgress] = useState(null);
  const { notify } = useNotifications();
  const [format, setFormat] = useState('xlsx');
  // One object, so a switch added to TOTALS needs nothing here.
  // Seeded from TOTALS itself, so a switch that ships on is one line in
  // that list rather than a default written out twice.
  // Which shape the breakdown block takes. 'standard' is what the month
  // tab has always produced, so an export nobody touches is the document it
  // has always been.
  // THE DEFAULT IS THE SERVER'S, arriving with the list. Typing it here
  // too meant the modal opened on one design while the export defaulted to
  // another, which is one fact in two places by definition.
  // Null until the list lands; the picker is not drawn before then.
  const [breakdownDesign, setBreakdownDesign] = useState(null);
  // OFF BY DEFAULT. It names every rate in a block of its own, which is a
  // reading somebody asks for rather than the shape of the document.
  const [percentagesTable, setPercentagesTable] = useState(false);
  // NULL UNTIL THE PALETTE ARRIVES, then the server's own default. They
  // were typed here as 'orange' and 'grey', which is the same fact in two
  // places by definition: the picker opened on one colour while an export
  // that sent none took another. The design above already learned this.
  const [primaryColor, setPrimaryColor] = useState(null);
  const [secondaryColor, setSecondaryColor] = useState(null);
  const { data: breakdownMeta } = useQuery({
    queryKey: ['export-breakdown-designs'],
    queryFn: () => apiService.exports.breakdownDesigns(),
    staleTime: Infinity,
  });
  const breakdownDesigns = breakdownMeta?.designs;
  const breakdownColors = breakdownMeta?.colors ?? [];
  const defaultBreakdown = breakdownMeta?.defaultId ?? null;
  const defaultColor = breakdownMeta?.defaultColor ?? null;
  const defaultSecondary = breakdownMeta?.defaultSecondary ?? null;

  // DECLARED BEFORE THE EFFECTS THAT READ IT. `const` is not hoisted, so a
  // dependency array above this line throws on the first render and takes
  // the page down with it. The build cannot see that.
  //
  // Applied once, when the list arrives, and never again: it must not undo
  // a choice the admin has already made.
  useEffect(() => {
    if (breakdownDesign === null && defaultBreakdown) setBreakdownDesign(defaultBreakdown);
  }, [breakdownDesign, defaultBreakdown]);

  // Same beat for the two colours: once, when the palette lands, and never
  // again, so it cannot undo a choice already made.
  useEffect(() => {
    if (primaryColor === null && defaultColor) setPrimaryColor(defaultColor);
  }, [primaryColor, defaultColor]);
  useEffect(() => {
    if (secondaryColor === null && defaultSecondary) setSecondaryColor(defaultSecondary);
  }, [secondaryColor, defaultSecondary]);

  /**
   * PICKING A PRIMARY PULLS THE SECONDARY WITH IT, his call 2026-09-23, so
   * a document comes out as one colour in three weights instead of a
   * maroon header over grey tints.
   *
   * IN THE HANDLER, NEVER AN EFFECT. As an effect it would fight the two
   * above, which exist to apply a default once, and it would undo a Tints
   * choice on every unrelated render. Here it fires only on the click, so
   * the Tints picker still overrides freely until the primary moves again.
   */
  function choosePrimary(id) {
    setPrimaryColor(id);
    setSecondaryColor(id);
  }

  // Landing on the Division Sheet with "No breakdown" carried over from the
  // month tab would generate empty tabs, so the choice that cannot apply
  // here is corrected rather than hidden while still selected.
  useEffect(() => {
    if (mode === 'division' && breakdownDesign === 'none') setBreakdownDesign(defaultBreakdown);
  }, [mode, breakdownDesign, defaultBreakdown]);

  const [totals, setTotals] = useState(
    () => Object.fromEntries(TOTALS.filter((t) => t.defaultOn).map((t) => [t.key, true])),
  );
  // Its own state, so a marking switch and a layout switch can never be
  // read for each other. Off by default: a sheet of red is unreadable.
  const [marks, setMarks] = useState(
    () => Object.fromEntries(MARKS.filter((m) => m.defaultOn).map((m) => [m.key, true])),
  );
  const { data: options } = usePeopleFilters();
  // Both invalidate every dependent cache on success, which includes
  // ['export-count'], so the panel redraws itself from the server rather
  // than from a guess about what the fix did.
  const bulkUpdate = useBulkUpdateMasterSheetRows();
  // OPTIMISTIC, not useUpdateMasterSheetRow. A fix in this panel paints
  // the row immediately and rolls back on failure, which is why the panel
  // could be turned back on.
  const rowUpdate = useMasterSheetCellEdit();

  const showTotals = Boolean(MODE_BY_KEY.get(mode)?.totals);
  // The header band's colour, on a tab with no breakdown to carry it.
  const showHeaderColor = Boolean(MODE_BY_KEY.get(mode)?.headerColor);
  const showMarks = Boolean(MODE_BY_KEY.get(mode)?.marks);
  const showColumns = Boolean(MODE_BY_KEY.get(mode)?.columnPicker);
  const showPeople = Boolean(MODE_BY_KEY.get(mode)?.people);
  const widen = MODE_BY_KEY.get(mode)?.wider;

  /**
   * ONE FILE PER GROUP, and the switch only exists when there is a split
   * to make.
   *
   * No selection means every group, which is the commonest case for it and
   * the one worth the most. Exactly one group selected cannot be split, so
   * the switch is not shown rather than shown and ignored: a toggle that
   * changes nothing is worse than no toggle, because the next person
   * assumes it did something.
   *
   * Every tab offers it. Even Master sheet, whose layout is a single sheet
   * rather than a tab per group, still means "one file per group" and is
   * still forwarded a group at a time.
   */
  const canMultiFile = group.length === 0 || group.length >= 2;
  // Only the master sheet template splits into tabs. Everything else would
  // take the option, ignore it, and hand back one sheet.
  const canGroupTabs = Boolean(MODE_BY_KEY.get(mode)?.groupTabs);
  // DERIVED, never reset. A tab that cannot split reads as one workbook
  // while you are on it, and the choice comes back when you return to a
  // tab that can. Resetting the state instead would silently discard it.
  const shape = canGroupTabs || fileShape !== SHAPE.GROUP_TABS ? fileShape : SHAPE.ONE_BOOK;

  /**
   * WHICH COLUMNS THE FILE CARRIES.
   *
   * Served rather than listed here, so adding one is a change in
   * buildWorkbook and nothing in this file. `null` means untouched, which
   * is what seeds it to the boss's own send layout the first time the list
   * arrives — a state, not a default written out twice.
   */
  // PER TEMPLATE. Each payout sheet names the same field its own way, so
  // the list has to come from the tab you are standing on: `payable_amount`
  // is "Payable amount" on Expensing, "Amount" on Cash, "Amount payable" on
  // Bank. Keyed on the template so switching tabs fetches the right one and
  // caches both.
  const activeTemplate = MODE_BY_KEY.get(mode)?.template;
  const { data: columnInfo } = useQuery({
    queryKey: ['export-columns', activeTemplate],
    queryFn: () => apiService.exports.columns(activeTemplate),
    staleTime: Infinity,
    enabled: Boolean(activeTemplate),
  });
  const [picked, setPicked] = useState(null);
  // WHICH ROWS THE CHOSEN DOCUMENT IS ABOUT. Set by the rail alone: the
  // Bank document is the bank rows in bank columns, so its preset carries
  // both halves and picking it applies both. null is every row.
  const [method, setMethod] = useState(null);
  // WHICH DOCUMENT WAS CHOSEN, for the filename alone. Standard narrows no
  // rows and is still its own file, so the name cannot be derived from the
  // filter. The id, not the label: labels are prose and this is a wire
  // value the server matches against its own list.
  const [sheetPreset, setSheetPreset] = useState(null);

  // A selection belongs to the tab it was made on. The keys mostly overlap
  // but the sets do not, so carrying a Bank pick onto Expensing would drop
  // columns nobody deselected. Back to that tab's own default instead.
  // The filter goes with them, or a Bank narrowing would follow you onto a
  // tab whose rail cannot show it and cannot clear it.
  useEffect(() => { setPicked(null); setMethod(null); setSheetPreset(null); }, [activeTemplate]);

  // The four that can never go: a file without them cannot be uploaded
  // back, so they are not offered rather than offered and refused.
  const allColumns = columnInfo?.columns ?? [];
  // HIS FOUR DOCUMENTS, served beside the columns they name so a key
  // cannot drift out of step with them. Empty on the payout tabs: each of
  // those already IS one of the four.
  const columnPresets = columnInfo?.presets ?? [];
  const required = allColumns.filter((c) => c.required);
  const optional = allColumns.filter((c) => !c.required);
  const sendSet = optional.filter((c) => c.inSend).map((c) => c.key);
  const allSet = optional.map((c) => c.key);
  // THE TAB DECIDES ITS OWN OPENING SET. Master sheet opens on all of them,
  // every other tab on the layout it has always written.
  const chosen = picked ?? (MODE_BY_KEY.get(mode)?.allColumns ? allSet : sendSet);

  // WHICH ROWS. Kept apart from the shape switches below because this is
  // what the count is asked for, and a count that reran every time a total
  // was switched on would flicker back to the number it already showed.
  const selection = useMemo(() => {
    const chosen = MODE_BY_KEY.get(mode) ?? SHOWN_MODES[0];
    // The widened pair, when the tab has one and it is switched on. Both
    // halves move together: the preset is the rows and the template is the
    // name, and sending one without the other is what would let a slice and
    // a whole run share a filename.
    const pair = chosen.wider && wider ? chosen.wider : chosen;
    return {
      preset: pair.preset,
      template: pair.template,
      // Comma joined for the wire; the API splits and matches any of them.
      // Empty list means every group, so the param is simply absent.
      group: group.length > 0 ? group.join(',') : undefined,
      // BY ID, not by name. The API matches person_id exactly, where its
      // name search is a substring and a short name catches more people
      // than anybody means. Only sent from the tabs that offer the picker,
      // so a selection made on a payout tab cannot travel with the master
      // sheet, which is not a per-person document.
      personId: showPeople && people.length > 0 ? people.join(',') : undefined,
      // Only the month mode rolls figures forward. The payout sheets
      // report what the CRM holds now, which is what they are paid from.
      month: MODE_BY_KEY.get(mode)?.rolls ? month : undefined,
      // IN THE SELECTION, not in the shape params below, because it
      // decides WHICH ROWS. In there the count would keep reporting 92
      // while the file came down with 31, and the number on screen is the
      // only thing that says the sheet was narrowed.
      method: showColumns ? (method ?? undefined) : undefined,
    };
  }, [mode, month, group, people, showPeople, wider, method, showColumns]);

  // WHAT SHAPE, on top of it. Only ever sent for the layout that has the
  // switches, so one left on from the month tab cannot travel with a payout
  // export.
  const params = useMemo(() => ({
    ...selection,
    ...(showTotals
      // Both directions, because one of these defaults ON: sending only
      // the true ones would leave no way to say the breakdown is off.
      // VISIBLE ONES ONLY. A hidden switch is dropped from the params so
      // the server applies its own default, rather than a value nothing on
      // screen accounts for travelling with the request.
      ? Object.fromEntries(SHOWN_TOTALS.map((t) => [t.key, totals[t.key] ? 'true' : 'false']))
      : {}),
    // ONLY THE TRUE ONES, and only from the tab that shows them. These all
    // default OFF on the server, so an absent key already means off and
    // sending 'false' would be a value nothing on screen accounts for.
    // A SWITCH THAT IS NOT ON SCREEN IS NOT SENT, the same rule as the
    // totals above: a hidden one left on from another preset would ask for
    // something the file cannot carry.
    ...(showMarks
      ? Object.fromEntries(
        MARKS.filter((m) => marks[m.key] && (!m.needs || chosen.includes(m.needs)))
          .map((m) => [m.key, 'true']),
      )
      : {}),
    // The design, only from the tab that offers it. 'none' travels as the
    // old breakdown=false so the server's own default cannot re-add the
    // block, and so a saved link keeps meaning what it meant.
    // `breakdownDesign &&` because it is null until the list lands. Sent as
    // null it reaches the server as the string "null", which resolves to
    // the default rather than erroring: right by accident, and only once.
    ...(showTotals && breakdownDesign
      ? {
        breakdownDesign,
        breakdown: breakdownDesign === 'none' ? 'false' : 'true',
        // Only when on: absent means off on the server too, so a saved
        // link without it keeps the shape it had.
        ...(percentagesTable ? { percentagesTable: 'true' } : {}),
        // Absent until the palette lands, which is the same beat as
        // `breakdownDesign` above and guarded for the same reason: a null
        // reaches the server as the string "null".
        ...(primaryColor ? { primaryColor } : {}),
        ...(secondaryColor ? { secondaryColor } : {}),
      }
      : {}),
    // THE TWO COLOURS ON THEIR OWN, for the tab that has no breakdown to
    // send them with. Sent separately rather than by widening the block
    // above: that one also carries a design and a percentages table,
    // neither of which this file has.
    //
    // THE SECONDARY REACHES THIS FILE TOO, his call 2026-09-23. It paints
    // the tints, the payable amount of a row out of the month's figure
    // included, and this tab was sending only the header colour.
    ...(showHeaderColor && primaryColor ? { primaryColor } : {}),
    ...(showHeaderColor && secondaryColor ? { secondaryColor } : {}),
    // IN THE PARAMS, NOT THE SELECTION. It changes the file's NAME and not
    // one row, so putting it beside the filters would refetch the count
    // every time the name changed.
    ...(showColumns && sheetPreset ? { sheetPreset } : {}),
    // Only for the layouts that offer the choice, so a selection made on
    // the month tab cannot travel with a payout export that has a fixed
    // shape. Absent means every column, which is what the API defaults to.
    ...(showColumns && chosen.length > 0 ? { columns: chosen.join(',') } : {}),
    // Only when the switch is actually on screen. Left in the params after
    // narrowing to one group it would ask the server to split something
    // that cannot be split, which it ignores — but a param nothing on
    // screen accounts for is how a saved link starts behaving oddly.
    // ONE OF THE THREE, and only ever one: the server reads them as two
    // independent flags, so sending both would ask for a zip of tabbed
    // workbooks that nobody chose.
    ...(canMultiFile && shape === SHAPE.ZIPPED ? { multiFile: 'true' } : {}),
    ...(canMultiFile && shape === SHAPE.GROUP_TABS ? { perGroupTabs: 'true' } : {}),
  }), [selection, showTotals, totals, showMarks, marks, breakdownDesign, percentagesTable, primaryColor, secondaryColor, showColumns, showHeaderColor, sheetPreset, chosen, canMultiFile, shape]);

  const { data: count, isLoading, isFetching } = useQuery({
    queryKey: ['export-count', selection],
    queryFn: () => apiService.exports.count(selection),
    // KEEP THE LAST NUMBER ON SCREEN WHILE THE NEXT ONE LOADS. The key
    // changes on every tab, group, person and month, so without this the box
    // dropped back to "Counting…" and the Generate button greyed out each
    // time — a count that exists to inform you was blocking the thing it was
    // informing. Now it only ever says "Counting…" on the very first open.
    placeholderData: (prev) => prev,
  });

  /**
   * THE MODAL STAYS OPEN UNTIL THE FILE IS ACTUALLY IN HAND.
   *
   * It used to set window.location and close in the same breath. Building
   * five workbooks and zipping them takes seconds, and the browser shows
   * nothing at all while a navigation is pending, so the modal vanished
   * and the screen sat there looking hung. Nothing on the page even knew
   * the download had started, let alone finished or failed.
   *
   * Fetched with progress instead. Closing is the LAST thing, after the
   * file is saved, so the modal disappearing is now the confirmation that
   * it worked.
   */
  async function download() {
    if (effectiveFormat === 'pdf') {
      // A print window is the browser's own, opens immediately, and has
      // nothing to report. Unchanged.
      const search = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined),
      );
      window.open(`/export/print?${search}`, '_blank', 'noopener');
      onClose();
      return;
    }

    setProgress({ phase: 'building', percent: 0 });
    try {
      const { blob, filename } = await apiService.exports.xlsx(params, setProgress);
      saveBlob(blob, filename);
      onClose();
    } catch (err) {
      // Stays open, so the selection is still there to retry from. A
      // failed export that also threw away twenty seconds of picking is
      // two problems.
      setProgress(null);
      notify({ level: 'error', message: "Couldn't build that export", detail: err.message });
    }
  }

  // HOW MANY FILES ARE COMING. Off the count's own group tally, which is
  // computed on the rows the export will actually contain — not off the
  // Groups dropdown, which says nothing when it is empty and would be
  // wrong on a payout tab where the preset already dropped some groups.
  // ONLY THE ZIP IS SEVERAL FILES. A tab per group is still one download.
  const fileCount = canMultiFile && shape === SHAPE.ZIPPED ? (count?.groups ?? 1) : 1;

  const monthStats = count?.month;
  // Only the groups with more than one currency: naming a single-currency
  // group here would be reporting that nothing is unusual.
  const multiCurrency = (count?.currencies ?? []).filter((c) => c.currencies.length > 1);

  // Picking a spreadsheet-only mode while PDF is selected has to move the
  // selection too, or Export would open a print window for a layout that
  // does not exist.
  const pdfAvailable = Boolean(MODE_BY_KEY.get(mode)?.pdf);
  const effectiveFormat = pdfAvailable ? format : 'xlsx';

  return (
    <Modal wide title="Export master sheet" onClose={onClose}>
      <div className="space-y-5">
        {/* Three across. At two columns the tiles ran out of width and the
            labels collided with each other. */}
        <div className="grid gap-2 sm:grid-cols-3">
          {SHOWN_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={m.comingSoon}
              onClick={() => setMode(m.key)}
              className={`min-h-0 border px-3 py-2.5 text-center disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === m.key
                  ? 'border-accent bg-accent-tint'
                  : 'border-border enabled:hover:bg-surface-sunken'
              }`}
            >
              {/* Name only. The hints ran into each other at three across —
                  "One sheet, like the working file" collided with the tile
                  beside it — and a tile whose job is to be picked does not
                  need explaining. */}
              <span className="block text-sm font-semibold text-text">
                {typeof m.label === 'function' ? m.label(month) : m.label}
              </span>
              {m.comingSoon && (
                <span className="block text-xs text-text-muted">Coming soon</span>
              )}
            </button>
          ))}
        </div>

        {/* WHICH ROWS. The month is not here any more: it is always this
            one and the tab above says which. See currentMonth. */}
        <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
          {/* Several groups at once: one, two, or none for all of them.
              No All option in the list — selecting nothing IS all of them,
              and an explicit All that has to be deselected before picking a
              second group is a trap people fall into once each.

              "ALL", NOT "ALL GROUPS", and that is not a shortening. There
              is a real group CALLED "ALL GROUPS" (the twelve NA roster
              rows), so a placeholder reading "All groups" sat in the same
              box as a group of that name and there was no way to tell
              whether the export covered everything or covered that one
              group. "All" cannot be read as a group name. */}
          <Select
            multiple
            size="form"
            searchable
            value={group}
            onChange={setGroup}
            options={(options?.groups ?? []).map((g) => ({ value: g, label: g }))}
            label="Groups"
            placeholder="All"
          />

          {/* WHICH COLUMNS THE MAIN TABLE CARRIES, beside Groups rather than
              in a block of its own below. They are the same kind of
              decision, which rows and which columns, and stacking them put
              a caption, a button and a sentence between two dropdowns.

              Only the main table: the active-company summary and the
              payment breakdown are readings of the rows, not the columns,
              so they are unaffected. The summary does slide left with a
              shorter set, which is right. */}
          {/* THE COUNT IS IN THE LABEL AND ALL IS ON THE ROW. Both used to
              sit on a line underneath, which made this cell two rows tall
              next to a Groups dropdown one row tall, and the whole grid
              read as broken. The count belongs to the field, so it goes in
              the field's own label; the ordering note and the always
              written list are context, so they go behind the icon the
              label already supports. */}
          {showColumns && optional.length > 0 && (
            <div className="flex items-center gap-2">
              <Select
                multiple
                size="form"
                searchable
                className="min-w-0 flex-1"
                value={chosen}
                // THE PRESET ARRIVES ONLY FROM THE RAIL. A hand tick sends
                // nothing and leaves the filter where it is: unticking a
                // column inside the Bank document does not stop it being
                // the Bank document.
                onChange={(v, preset) => {
                  setPicked(Array.isArray(v) ? v : []);
                  if (preset) {
                    setMethod(preset.method ?? null);
                    setSheetPreset(preset.id);
                  }
                }}
                options={optional.map((c) => ({ value: c.key, label: c.header }))}
                presets={columnPresets}
                activeMethod={method}
                // COUNTED OVER WHAT THIS LIST OFFERS, never over the file. It
                // read "21" beside a control holding 17, which reads broken.
                // The four always written are named in the hint.
                label={`Columns · ${chosen.length} of ${optional.length}`}
                placeholder="Pick the columns"
                // WHICH COLUMNS CANNOT GO, read off the served list rather
                // than written out here. It is four on the two master-sheet
                // layouts and one on the payout sheets, and a hardcoded
                // sentence about "the four" was going to be a lie on three
                // tabs the moment they got a picker.
                hint={popup.exportColumns(required.map((c) => c.header))}
              />
              {/* ONE JUMP. The modal already opens on the boss's send
                  layout, so a button selecting it was a second way to reach
                  the state you are already in. */}
              <Button size="form" className="shrink-0" onClick={() => setPicked(allSet)}>
                All
              </Button>
            </div>
          )}

          {/* WHO, on the payout tabs only. Searchable because there are 68
              of them and a list that long is a scroll, not a choice. It
              narrows WITH the groups above, so picking neither is everyone
              and picking both is those people in those groups. */}
          {showPeople && (
            <Select
              multiple
              size="form"
              searchable
              value={people}
              onChange={setPeople}
              options={(options?.people ?? []).map((p) => ({
                value: p.personId,
                label: p.name,
              }))}
              label="People"
              placeholder="Everyone"
            />
          )}
        </div>

        {/* EVERY SHAPE SWITCH IN ONE STACK, one name each. Which of them
            appear depends on the tab, so they were three separate blocks
            with three different spacings; grouping them means the gap
            between two switches is the same gap wherever you are.

            "Everyone" is the Bank tab's: off is the transfer run, which is
            what the money goes out from. On adds the cash and crypto rows
            so the people who will never be bank are visible beside a row
            paid by transfer with nothing to pay into, and the file becomes
            BANK DETAILS rather than BANK because it is no longer a payment
            run. */}
        {(widen || canMultiFile || showTotals || showMarks || showHeaderColor) && (
          <div className="space-y-2.5">
            {/* The Bank tab's own choice, in the SAME shape as the rows
                below it. A toggle sitting above two segmented controls was
                a third idiom for a two-state choice in one stack. */}
            {widen && (
              <SettingRow label="Who">
                <Choice
                  value={wider}
                  onChange={setWider}
                  options={[
                    { value: false, label: 'Paid by transfer' },
                    { value: true, label: 'Everyone' },
                  ]}
                />
              </SettingRow>
            )}

            {/* TWO ROWS, because they answer two questions: what the bands
                are, and what a marked cell is. The second was not offered
                on this tab at all, so a payable amount out of the month's
                figure came out in a colour nobody picked. His call
                2026-09-23. Picking a Header sets Tints to match; Tints
                then overrides it. */}
            {showHeaderColor && breakdownColors?.length > 0 && (
              <>
                <SettingRow label="Header">
                  <Swatches
                    colors={breakdownColors}
                    value={primaryColor}
                    onChange={choosePrimary}
                  />
                </SettingRow>
                <SettingRow label="Tints">
                  <Swatches
                    colors={breakdownColors}
                    value={secondaryColor}
                    onChange={setSecondaryColor}
                  />
                </SettingRow>
              </>
            )}

            {canMultiFile && (
              <SettingRow label="Files">
                <Choice
                  value={shape}
                  onChange={setFileShape}
                  options={[
                    { value: SHAPE.ONE_BOOK, label: 'One workbook' },
                    ...(canGroupTabs
                      ? [{ value: SHAPE.GROUP_TABS, label: 'One workbook, tab per group' }]
                      : []),
                    { value: SHAPE.ZIPPED, label: 'One file per group, zipped' },
                  ]}
                />
              </SettingRow>
            )}

            {showTotals && SHOWN_TOTALS.map((t) => (
              <SwitchRow
                key={t.key}
                checked={Boolean(totals[t.key])}
                onChange={(on) => setTotals((s) => ({ ...s, [t.key]: on }))}
                name={t.name}
                on={t.on}
                off={t.off}
              />
            ))}

            {/* The same row shape as every other switch here. It changes
                no row and no figure, so the count above it does not move
                when it is flipped. */}
            {showMarks && MARKS.filter((m) => !m.needs || chosen.includes(m.needs)).map((m) => (
              <SwitchRow
                key={m.key}
                checked={Boolean(marks[m.key])}
                onChange={(on) => setMarks((s) => ({ ...s, [m.key]: on }))}
                name={m.name}
                on={m.on}
                off={m.off}
              />
            ))}

            {/* LAST, AND BELOW THE SWITCHES, because it is the only control
                here that shows you its result. Sitting it among the toggles
                would make the preview look like it belonged to whichever
                switch it happened to land under. */}
            {/* NO "No breakdown", ANYWHERE THIS PICKER APPEARS. It was
                dropped on the Division Sheet first, because that file IS
                the breakdown and the option handed over a workbook of
                empty tabs. His call 2026-09-23 takes it off the month tab
                too, which leaves no tab that offers it, so the choice is
                gone rather than conditional.

                THE 'none' DESIGN ITSELF IS UNTOUCHED. It is still served,
                still what `breakdown=false` means on the wire, and still
                what a saved link without a design resolves to. Only the
                tile is gone. */}
            {showTotals && breakdownDesigns?.length > 0 && (
              <BreakdownPicker
                designs={breakdownDesigns.filter((d) => d.id !== 'none')}
                value={breakdownDesign}
                onChange={setBreakdownDesign}
                colors={breakdownColors}
                primary={primaryColor}
                secondary={secondaryColor}
                onPrimary={choosePrimary}
                onSecondary={setSecondaryColor}
                percentagesTable={percentagesTable}
                onPercentagesTable={setPercentagesTable}
              />
            )}
          </div>
        )}

        {/* HIDDEN WHILE PDF IS OFF, not shown greyed out. No mode carries
            `pdf: true` today, so this offers exactly one usable choice: a
            control you cannot change is not a choice, it is a claim that
            something is available. The same reasoning already applies to
            the hidden totals switches. It comes back on its own the moment
            a mode sets pdf. */}
        <div className={`flex gap-2 ${pdfAvailable ? '' : 'hidden'}`}>
          {[
            { key: 'xlsx', label: 'Spreadsheet' },
            { key: 'pdf', label: 'PDF' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={f.key === 'pdf' && !pdfAvailable}
              onClick={() => setFormat(f.key)}
              className={`min-h-0 border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                effectiveFormat === f.key
                  ? 'border-accent bg-accent-tint font-semibold text-text'
                  : 'border-border text-text-muted hover:bg-surface-sunken'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ===============================
            * HIDDEN, NOT DELETED
            * ===============================
            Every fix here waits on the server before the row updates, which
            is the wrong feel in a modal. Bring it back by flipping this to
            true, once the fixes are optimistic. */}
        {SHOW_EXPORT_WARNINGS && (
        <ExportWarnings
          warnings={count?.warnings}
          busy={bulkUpdate.isPending || rowUpdate.isPending}
          onBulkFix={(w) => bulkUpdate.mutate({
            ids: w.ids,
            fields: { [w.fix.field]: w.fix.value },
            label: w.fix.label,
          })}
          // Two shapes: a one field fix, and a dates suggestion that
          // carries its whole patch.
          onRowFix={({ id, field, value, fields }) => rowUpdate.mutate({
            id, fields: fields ?? { [field]: value },
          })}
        />
        )}

        {/* The last figure stays legible while the next one loads, dimmed
            rather than replaced. Blanking it made the box flash on every
            filter change and read as though the export had gone wrong. */}
        <div
          className={`border border-border bg-surface-sunken px-3 py-2.5 text-sm transition-opacity ${
            isFetching && !isLoading ? 'opacity-60' : ''
          }`}
        >
          {isLoading && <span className="text-text-muted">Counting…</span>}
          {!isLoading && (
            <>
              <span className="font-semibold tabular-nums">{count?.rows ?? 0}</span>{' '}
              {count?.rows === 1 ? 'row' : 'rows'}
              {/* THE COUNT IS THE CONFIRMATION when a selection is a cross
                  product. Nine people across two groups is however many
                  deals it is, and nobody can work that out any other way
                  before the file arrives. */}
              {showPeople && people.length > 0 && (
                <> for <span className="font-semibold tabular-nums">{count?.people ?? 0}</span>{' '}
                  {count?.people === 1 ? 'person' : 'people'}
                </>
              )}
              {/* SAID IN WORDS, not left to the number alone. The count
                  drops from 92 to 31 the moment Bank is picked, and a
                  number that moved is not a reason. */}
              {method && <> paid by {method}</>}
              {group.length > 0 && <> in {group.join(', ')}</>}
              {monthStats && (
                <span className="mt-1 block text-xs text-text-muted">
                  {/* Rows set to another month are NOT repeated here. The
                      warnings panel above says it per group and offers the
                      fix; saying it twice, once with a button and once
                      without, makes the one without look like a different
                      problem. */}
                  {monthStats.ended > 0 && (
                    <>
                      {monthStats.ended} carried with a finished payment period, marked in the file.{' '}
                    </>
                  )}
                  {monthStats.zero > 0 && <>{monthStats.zero} earn nothing this month. </>}
                  {monthStats.unresolved > 0 && (
                    <>{monthStats.unresolved} could not be worked out and are left empty rather than guessed.</>
                  )}
                </span>
              )}
              {/* WHICH GROUPS ARE PAID IN MORE THAN ONE CURRENCY. Every
                  live one is, so this is not a warning about an edge case:
                  it is why each tab's breakdown carries a line per currency
                  and its totals never blend them. Behind an icon, because
                  four groups and their currencies spelled out is longer
                  than everything else in this box put together. */}
              {multiCurrency.length > 0 && (
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-text-muted">
                  <span>
                    {multiCurrency.length}{' '}
                    {multiCurrency.length === 1 ? 'group is' : 'groups are'} paid in more than one
                    currency
                  </span>
                  <CellInfo {...popup.currenciesPerGroup(count?.currencies ?? [])} />
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {/* WHAT IT IS DOING, in words, beside the button that is doing
              it. The fill says "working"; only this says whether the wait
              is the server building or the file coming down, which is the
              difference between "nearly there" and "just started". */}
          {progress && (
            <span className="mr-auto text-sm text-text-muted" role="status">
              {progress.phase === 'building'
                ? `Building ${fileCount > 1 ? `${fileCount} files` : 'the file'}…`
                : `Downloading ${progress.percent}%`}
            </span>
          )}
          <Button onClick={onClose} disabled={Boolean(progress)}>Cancel</Button>
          {/* NEVER WAITS FOR THE COUNT. It is disabled only when the count
              has come back and said zero, because the route 404s on an empty
              selection and a download cannot show that error. While the
              count is unknown the button works: the file is built from the
              same filters either way, and making somebody wait on a figure
              they did not ask for is the count getting in the way of the
              export it exists to describe. */}
          <Button
            variant="primary"
            onClick={download}
            disabled={count?.rows === 0 || Boolean(progress)}
            phase={progress ? (progress.phase === 'building' ? 'working' : 'progress') : 'idle'}
            percent={progress?.percent ?? 0}
          >
            {!progress && <DownloadIcon width={15} height={15} />}
            {progress ? 'Working…' : (mode === 'month' ? 'Generate' : 'Export')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
