import { payableFromDays, PAYABLE_INPUTS } from '../helpers/payable';
import { formatMoney } from '../helpers/formatMoney';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useMasterSheet,
  useCreateMasterSheetRow,
  useUpdateMasterSheetRow,
  useMasterSheetCellEdit, useDealStatus, usePersonFill,
} from '../hooks/useMasterSheet';
import { useGroups } from '../hooks/useChat';
import { usePeopleFilters } from '../hooks/usePeople';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useAiStatus } from '../hooks/useAiStatus';
import { useStickyColumns } from '../hooks/useStickyColumns';
import ReviewFlag from '../components/badges/ReviewFlag';
import CellInfo from '../components/display/CellInfo';
import { popup } from '../configs/popups.config';
import { confirm } from '../configs/confirms.config';
import Select from '../components/forms/Select';
import FloatingField from '../components/forms/FloatingField';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { recomputeWarning, keepingPayable } from '../helpers/recomputeWarning';
import RecordCard, { CardList } from '../components/display/RecordCard';
import DraftNote from '../components/display/DraftNote';
import DealPreview from '../components/display/DealPreview';
import HandlerTabs from '../components/display/HandlerTabs';
import { useFormDraft } from '../hooks/useFormDraft';
import { SEARCH_FIELDS, SEARCH_ANY, searchPlaceholder } from '../configs/searchFields';
import NumberRangeFilter from '../components/filters/NumberRangeFilter';
import { flaggedColumns, orphanNotices } from '../helpers/reviewFields';
import { dateNoticesFor } from '../helpers/dateNotices';
import CellSuggestion from '../components/forms/CellSuggestion';
import { apiService } from '../configs/api.config';
import Modal from '../components/modals/Modal';
import Button, { FileButton, LinkButton } from '../components/buttons/Button';
import MasterSheetExportModal from '../components/export/MasterSheetExportModal';
import ImportDiffModal from '../components/import/ImportDiffModal';
import { COMPANY_STATUS, COMPANY_STATUS_OPTIONS } from '../configs/companyStatus';
import { SPECIAL_CASE_SWITCH } from '../configs/specialCase';
import { useReviewPending } from '../hooks/useMonthlyReview';
import { useImportFlow } from '../hooks/useImportFlow';
import { Toolbar, SearchInput } from '../components/layout/PageHeader';
import DuplicateBanner from '../components/display/DuplicateBanner';
import Pagination from '../components/layout/Pagination';
import { TableSkeleton } from '../components/display/Skeleton';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import BulkBar, { BulkAction, BulkMenu } from '../components/layout/BulkBar';
import SelectAll from '../components/forms/SelectAll';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { bulkMessage, splitHint, patchQueries, mapCachedRows } from '../hooks/useBulkActions';
import { monthLabel } from '../helpers/monthLabel';
import { countOf } from '../helpers/pluralNoun';
import {
  SearchIcon, ImportIcon, DownloadIcon, PlusIcon, TrashIcon, EditIcon, StopHandIcon,
  AlertCircleIcon, StarIcon, PaidIcon, ShouldBePaidIcon,
} from '../components/icons';
import EditableCell from '../components/forms/EditableCell';
import StatusBadge from '../components/badges/StatusBadge';
import { PERIOD, PERIOD_FILTER_OPTIONS } from '../helpers/paymentPeriod';
import PaymentPeriod from '../components/badges/PaymentPeriod';
import Toggle from '../components/forms/Toggle';
import CopyPersonDetails from '../components/forms/CopyPersonDetails';
import { setCellEditing } from '../hooks/useCellEditing';
import { paymentStartState, PAYMENT_START_CLASS } from '../helpers/paymentStartState';
// THE RATES ARE ON THE MONTHLY AMOUNT. A deliberate mirror of the API's
// own rates.helper, so the browser can paint the rated figure before the
// server answers. See helpers/rates.js.
import { withRates } from '../helpers/rates';
import { paymentStartWhyParts } from '../components/display/PaymentStartWhy';
import { formatDate } from '../helpers/formatDate';
import { useSettings } from '../hooks/useSettings';
// Filters survive walking to a row and back. See useStickyState.
import { useStickyState, useClearSticky } from '../hooks/useStickyState';
import { INTERNAL, NEVER_BANK } from '../configs/sheetValues';
// Deal Status NAMES review_monthly and end_note. Not a stored column.
import {
  DEAL_STATUS_OPTIONS, DEAL_STATUS_LABEL, DEAL_STATUS_MEANS,
  dealStatusOf, dealStatusTone,
} from '../configs/dealStatus';
import { LINK_FILTER } from '../configs/linkFilters';
import { unionOptions } from '../helpers/optionList';

const PAGE_SIZE = 50;

const PAYMENT_METHODS = ['cash', 'bank', 'crypto'];
// ===============================
// * A FLOOR, NOT A WHITELIST
// ===============================
// The route accepts any currency and the sheet already uses one ("EURO")
// that no ISO list contains. These four are what the control offers before
// the deals have been read; whatever the deals actually carry is unioned in
// on top, so a currency that appears on a new sheet is offered from then on
// without an edit here. See unionOptions.
const CURRENCIES = ['GBP', 'AED', 'EURO', 'USD'];

// Every field the row holds, in the boss's own master-sheet order. One list
// drives the whole editor — the form, its input types, and what gets sent —
// so adding a column to the sheet is one entry here, not four edits across
// this file.
/**
 * The 25 fields, grouped into steps.
 *
 * Same set, same order, same components — 25 inputs in one scroll was
 * just too long to fill in or to check, and it read as one undifferentiated
 * wall rather than five separate questions. The grouping matches the Add
 * person and Add company wizards, and follows how the sheet reads left to
 * right.
 *
 * EDITING SHOWS THEM ALL AT ONCE. Steps help when entering a row from
 * nothing; they get in the way when you opened the modal to fix one known
 * field and would have to hunt for which step it lives in. See RowModal.
 */

/**
 * ADDING IS A DIFFERENT SHAPE FROM EDITING, and this is it.
 *
 * A DEAL IS A COMPANY. That is the one thing every row in the dialog
 * shares, and it is asked once above everyone.
 *
 * THE GROUP IS THE PERSON'S. Today's sheet has no company whose handlers
 * sit in different groups, so this costs nothing now; it is here because a
 * Director and a Mid on one company legitimately can belong to different
 * groups, and a shared group would make that two trips through the form.
 * It is a MULTI field, so one person on two groups is still two rows,
 * which is how Zayn is stored today.
 *
 * EVERYTHING ELSE IS PER PERSON, because the column is. Of the 31 blocks
 * with more than one handler, 25 differ on postcode, 23 on monthly amount,
 * 23 on bank details and 22 on location. A form that asked once and
 * promised "correct it on the row afterwards" would mean correcting most
 * rows of most deals, which is the work the multi-handler form exists to
 * remove.
 *
 * Dates, label and notes agree 29 or 30 times out of 31 rather than
 * always, so they are per person too and the Copy control is what makes
 * that cheap: they are asked once in practice, just not by the form.
 */
const DEAL_KEYS = ['company'];

const PERSON_SECTIONS = [
  { title: 'Person', keys: ['personName', 'roleLabel', 'groupName', 'phone'] },
  { title: 'Money', keys: ['monthlyAmount', 'currency', 'paymentMethod', 'payableDays', 'payableAmount', 'assignedOn', 'paymentStartOn', 'presetOn', 'endOn'] },
  { title: 'Address', keys: ['location', 'doorNumber', 'postcode', 'acceptingPostals'] },
  { title: 'Banking', keys: ['bankDetails', 'accountNumber', 'sortCode'] },
  { title: 'Admin', keys: ['label', 'paidToggles', 'notes'] },
];

const PERSON_KEYS = PERSON_SECTIONS.flatMap((s) => s.keys);


/**
 * SHARED COMPONENTS, not raw inputs.
 *
 * This form used to be native <select>, <input list=…> and bare text boxes
 * while the Add person wizard next door used `Select` and `Toggle`. Two
 * forms writing the same table looked like two different products: no
 * search on a 33-item company list, a datalist whose popup is a different
 * width in every browser, and free text where the rest of the CRM shows a
 * switch.
 *
 *   pick     Select. `from` names a list off the page's own data,
 *            `suggest` is a fixed set. Both take a typed value unless
 *            `custom: false` — the sheet writes real postcodes AND
 *            "Handled internally" in one column, so a closed list would
 *            block the exact rows that need entering by hand.
 *   toggles  a pair of switches on one row.
 */
const FIELDS = [
  /**
   * ONE GROUP, and never a joined cell.
   *
   * A row belongs to exactly one group: the group filter matches it
   * exactly, the export writes a tab per group, and whatbot scopes every
   * conversation by it, so "INDIGO, MILKMAN" in one cell is a group that
   * exists nowhere.
   *
   * It was multi while it lived on the deal, which is how one person on
   * two groups became two rows. Now that the group belongs to the PERSON,
   * that case is two handler tabs instead, and the rule is the simplest
   * one there is: ONE TAB, ONE ROW.
   */
  { key: 'groupName', label: 'Group', type: 'pick', from: 'groups', custom: true, searchable: true, required: true },
  // MULTIPLE when adding. A row carries one role_label, so picking two
  // roles creates two rows, the same way the Add person wizard does it.
  // Also 'rows': role_label is parsed into role + seat, so 'Mid 1, Director'
  // parses as neither.
  // SINGLE, unlike group and company. A deal carries one role, and
  // picking several only ever produced duplicate rows of the same person.
  { key: 'roleLabel', label: 'Role', type: 'pick', from: 'roles', custom: true, searchable: true, required: true },
  { key: 'personName', label: 'Name of individual', type: 'text', required: true },
  // MULTI = 'rows', same as group and role.
  //
  // This was 'join' first, matching the sheet's own 'SG, CKA, CKU,
  // Umbrella co' cell, and that was wrong as a CONTROL. Joining makes one
  // company literally named 'A, B, C': the person does not appear on A,
  // A does not gain a handler, and the Companies page grows a junk entry.
  // Picking five companies means the person handles five, which is five
  // rows.
  //
  // Genuinely combined cells are not lost: they arrive from the sheet
  // untouched, and allowCustom still lets one be typed by hand.
  // MULTI = 'join', and no switch offering the other reading.
  //
  // Several companies is ONE cell of "SG, CKA, CKU, Umbrella co", exactly
  // as the sheet writes it. There was a toggle here letting it be rows
  // instead, and beside the groups toggle it turned this form into a
  // multiplication nobody could predict: three companies and two groups
  // was six rows or two or one depending on two switches.
  //
  // One rule each, and they are the sheet's own: a group is a ROW, a
  // company is a CELL. Somebody who genuinely needs a row per company
  // picks one and adds the next, or uses Assign on their page.
  { key: 'company', label: 'Company', type: 'pick', from: 'companies', custom: true, searchable: true, multi: 'join',
    hint: popup.dealCompaniesJoined() },
  { key: 'assignedOn', label: 'Appointment date', type: 'date' },
  { key: 'paymentStartOn', label: 'Payment start date', type: 'date' },
  { key: 'presetOn', label: 'Preset date', type: 'date' },
  { key: 'endOn', label: 'Provisional payment end date', type: 'date' },
  { key: 'payableDays', label: 'Payable days this month', type: 'number', min: 0, max: 31, step: 1 },
  { key: 'paymentMethod', label: 'Method of payment', type: 'pick', suggest: PAYMENT_METHODS, custom: false },
  { key: 'monthlyAmount', label: 'Monthly amount', type: 'number', min: 0, step: '0.01' },
  { key: 'payableAmount', label: 'Payable amount', type: 'number', min: 0, step: '0.01' },
  { key: 'currency', label: 'Currency', type: 'pick', from: 'currencies', suggest: CURRENCIES, custom: true },
  // TWO RATES ON THE DEAL, stacking with the person's own. An add on is
  // added, a fee is deducted from the result. See api shared/rates.helper.
  { key: 'addonPercent', label: 'Add on percentage', type: 'number', min: 0, max: 100, step: '0.01' },
  { key: 'feePercent', label: 'Fee percentage', type: 'number', min: 0, max: 100, step: '0.01' },
  { key: 'location', label: 'Location', type: 'pick', from: 'locations', custom: true, searchable: true },
  // Text, never numeric — the real sheet writes "In person meet" and
  // "Handled internally" in the door-number column.
  { key: 'doorNumber', label: 'Door number', type: 'pick', suggest: [INTERNAL, 'In person meet'], custom: true, searchable: true, placeholder: 'Type a door number, or pick one' },
  { key: 'postcode', label: 'Postcode', type: 'pick', suggest: [INTERNAL], custom: true, searchable: true, placeholder: 'Type a postcode, or pick one' },
  { key: 'acceptingPostals', label: 'Accepting postals', type: 'pick', suggest: ['Yes', 'No', INTERNAL], custom: true },
  { key: 'phone', label: 'Phone number', type: 'text', placeholder: '+447911123456' },
  { key: 'label', label: 'Label', type: 'text' },
  // The admin's decision, as switches, writing override_should_be_paid and
  // override_paid — the same two columns the table's own switches write,
  // so the control means one thing wherever you meet it. The sheet's raw
  // should_be_paid / paid text stays untouched and is not entered here: a
  // row added by hand has no sheet behind it to quote.
  // `fallback` is what an UNDECIDED row shows, and it is the same default
  // the table's own switches and the People page resolve against. The
  // column keeps three states (true / false / null "nobody decided"); the
  // switch only has two, so null renders as the default rather than as a
  // third UI state nobody can act on.
  { key: 'paidToggles', toggles: [
    { key: 'overrideShouldBePaid', label: 'Should be paid', fallback: true },
    { key: 'overridePaid', label: 'Paid', fallback: false },
  ] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'bankDetails', label: 'Bank details of individual', type: 'pick', suggest: [NEVER_BANK], custom: true, searchable: true },
  { key: 'accountNumber', label: 'Account number', type: 'pick', suggest: [NEVER_BANK], custom: true, searchable: true },
  { key: 'sortCode', label: 'Sort code', type: 'pick', suggest: [NEVER_BANK], custom: true, searchable: true, placeholder: '20 82 23' },
];

// Postgres gives snake_case; the API takes camelCase. Only place the two
// naming worlds meet on this page.
const COLUMN_FOR = {
  groupName: 'group_name',
  roleLabel: 'role_label',
  personName: 'person_name',
  company: 'company',
  assignedOn: 'assigned_on',
  paymentStartOn: 'payment_start_on',
  presetOn: 'preset_on',
  endOn: 'end_on',
  payableDays: 'payable_days',
  paymentMethod: 'payment_method',
  monthlyAmount: 'monthly_amount',
  payableAmount: 'payable_amount',
  currency: 'currency',
  location: 'location',
  doorNumber: 'door_number',
  postcode: 'postcode',
  acceptingPostals: 'accepting_postals',
  phone: 'phone',
  label: 'label',
  shouldBePaid: 'should_be_paid',
  paid: 'paid',
  notes: 'notes',
  bankDetails: 'bank_details',
  accountNumber: 'account_number',
  sortCode: 'sort_code',
  // The admin's decision, distinct from the sheet's own should_be_paid /
  // paid free text, which this form no longer writes.
  overrideShouldBePaid: 'override_should_be_paid',
  overridePaid: 'override_paid',
};

// A `date` column arrives as an ISO timestamp; <input type="date"> wants
// just the calendar part, and slicing is the one transform that can't shift
// the day the way a Date round-trip through the browser's timezone can.
function toDateInput(v) {
  return v ? String(v).slice(0, 10) : '';
}

// Flat list of every real form key, with the toggle pair unpacked. The
// pair is one entry in FIELDS (so it renders as one row of switches) but
// two actual columns, and everything below works in columns.
const FORM_FIELDS = FIELDS.flatMap((f) =>
  f.toggles ? f.toggles.map((t) => ({ ...t, type: 'toggle' })) : [f],
);

function rowToForm(row) {
  const form = {};
  for (const { key, type } of FORM_FIELDS) {
    const value = row?.[COLUMN_FOR[key]];
    if (type === 'toggle') {
      // NULL IS KEPT, not resolved to its default here.
      //
      // Three states live in the column (true / false / null "nobody has
      // decided") and only two in the switch. Baking the default in at
      // this point meant opening a row to fix a typo and pressing Save
      // silently recorded a payment decision on every untouched row that
      // passed through the form. The switch renders the fallback; the
      // value stays null until somebody actually moves it.
      form[key] = value === true || value === false ? value : null;
      continue;
    }
    // A 'rows' field is edited as a list even when the row holds one
    // value; a 'join' field stays the raw comma separated string and is
    // split by the control (see Field).
    const meta = FIELDS.find((f) => f.key === key);
    if (meta?.multi === 'rows') { form[key] = value ? [value] : []; continue; }
    form[key] = type === 'date' ? toDateInput(value) : value ?? '';
  }
  return form;
}

const EMPTY_FORM = {
  ...rowToForm(null),
  paymentMethod: 'cash',
  currency: 'GBP',
  payableDays: '',
  roleLabel: '',
  groupName: '',
  // WHO IS ON THE DEAL, as name-and-role pairs. Only while adding: an
  // existing row has exactly one of each, and this is the list that lets a
  // Director and a Mid be entered together. See HandlerTabs.
  // Everything a ROW carries that is not the deal itself. See
  // PERSON_SECTIONS: a handler's own columns, one set each.
  handlers: [blankHandler()],
};

/** One handler's worth of a row, at the defaults an empty row resolves to. */
function blankHandler() {
  const h = {};
  for (const key of PERSON_KEYS) {
    if (key === 'paidToggles') continue; // not a column, a pair of switches
    h[key] = '';
  }
  return {
    ...h,
    currency: 'GBP',
    paymentMethod: 'cash',
    // null, not false: an untouched row is UNDECIDED, and the switch shows
    // the fallback rather than recording a decision nobody made.
    overrideShouldBePaid: null,
    overridePaid: null,
  };
}

function Field({ field, form, onChange, options, isNew, single = false }) {
  const id = `msf-${field.key}`;

  // A pair of switches on one row. They are two halves of one question,
  // and the two-column grid was splitting them across separate rows with
  // an unrelated field in between.
  if (field.toggles) {
    return (
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {field.toggles.map((t) => {
          const decided = form[t.key] === true || form[t.key] === false;
          return (
            <label key={t.key} className="flex items-center gap-2.5">
              {/* Faded until somebody actually decides, so "defaulting to
                  this" still reads differently from "an admin set this".
                  Same treatment the table's own switches get. */}
              <span
                className={decided ? '' : 'opacity-60'}
                title={decided ? undefined : 'No decision recorded yet, showing the default'}
              >
                <Toggle
                  checked={decided ? form[t.key] : t.fallback}
                  onChange={(v) => onChange(t.key, v)}
                  label={t.label}
                />
              </span>
              <span className="field-label">{t.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  const value = form[field.key];

  // TWO KINDS OF MULTIPLE, and they are not interchangeable. See FIELDS.
  //   rows  pick several, get one ROW each (group, role)
  //   join  pick several, get one cell of "A, B, C" (company)
  // Both are available while editing, not just while adding: an existing
  // row legitimately gains a group, and the company cell in the real sheet
  // already holds "SG, CKA, CKU, Umbrella co".
  // `single` overrides the field's own multi setting for one render. The
  // group field is normally 'rows'; with several handlers on the deal it
  // becomes a plain single pick, because both at once is a cross product.
  const multiple = !single && (field.multi === 'rows' || field.multi === 'join');
  const joined = !single && field.multi === 'join';

  // A joined cell is stored as one string and edited as a list, so it is
  // split going in and re-joined coming out.
  const asList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean));

  const label = field.label;
  // A date input renders its own dd/mm/yyyy, which sits underneath a
  // resting label and shows through it. Floating from the start is the
  // only arrangement where both are readable.
  const alwaysFloat = field.type === 'date';
  const filled = multiple
    ? asList(value).length > 0
    : value !== '' && value !== null && value !== undefined;

  return (
    <FloatingField label={label} required={field.required} hint={field.hint} filled={filled || alwaysFloat}>
      {field.type === 'textarea' ? (
        <textarea id={id} className="form-textarea" rows={2} placeholder={label} value={value ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)} />
      ) : field.type === 'pick' ? (
        <Select
          id={id}
          size="form"
          multiple={multiple}
          value={multiple ? asList(value) : (value ?? '')}
          onChange={(v) => onChange(field.key, joined ? v.join(', ') : v)}
          // Derived first, the seeded list behind it. A field with only one
          // of the two is unchanged: this is how currency gains whatever the
          // deals carry without losing the four it always offered.
          options={unionOptions(field.from ? options?.[field.from] : [], field.suggest)}
          searchable={field.searchable}
          allowCustom={field.custom !== false}
          placeholder=""
        />
      ) : (
        <input
          id={id}
          className="form-control"
          type={field.type}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={label}
          value={value ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}
    </FloatingField>
  );
}

/**
 * The row editor — one form for both adding and editing, because they take
 * exactly the same fields. Only the save call differs.
 *
 * Synced and manual rows are both fully editable: the whole point of this
 * table is that the admin's version is the final one, so a sheet-sourced
 * row is a starting draft, not something to protect (which is the opposite
 * of Companies, where sync deliberately wins — see companies.repo.js).
 */
function RowModal({ row, onClose }) {
  // Every picker's list comes from the page's own data, so a role or
  // company the boss invents next month appears here on its own. Same
  // source the Add person wizard reads.
  const { data: options } = usePeopleFilters();

  const isNew = !row;
  /**
   * A NEW DEAL IS KEPT AS IT IS TYPED. An EDIT IS NOT.
   *
   * This dialog is both, and only one of them wants a draft. Adding is six
   * steps and a click on the backdrop lost every one of them. Editing
   * opens on a row that already exists: restoring another row's
   * half-finished values into it would be worse than losing them, because
   * it would look like that row's own data.
   *
   * `useFormDraft` is still called unconditionally, because hooks are, and
   * the edit case simply ignores what it returns. See hooks/useFormDraft.js.
   */
  const [draftForm, setDraftForm, drafting] = useFormDraft('add-deal-row', EMPTY_FORM);
  const [editForm, setEditForm] = useState(() => (isNew ? EMPTY_FORM : rowToForm(row)));
  const form = isNew ? draftForm : editForm;
  const setForm = isNew ? setDraftForm : setEditForm;
  /**
   * ===============================
   * * WHAT THIS PERSON'S OTHER DEALS ALREADY KNOW
   * ===============================
   * His call 2026-09-23. Phone, address and banking are facts about the
   * PERSON, so a deal can fill its blanks from one they already hold.
   *
   * EDIT ONLY for now. Adding builds several handlers at once behind tabs
   * and already has its own "Same as <name>" copy per section; a second
   * copy idiom on the same screen is two ways to do one thing.
   */
  // HER OFFER, so it goes when she is switched off: not even asked for. His call 2026-09-28.
  const ai = useAiStatus();
  const offerFill = !isNew && ai.known && !ai.locked;
  const { data: personFill } = usePersonFill(offerFill ? row?.person_id : null, row?.id);
  // Only used when adding. Editing shows every field at once, because you
  // opened it knowing which one is wrong.
  // Which handler tab is open while adding. Editing has one row and no tabs.
  const [who, setWho] = useState(0);
  // Reflects the three banking columns already reading NEVER_BANK, so
  // opening an existing row shows the switch in the state that row is in.
  const [neverBank, setNeverBank] = useState(
    () => !isNew && row?.bank_details === NEVER_BANK,
  );

  const create = useCreateMasterSheetRow();
  const update = useUpdateMasterSheetRow();
  // NO DELETE IN HERE. A deal goes from the row's own bin or the bulk bar,
  // both of which say what survives; a red button at the foot of an edit
  // form read as part of saving it.
  const error = create.error || update.error;
  const isPending = create.isPending || update.isPending;

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }


  /**
   * WHO, as name-and-role pairs while adding, and as the row's own single
   * pair while editing.
   *
   * A blank trailing row is normal (the editor always keeps one), so the
   * empty ones are dropped here rather than being written as a deal with
   * no name on it.
   */
  const handlers = isNew
    ? (form.handlers ?? []).filter((h) => String(h.personName ?? '').trim())
    : [form];


  /**
   * Whose tab is open, and the shortcuts for writing into it.
   *
   * `setHandlers` also collapses the group picks: a second handler makes
   * the group field single, so anything already chosen drops to the first
   * HERE rather than being quietly discarded at save time. Finding out
   * that two of your three groups went nowhere afterwards is the failure
   * this whole preview exists to prevent.
   */
  const current = (form.handlers ?? [])[who] ?? blankHandler();

  function setHandlers(next) {
    setForm((f) => ({
      ...f,
      handlers: next,
    }));
  }

  /**
   * PAYABLE AMOUNT FOLLOWS ITS INPUTS, here as well as on the row.
   *
   * The server recomputes it on save either way, so typing one in was
   * always provisional; what it was not was VISIBLE. Filling in a monthly
   * amount and payable days and watching Payable amount stay empty reads
   * as a field somebody still has to work out by hand, which is exactly
   * the arithmetic the CRM took over.
   *
   * An amount typed IN THE SAME EDIT is left alone: that is somebody
   * overriding the formula, not asking it to run. Same rule the inline
   * cell editor follows, and the same helper, so the form and the table
   * cannot disagree about what the figure should be.
   */
  function withPayableAmount(next, patch) {
    if ('payableAmount' in patch) return next;
    if (!PAYABLE_INPUTS.some((k) => k in patch)) return next;
    const amount = payableFromDays(next);
    return amount === null ? next : { ...next, payableAmount: String(amount) };
  }

  function setHandler(patch) {
    setHandlers((form.handlers ?? []).map(
      (h, i) => (i === who ? withPayableAmount({ ...h, ...patch }, patch) : h),
    ));
  }

  /**
   * ONE SECTION COPIED FROM THE FIRST HANDLER.
   *
   * The Copy from control at the top takes everything, which is right when
   * two handlers are alike and wrong when they share an address and
   * nothing else. Four handlers on one company usually differ on the money
   * and agree on where the post goes, so the useful unit is the section
   * rather than the person.
   *
   * VALUES, NOT A LINK. What lands is theirs to change afterwards; a copy
   * that kept tracking its source would make editing one person silently
   * edit another.
   */
  function copySection(keys) {
    const source = (form.handlers ?? [])[0];
    if (!source) return;
    const patch = {};
    for (const key of keys) {
      // Not a column: the pair of switches standing in for two.
      if (key === 'paidToggles') {
        patch.overrideShouldBePaid = source.overrideShouldBePaid;
        patch.overridePaid = source.overridePaid;
        continue;
      }
      patch[key] = source[key];
    }
    setHandler(patch);
  }

  const firstHandler = (form.handlers ?? [])[0];
  const firstName = firstHandler?.personName?.trim() || 'person 1';

  /**
   * ONE TAB, ONE ROW. There is no arithmetic left to get wrong.
   *
   * Every dimension this form ever multiplied by has been removed in turn:
   * companies became a cell, groups moved onto the person, and now a
   * person has one group. Somebody on two groups is two tabs with the same
   * name, which is what the sheet stores anyway.
   */
  const combos = (handlers.length ? handlers : [blankHandler()]).map((h) => ({
    ...(isNew ? h : {}),
    groupName: (isNew ? h.groupName : form.groupName) || 'UNKNOWN',
    roleLabel: h.roleLabel || 'Other',
    // A blank company is legitimate: those rows pay against the group.
    company: form.company ?? '',
    // What was actually PICKED, kept beside what will be WRITTEN. The
    // preview shows this one: 'Other' and 'UNKNOWN' are fallbacks the save
    // applies, and a fallback rendered as a value reads as a choice
    // somebody made. Stripped before the row is sent.
    rolePicked: h.roleLabel ?? '',
    groupPicked: (isNew ? h.groupName : form.groupName) ?? '',
  }));
  // Editing keeps the row it opened; only the EXTRA combinations become
  // new rows. So adding a second group to an existing deal leaves that
  // deal alone and adds one beside it.
  const extraRows = Math.max(0, combos.length - 1);

  async function handleSubmit(e) {
    e.preventDefault();
    // `handlers` is this form's own working state, not a column. Stripped
    // rather than sent and ignored, so the request says what it means.
    const { handlers: _editorRows, ...fields } = form;
    // `rolePicked` is the preview's copy of what was chosen before the
    // fallback, not a column. Dropped here so the request carries only
    // what the table has.
    const rows = combos.map(({ rolePicked: _r, groupPicked: _g, ...c }) => c);
    // Sequential throughout: each write logs a change and broadcasts.
    const [first, ...rest] = rows;

    if (isNew) {
      for (const c of rows) await create.mutateAsync({ ...fields, ...c });
    } else {
      await update.mutateAsync({ id: row.id, fields: { ...fields, ...first } });
      // The row being edited already exists, so the remaining combinations
      // are genuinely new deals rather than duplicates of it.
      for (const c of rest) await create.mutateAsync({ ...fields, ...c });
    }
    // Saved for real, so there is nothing left to pick up.
    if (isNew) drafting.clear();
    onClose();
  }

  // The three the parser cannot do without. Everything else can be filled
  // in later, which is the whole reason the steps are skippable.
  //
  // While ADDING, name and role live in the handlers list rather than in
  // two fields, so they are checked there: at least one handler with both
  // filled in. A trailing blank row is normal and is not a failure.
  const missing = isNew
    ? [
      ...(handlers.length === 0 ? ['personName'] : []),
      ...(handlers.some((h) => !String(h.roleLabel ?? '').trim()) ? ['roleLabel'] : []),
      ...(handlers.some((h) => !String(h.groupName ?? '').trim()) ? ['groupName'] : []),
    ]
    : ['personName', 'roleLabel', 'groupName'].filter((k) => {
      const v = form[k];
      return Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
    });

  const byKey = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  return (
    <Modal wide title={isNew ? 'Add a deal' : row.person_name} onClose={onClose}>
      {isNew && drafting.restored && (
        <div className="mb-3"><DraftNote onDiscard={drafting.discard} /></div>
      )}
      {!isNew && (
        <p className="text-xs text-text-faint mb-3">
          {row.source === 'manual'
            ? 'Added here by an admin, no sheet behind it, and no sync will ever remove it.'
            : 'Came from the synced sheet. Edits stick; a new imported sheet next month can still replace them.'}
        </p>
      )}

      {/* The sync takes the human sheet as-is, so a row the strict parse
          couldn't make sense of still arrives — with the reason attached.
          This is the "CRM asks the questions, admin answers them" step. */}
      {!isNew && row.needs_review && (
        <div className="mb-3 rounded-lg bg-warning-tint p-3 text-sm">
          <p className="font-semibold text-warning mb-1">This row came in messy</p>
          <p className="text-text-muted">{row.review_reason || 'The sheet parse flagged it, with no reason given.'}</p>
          <Button
            className="mt-2"
            disabled={isPending}
            onClick={() => update.mutate({ id: row.id, fields: { ...form, needsReview: false } }, { onSuccess: onClose })}
          >
            Save and mark it sorted
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* THE DEAL, asked once and above everyone.

            A deal is a company in a group: on the live sheet 32 of the 33
            companies sit in exactly one group, and inside every
            company-and-group block every handler shares both. Asking them
            per person would let one dialog build "Nathan on A J Rayson,
            NEXUS" beside "Drew on Relia PA, INDIGO", which is two deals. */}
        {isNew && (
          <fieldset className="mb-5">
            <legend className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              The deal
              <CellInfo {...popup.askedOnce()} />
            </legend>
            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
              {DEAL_KEYS.map((key) => byKey[key]).filter(Boolean).map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  form={form}
                  onChange={set}
                  options={options}
                  isNew
                />
              ))}
            </div>
          </fieldset>
        )}

        {/* EVERYONE ON IT, a tab each. Every other column is theirs. */}
        {isNew && (
          <HandlerTabs
            handlers={form.handlers ?? []}
            active={who}
            onActive={setWho}
            onAdd={() => {
              setHandlers([...(form.handlers ?? []), blankHandler()]);
              setWho((form.handlers ?? []).length);
            }}
            onRemove={(i) => {
              const next = (form.handlers ?? []).filter((_, n) => n !== i);
              setHandlers(next);
              setWho(Math.max(0, Math.min(who, next.length - 1)));
            }}
            onCopyFrom={(from) => {
              const source = (form.handlers ?? [])[from];
              if (!source) return;
              // NAME AND ROLE ARE NOT COPIED. Copying a name would make two
              // rows for one person, which is the one thing this form must
              // never do by itself, and a role is the reason there are two
              // handlers in the first place.
              const { personName: _n, roleLabel: _r, ...rest } = source;
              setHandlers((form.handlers ?? []).map((h, i) => (i === who ? { ...h, ...rest } : h)));
            }}
          >
            {PERSON_SECTIONS.map((section) => (
              <fieldset key={section.title} className="mt-1">
                {/* A legend cannot hold a button and stay a legend in
                    every browser, so the heading row is a plain flex and
                    the fieldset keeps its own semantics through the
                    grouping alone. */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{section.title}</span>
                  {/* PER SECTION, because the section is the useful unit.
                      Four handlers on one company usually differ on the
                      money and agree on where the post goes. Not on
                      Person: copying a name makes two rows for one human,
                      and the role is why there are two handlers at all.
                      Not on the first tab either, which is the source. */}
                  {who !== 0 && section.title !== 'Person' && (
                    <Button size="sm" onClick={() => copySection(section.keys)}>
                      Same as {firstName}
                    </Button>
                  )}
                </div>

                {/* ONE SWITCH, THREE BANKING COLUMNS. "Will never be bank"
                    is one fact about a person and appears in 40-odd rows of
                    the real sheet across all three together, so picking it
                    three times was three ways to get it half done. */}
                {section.title === 'Banking' && (
                  <label className="mb-4 flex items-center gap-2.5">
                    <Toggle
                      checked={current.bankDetails === NEVER_BANK}
                      onChange={(on) => setHandler({
                        bankDetails: on ? NEVER_BANK : '',
                        accountNumber: on ? NEVER_BANK : '',
                        sortCode: on ? NEVER_BANK : '',
                      })}
                      label={NEVER_BANK}
                    />
                    <span className="field-label">{NEVER_BANK}</span>
                  </label>
                )}

                <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
                  {section.keys.map((key) => byKey[key]).filter(Boolean).map((field) => (
                    <div
                      key={field.key}
                      className={field.type === 'textarea' || field.toggles ? 'sm:col-span-2' : ''}
                    >
                      <Field
                        field={field}
                        form={current}
                        onChange={(k, v) => setHandler({ [k]: v })}
                        options={options}
                        isNew
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </HandlerTabs>
        )}

        {/* EDITING SHOWS EVERY FIELD AT ONCE. You opened this knowing which
            one is wrong; steps and tabs would make you hunt for it. */}
        {!isNew && (
          <>
            {/* ABOVE THE FIELDS, because it is about filling them. Below
                the banking switch it would read as being about banking,
                which is three of the eight columns it touches. */}
            {offerFill && (
              <CopyPersonDetails
                data={personFill}
                form={form}
                busy={isPending}
                // BLANKS ONLY, decided in the component against this form as
                // it stands, so a value typed a second ago is never
                // overwritten by one saved a month ago.
                onFill={(fields) => setForm((f) => ({ ...f, ...fields }))}
              />
            )}

            <label className="mb-4 flex items-center gap-2.5">
              <Toggle
                checked={neverBank}
                onChange={(on) => {
                  setNeverBank(on);
                  setForm((f) => ({
                    ...f,
                    bankDetails: on ? NEVER_BANK : '',
                    accountNumber: on ? NEVER_BANK : '',
                    sortCode: on ? NEVER_BANK : '',
                  }));
                }}
                label={NEVER_BANK}
              />
              <span className="field-label">{NEVER_BANK}</span>
            </label>

            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
              {FIELDS.map((field) => (
                <div
                  key={field.key}
                  className={field.type === 'textarea' || field.toggles ? 'sm:col-span-2' : ''}
                >
                  <Field field={field} form={form} onChange={set} options={options} isNew={false} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Say the consequence before the button is pressed, the same way
            the Add person wizard and Add deal do. */}
        {/* Say the consequence before the button is pressed, and say it as
            the rows themselves rather than as a count and a promise.
            Picking a second group quietly adding a row is the kind of thing
            you only discover afterwards on the People page, and "all with
            the figures entered here" was asking you to trust figures that
            live on a step you are no longer looking at.

            Shown on every step while adding, including the first: it is the
            running answer to "what am I about to write", which is a
            question the whole form is building towards. While editing it
            only appears once there is more than the row you opened, since
            one row saving itself needs no preview. */}
        {(isNew || extraRows > 0) && (
          <DealPreview
            existing={!isNew}
            rows={combos.map((c) => ({
              // The blanks the SAVE would fill with UNKNOWN / Other are
              // left blank here. A placeholder in a preview reads as a
              // value somebody chose, and neither can be saved anyway:
              // both fields are required.
              group: c.groupPicked,
              person: c.personName,
              role: c.rolePicked,
              company: c.company,
              // OFF THE ROW, not off the form. These moved onto each
              // handler when the tabs arrived, and the preview was left
              // reading the top-level form: every row said "no amount"
              // however much had been typed. `?? form` keeps the edit
              // path working, where the row IS the form.
              amount: c.monthlyAmount ?? form.monthlyAmount,
              currency: c.currency ?? form.currency,
              method: c.paymentMethod ?? form.paymentMethod,
            }))}
          />
        )}

        {/* The "Still needed: …" line that used to sit here is gone. It
            printed on every step including the ones holding none of the
            missing fields, so it read as an error about the step you were
            looking at. The three required fields already carry an
            asterisk, and the reason the button is disabled is now on the
            button itself, where you find out at the moment you reach for
            it. */}

        {error && <div className="mt-3"><ErrorState error={error} title="Couldn't save this deal" /></div>}

        <div className="flex justify-end gap-2 mt-4 flex-wrap">
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            {/* Save is available on every step, not just the last: a
                half-filled row is a legitimate thing to keep, which is
                why the steps are skippable in the first place. */}
            {/* The reason it is disabled lives ON it, so it is read at the
                moment somebody reaches for the button rather than printed
                under every step whether it applies there or not. */}
            <Button
              type="submit"
              variant="primary"
              disabled={isPending || missing.length > 0}
              title={
                missing.length > 0
                  ? `Still needed: ${missing.map((k) => byKey[k].label).join(', ')}`
                  : undefined
              }
            >
              {isPending ? 'Saving…' : isNew ? 'Add deal' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// PAYMENT_METHODS is a genuinely closed set the API validates against, so a
// dropdown is right and a value outside it would be rejected.
//
// CURRENCIES IS NOT. The route stores whatever it is sent, uppercased, and
// the sheet already carries "EURO", which no ISO list has. Those four are a
// FLOOR: the currencies the deals actually use are unioned in on top, and
// the cell allows a typed one either way. This comment used to say the
// opposite, and that is the sentence that makes somebody conclude a new
// currency is impossible and stop.
//
// Groups are NOT hardcoded either. They come from whatever is in the data
// (`groupNames`, derived server-side), and the cell offers them as
// suggestions rather than as a fixed list — so adding a seventh group is
// just typing it once, and it appears as a suggestion from then on. A
// <select> here would make the first row of any new group impossible to
// enter, which is exactly the trap this avoids.

// snake_case column -> the camelCase field the API accepts, plus the
// human name used in an error toast ("Couldn't save payable amount").
// Anything absent from here is NOT editable, which is how id, sync_key,
// source, status and the override columns stay read-only: status is
// derived from the end date, and the overrides belong to the People page.
const EDITABLE = {
  group_name: ['groupName', 'group'],
  role_label: ['roleLabel', 'role'],
  person_name: ['personName', 'name'],
  company: ['company', 'company'],
  assigned_on: ['assignedOn', 'appointment date'],
  payment_start_on: ['paymentStartOn', 'payment start date'],
  preset_on: ['presetOn', 'preset date'],
  end_on: ['endOn', 'end date'],
  payable_days: ['payableDays', 'payable days'],
  payment_method: ['paymentMethod', 'payment method'],
  monthly_amount: ['monthlyAmount', 'monthly amount'],
  payable_amount: ['payableAmount', 'payable amount'],
  currency: ['currency', 'currency'],
  addon_percent: ['addonPercent', 'add on percentage'],
  fee_percent: ['feePercent', 'fee percentage'],
  location: ['location', 'location'],
  door_number: ['doorNumber', 'door number'],
  postcode: ['postcode', 'postcode'],
  accepting_postals: ['acceptingPostals', 'accepting postals'],
  phone: ['phone', 'phone'],
  label: ['label', 'label'],
  notes: ['notes', 'notes'],
  bank_details: ['bankDetails', 'bank details'],
  account_number: ['accountNumber', 'account number'],
  sort_code: ['sortCode', 'sort code'],
  // whatbot's own payday answer, correctable by hand — see the route's
  // PAYMENT_OUTCOMES for why it's a closed set and not free text.
  payment_outcome: ['paymentOutcome', 'confirmation'],
};

// Every outcome a payday check can end in, same set and same order as the
// People page's own filter (PeoplePage.jsx) and payment_status's CHECK
// (migrations 004 and 021). Blank is the real extra state: nobody has been
// asked yet. Labelled, because 'not_received' is a column value, not
// something an admin should have to read in a dropdown.
const PAYMENT_OUTCOMES = [
  { value: 'sent', label: 'Awaiting reply' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'partial', label: 'Partial' },
  { value: 'not_received', label: 'Not received' },
  { value: 'no_response', label: 'No response' },
];

// A thin wrapper so each cell in the row stays one line. Owns the
// snake_case -> camelCase translation and the editing guard, both of
// which are the same for every column.
//
// It also decides whether THIS column is what got the row flagged. The
// row carries one `review_reason` for the whole row, and that used to be
// shown as a chip on the name — the one column that is never the thing at
// fault. helpers/reviewFields.js maps the reason back to the columns that
// produced it, so the marker lands where the problem is.
/**
 * `valueFrom` lets a cell READ one field while its column name is another.
 *
 * Only payment period uses it. It once let that cell OPEN on the derived
 * value and SAVE to the stored `status`, which was the override; that is
 * gone (2026-09-09) and the cell is a badge, so this is now just "show
 * `payment_period` under the column named `status`".
 *
 * Kept rather than collapsed, because the column key is what `flaggedColumns`
 * and the editing guard are keyed on, and `status` is still the stored name
 * everywhere else.
 */
// `after` is one more marker beside the value, on the same rule as the
// review flag: an icon, never inline text.
/**
 * ===============================
 * * DEAL STATUS, AND IT IS NOT A STORED COLUMN
 * ===============================
 * `EditableCell` DIRECTLY, not through `Cell`. That wrapper reads its
 * value out of `row[col]` and gates editing on EDITABLE, and Deal Status
 * is neither: it is DERIVED from `review_monthly` and `end_note`, and it
 * writes through its own route because neither column is hand editable.
 *
 * ACTIVE SAYS ACTIVE. It drew a faint dot at first, on the reasoning that
 * a column of badges all saying the same thing is noise. His call
 * 2026-09-22: a status column that leaves the commonest status blank makes
 * you work out whether the cell is empty or the deal is ordinary.
 */
function DealStatusCell({ row, onPick }) {
  const status = dealStatusOf(row);
  return (
    <EditableCell
      value={status}
      type="select"
      options={DEAL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      // EVERY DEAL IS ONE OF THE THREE. The blank option every other
      // select offers would send nothing, and the route refuses it: a
      // choice on screen that cannot work. Found in the browser 2026-09-22.
      clearable={false}
      title={DEAL_STATUS_MEANS[status]}
      display={<StatusBadge status={dealStatusTone(status)} label={DEAL_STATUS_LABEL[status]} />}
      onSave={(value) => onPick(row, value)}
    />
  );
}

function Cell({ row, col, valueFrom, type = 'text', options, suggestions, className, display, after, onSave }) {
  const meta = EDITABLE[col];
  const readCol = valueFrom ?? col;
  const flagged = row.needs_review ? flaggedColumns(row.review_reason)[col] : undefined;
  const shown = display ?? (type === 'date' ? formatDate(row[readCol]) : undefined);
  const isEmpty = row[readCol] === null || row[readCol] === undefined || row[readCol] === '';

  return (
    <EditableCell
      value={row[readCol]}
      type={type}
      options={options}
      suggestions={suggestions}
      // NO YELLOW WASH ON THE CELL. The ReviewFlag icon below already says
      // this cell needs a check, and says why on hover and on click. A
      // tinted background repeats that less precisely, reads as "this value
      // is wrong" when the value is often fine, and turns a table with a
      // few flags into a table that looks broken. One marker per fact.
      className={className ?? ''}
      editable={Boolean(meta)}
      /* MARKERS SIT AT THE CELL'S RIGHT EDGE, not straight after the value.
         Trailing the value put them at a different x on every row, so a
         column of them could not be read down at a glance and a short date
         hid its own icon in the middle of the cell. */
      display={
        flagged || after ? (
          <span className="flex w-full items-center gap-1.5">
            <span className="min-w-0 truncate">{shown ?? (isEmpty ? '—' : String(row[col]))}</span>
            {/* ===============================
                * title="" KILLS THE NATIVE TOOLTIP OVER THE REAL ONE
                * ===============================
                The cell carries `title="Click to edit ..."`, and a browser
                draws that itself, above every z-index there is: hovering a
                marker popped the grey box straight over the panel the
                marker had just opened. An empty title on a descendant is
                how the spec says "no advisory information here", so the
                cell keeps its affordance and the icons keep their popups.
                Same fault as the <title> element on the trend chart. */}
            <span title="" className="ml-auto flex shrink-0 items-center gap-1">
              {flagged && <ReviewFlag reason={flagged} />}
              {after}
            </span>
          </span>
        ) : (
          shown
        )
      }
      title={meta ? `Click to edit ${meta[1]}` : undefined}
      onEditingChange={setCellEditing}
      onSave={(next) => onSave({
        id: row.id,
        fields: { [meta[0]]: next },
        subject: row.person_name,
        label: meta[1],
      })}
    />
  );
}

// Row click still opens the editor (established pattern — see
// CompaniesPage's own CompanyRow) — this adds an explicit Actions column
// on top of that, same reasoning as CompaniesPage's trailing "Notes"
// button: clicking a row to edit it isn't discoverable on its own.
/**
 * One of the deal's two rates, warning when the person carries one too.
 *
 * THE TWO STACK. The warning is the whole point: 3 typed on a person
 * already holding 5 costs 8, and 8 is the figure nobody expects.
 */
const RATE_COL = { addon: 'addon_percent', fee: 'fee_percent' };
const PERSON_RATE_COL = { addon: 'person_addon_percent', fee: 'person_fee_percent' };

function RateCell({ row, kind, onSave }) {
  const personPercent = Number(row[PERSON_RATE_COL[kind]]) || 0;
  const dealPercent = Number(row[RATE_COL[kind]]) || 0;

  return (
    <Cell
      row={row} col={RATE_COL[kind]} type="number" className="tabular-nums"
      display={dealPercent > 0 ? `${dealPercent}%` : '—'}
      after={personPercent > 0
        ? <CellInfo {...popup.rateStacks({ kind, personPercent, dealPercent })} />
        : null}
      onSave={onSave}
    />
  );
}

/**
 * "This deal is missing a handler, or a company, or both."
 *
 * Not a plain warning: it names what the admin can do about it. A deal
 * whose person was deleted is a decision waiting to be made (reassign it,
 * or delete the row) rather than a mistake to correct, and an icon that
 * only said "problem" would leave them working out the options for
 * themselves. Hover and click, like every other cell marker here.
 */
function OrphanFlag({ row }) {
  const notices = orphanNotices(row);
  if (notices.length === 0) return null;

  return (
    <CellInfo {...popup.orphanNotices(notices)} />
  );
}

/**
 * The three date cells' markers, ready to drop into a Cell's `after`.
 *
 * ONLY THESE THREE COLUMNS get a marker that can write. Everywhere else an
 * empty cell is a question for a human and gets a CellInfo, which explains
 * and decides nothing. Here the sheet's own formulas mean the empty cell
 * has an answer, so the popup carries the button that fills it.
 *
 * helpers/dateNotices.js decides which cell says what; this turns each one
 * into the component and hands the patch to the ordinary cell-save path, so
 * an accepted suggestion is optimistic like every other write on this page.
 */
function dateSuggestions(row, onCellSave, useEndDate) {
  const out = {};
  const notices = dateNoticesFor(row, { useEndDate });

  /**
   * ===============================
   * * ONE CELL, ONE ICON
   * ===============================
   * The payment start cell had TWO: a suggestion offering a date, and the
   * colour explanation beside it. Two marks in one cell is a key somebody
   * has to learn before either can be read, and the rule is that extra
   * information in a cell is AN icon, singular.
   *
   * So the colour explanation is stacked INSIDE the suggestion when there
   * is one, and the suggestion's tone wins: an offer to fill a date is work
   * and outranks context. Where there is no suggestion the cell still gets
   * its one icon, from the branch below.
   */
  const why = paymentStartWhyParts({
    start: row.payment_start_on,
    preset: row.preset_on,
    end: row.end_on,
    useEndDate,
    specialCaseDeal: row.special_case_deal,
  });
  const startNotice = notices.payment_start_on;
  notices.payment_start_on = startNotice
    ? {
      ...startNotice,
      body: [...[startNotice.body].flat(), `**${why.label}.** ${[why.body].flat().join(' ')}`],
    }
    : { tone: why.tone, label: why.label, body: why.body };

  /**
   * ===============================
   * * THE SWITCH GOES WHERE THE PROBLEM IS
   * ===============================
   * `special_case_deal`, migration 064. You see a red payment start cell, you
   * click the icon to ask why, and the switch that changes it is in the
   * same panel. Not a table column: ninety one rows out of ninety two
   * would say the same thing.
   *
   * ON THE PAYMENT START CELL ALONE, because that is the cell the decision
   * is about and the one whose colour it moves.
   */
  /**
   * "A SPECIAL CASE", his call 2026-09-23, and the word is the point. It
   * read "Pay this deal for September 2026", which describes the EFFECT
   * and sounds like any other way of paying somebody. What the switch
   * actually does is except this row from the rule the other ninety one
   * follow, and the label should say so before it is flipped rather than
   * after somebody wonders why one row disagrees with its own dates.
   *
   * THE MONTH IS IN THE PANEL, NOT THE LABEL. His words are the label, and
   * the exception is still for ONE month: the line above it already reads
   * "Nothing owed. Starts after this month", and the cell the panel hangs
   * off is the payment start. Repeating the month in the switch made it
   * the longest line in a panel whose job is to be read at a glance.
   *
   * A row with no preset is the standing roster and already owed, so it
   * never needs this and never sees it.
   */
  notices.payment_start_on.switchLabel = SPECIAL_CASE_SWITCH;
  notices.payment_start_on.switchOn = Boolean(row.special_case_deal);
  notices.payment_start_on.switchFields = (on) => ({ specialCaseDeal: on });

  for (const [column, notice] of Object.entries(notices)) {
    out[column] = (
      <CellSuggestion
        tone={notice.tone}
        label={notice.label}
        body={notice.body}
        accept={notice.accept}
        switchLabel={notice.switchLabel}
        switchOn={notice.switchOn}
        onSwitch={notice.switchFields
          ? (on) => onCellSave({
            id: row.id,
            fields: notice.switchFields(on),
            subject: row.person_name,
            label: on ? 'Paying this month' : 'Back to the dates',
          })
          : undefined}
        // No `fields` is a marker with nothing to write: a date somebody
        // typed over the formula is reported and never corrected.
        onAccept={notice.fields
          ? () => onCellSave({
            id: row.id,
            fields: notice.fields,
            subject: row.person_name,
            label: notice.saveLabel,
          })
          : undefined}
      />
    );
  }

  return out;
}

/**
 * One deal as a card, for phones.
 *
 * TWENTY SIX COLUMNS DO NOT FIT, and trimming to five still would not: the
 * problem is the shape, not the count. So the card answers the question a
 * phone is actually holding ("what does this person earn here, and have
 * they been paid") and everything else is one tap away in the editor.
 *
 * NO SWITCHES ON THE CARD ANY MORE. Should be paid and Paid are the bulk
 * bar's now: tick the card (or several) and set them there, one place for
 * the act on every screen size.
 */
function DealCard({ row, selected, onToggleSelect, onEdit }) {
  const notices = orphanNotices(row);

  return (
    <RecordCard
      // THE SAME TICK THE TABLE HAS, top left, so a phone fills the bulk
      // bar too.
      selected={selected}
      onSelect={() => onToggleSelect(row.id)}
      selectLabel={`Select ${row.person_name ?? 'this deal'}`}
      title={row.person_name ?? '(no handler)'}
      subtitle={[row.company, row.group_name, row.role_label].filter(Boolean).join(' · ')}
      lead={formatMoney(row.payable_amount, row.currency)}
      leadLabel="payable"
      onOpen={() => onEdit(row)}
      badges={
        <>
          {/* Both non-active states, said apart. One `badge-ended` hardcoded
              here meant a row that had not started announced itself as one
              that was over. StatusBadge owns the words. */}
          {row.payment_period && row.payment_period !== PERIOD.ACTIVE && (
            <StatusBadge status={row.payment_period} />
          )}
          {notices.map((n) => (
            <span key={n.title} className="badge badge-in_progress">{n.title}</span>
          ))}
          {row.needs_review && <span className="badge badge-in_progress">Needs a check</span>}
        </>
      }
      facts={[
        { label: 'Monthly', value: formatMoney(row.monthly_amount, row.currency) },
        { label: 'Payable days', value: row.payable_days },
      ]}
    />
  );
}

/**
 * Whether a click on a row means "open the editor". Not when it landed on
 * something with its own job (the tick, an open cell's input, a marker's
 * popup button), and not when it bubbled up through a portal (a cell's
 * dropdown list is drawn on <body> but React still routes its clicks here).
 */
const OWN_CLICK = 'input, select, textarea, button, a, label, [role="button"], [role="menu"], [role="listbox"], [role="option"], [data-editable-cell]';
function opensRow(e) {
  if (!e.currentTarget.contains(e.target)) return false;
  if (e.target.closest(OWN_CLICK)) return false;
  // The padding of a cell that is open for editing is still that cell.
  if (e.target.closest('td')?.querySelector('input, select, textarea, [role="combobox"]')) return false;
  // A drag to select text is reading, not opening.
  return !window.getSelection?.()?.toString();
}

const SheetRow = memo(function SheetRow({
  row, selected, onToggleSelect, onEdit, onCellSave, onDealStatus, groups, options,
  colorUsesEndDate, cryptoPercent = 0,
}) {
  // The three date columns, and only those. Accepting one writes the WHOLE
  // patch through the same optimistic hook as any other cell edit, so the
  // row repaints before the request lands and rolls back if it fails.
  const dateMarkers = dateSuggestions(row, onCellSave, colorUsesEndDate);
  /**
   * THE SAME ROW, WITH ITS RATES SHOWING.
   *
   * Returns the SAME OBJECT when nothing applies, which is most rows, so
   * `memo` above still sees an unchanged prop and skips the re-render.
   *
   * OPTIMISTIC BY CONSTRUCTION. It is computed from the cached row, so the
   * moment a rate write patches that row the figure repaints, with no
   * second round trip to find out what the server made of it.
   */
  const rated = withRates(row, { cryptoPercent });

  return (
    // THE ROW OPENS THE FULL EDITOR, now the Actions column is gone. An
    // editable cell stops its own click, so a click on a value still edits
    // that value in place; only the rest of the row lands here. See
    // opensRow for what it refuses.
    <tr
      className={`cursor-pointer hover:bg-surface-sunken ${selected ? 'row-selected' : ''}`}
      tabIndex={0}
      role="link"
      aria-label={`Edit ${row.person_name ?? 'this deal'}`}
      onClick={(e) => { if (opensRow(e)) onEdit(row); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onEdit(row); }
      }}
    >
      <td className="td sticky-col w-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(row.id)}
            aria-label={`Select ${row.person_name ?? 'this deal'}`}
          />
          {/* A ROW-LEVEL marker, at the start of the row, because losing a
              handler or a company is a fact about the whole deal rather
              than about one value being wrong. The import flags stay on
              the column that caused them; this one has no single guilty
              column, so it sits where the row begins. */}
          <OrphanFlag row={row} />
        </div>
      </td>
      {/* Name leads, and it is the ONLY frozen column besides the
          checkbox. Freezing group and role too ate a third of the screen
          on a laptop and still left you scrolling — the one thing you
          actually need pinned while reading across is whose row it is.

          It keeps its badges, so it renders its own display rather than
          the plain value. Still editable: a mis-transcribed name is one
          of the commonest things needing a fix. */}
      <Cell
        row={row}
        col="person_name"
        className="sticky-col sticky-edge"
        onSave={onCellSave}
        display={
          <>
            <span className="font-semibold">{row.person_name}</span>
            {row.source === 'manual' && (
              <span className="badge badge-in_progress ml-2" title="Added by an admin, not from the sheet">
                added
              </span>
            )}
            {/* The row-level "check" chip used to sit here. It has moved
                to whichever column actually caused the flag — this is the
                one column that is never the problem. */}
          </>
        }
      />
      <Cell row={row} col="group_name" type="combo" suggestions={groups} onSave={onCellSave} />
      <Cell row={row} col="role_label" type="combo" suggestions={options?.roles ?? []} onSave={onCellSave} />
      {/* Single, and typeable. Several companies is several ROWS, and a
          cell edit that silently created rows is the same surprise group
          and role were kept out of. The row editor asks first and says how
          many. A genuinely combined name is still typed here by hand. */}
      {/* A BADGE, NEVER A STATUS. Liquidation is a fact about the deal's
          COMPANY, and three things have been called status already. It does
          not move the payment start tint beside it: that answers whether
          payment is running this month, and in liquidation it is, for less. */}
      <Cell
        row={row}
        col="company"
        type="combo"
        suggestions={options?.companies ?? []}
        onSave={onCellSave}
        display={
          <>
            {row.company}
            {row.company_status === COMPANY_STATUS.LIQUIDATION && (
              <span className="badge badge-liquidation ml-2" title="This company is winding down">
                liquidation
              </span>
            )}
          </>
        }
      />
      <Cell row={row} col="assigned_on" type="date" onSave={onCellSave} after={dateMarkers.assigned_on} />
      {/* GREEN, AMBER, RED off the boss's own rule. Repaints on the
          optimistic row, so it moves the moment the preset changes rather
          than when the server replies. */}
      <Cell
        row={row}
        col="payment_start_on"
        type="date"
        className={PAYMENT_START_CLASS[
          paymentStartState(
            row.payment_start_on, row.preset_on, row.end_on, colorUsesEndDate,
            row.stopped_on, row.special_case_deal,
          )
        ]}
        onSave={onCellSave}
        // THE COLOUR EXPLAINS ITSELF, on every row. Three tints across 96
        // rows and nothing on the row saying which rule painted it, least
        // of all the one that matters: a deal that ended months ago is
        // GREEN while the end date is out of the formula, and its amount is
        // still in the month's total.
        //
        // ONE ICON. The explanation is folded into the date suggestion
        // where there is one, rather than sitting beside it. See
        // dateSuggestions.
        after={dateMarkers.payment_start_on}
      />
      <Cell row={row} col="preset_on" type="date" onSave={onCellSave} />
      {/* The sheet's own "Provisional payment end date" — often the literal
          text "Ongoing" rather than a date, which formatDate passes through
          as-is (it only formats real dates). Left as a date picker anyway:
          the picker is how you'd replace "Ongoing" with a real date, and
          clearing it is how you'd put it back to open-ended. */}
      {/* ===============================
           * HIS WORDS SIT WHERE THE DATE WOULD
           * ===============================
           * 31 of 92 rows on his September sheet hold a phrase here rather
           * than a date. The cell is EMPTY, so there is no value for an
           * icon to sit beside and a bare marker over a dash says nothing.
           * The words become the cell's display, the same way `Ongoing` and
           * `Will never be bank` already show, and the marker beside them
           * says which kind it is. Editing still writes a date. */}
      {/* ===============================
           * A DATE, OR NOTHING. The words moved to Deal Status.
           * ===============================
           The tag only ever lived here to explain why the cell was blank,
           because there was no status column to put it in. There is one
           now, immediately after this, so the explanation has its own home
           and the two columns stop saying the same thing twice. His call
           2026-09-22.

           THE EXPORT STILL WRITES THE WORDS HERE, and deliberately: his
           own sheet has no status column, so that is where he puts them.
           See buildWorkbook's endCellTag. */}
      <Cell
        row={row}
        col="end_on"
        type="date"
        onSave={onCellSave}
        after={dateMarkers.end_on}
      />
      {/* ===============================
           * DEAL STATUS, and it is not a stored column
           * ===============================
           It NAMES `review_monthly` and `end_note`: the tick and his
           word. One fact, so setting Active here takes the deal out of the
           monthly review AND shows it unticked in the company's checklist
           next visit. See configs/dealStatus.js.

           Active draws nothing. Most rows are active, and a column of
           badges saying so is a column of noise. */}
      <DealStatusCell row={row} onPick={onDealStatus} />
      <Cell row={row} col="payable_days" type="number" className="tabular-nums" onSave={onCellSave} />
      <Cell row={row} col="payment_method" type="select" options={PAYMENT_METHODS} onSave={onCellSave} />
      {/* ===============================
           * THE FIGURE SHOWN IS RATED. THE VALUE EDITED IS THE WAGE.
           * ===============================
           * `display` is the rated figure, 4,935 for a 4,700 wage on 5%,
           * exactly what the export writes and what his own sheet holds.
           * `row` is still the stored row, so opening the cell puts 4,700
           * in it: you edit the wage, and the rate follows on its own.
           *
           * The icon only appears where a rate applies. On ninety clean
           * rows it would be noise. */}
      <Cell
        row={row} col="monthly_amount" type="number" className="tabular-nums"
        display={formatMoney(rated.monthly_amount, row.currency)} onSave={onCellSave}
        after={rated.rate_parts
          ? <CellInfo {...popup.rateBreakdown({
            parts: rated.rate_parts.monthly,
            percent: rated.rate_parts.percent,
            currency: row.currency,
            money: formatMoney,
          })} />
          : null}
      />
      <Cell
        row={row} col="payable_amount" type="number" className="tabular-nums"
        display={formatMoney(rated.payable_amount, row.currency)} onSave={onCellSave}
        after={rated.rate_parts
          ? <CellInfo {...popup.rateBreakdown({
            parts: rated.rate_parts.payable,
            percent: rated.rate_parts.percent,
            currency: row.currency,
            money: formatMoney,
          })} />
          : null}
      />
      <Cell row={row} col="currency" type="suggest" suggestions={unionOptions(options?.currencies, CURRENCIES)} onSave={onCellSave} />
      <RateCell row={row} kind="addon" onSave={onCellSave} />
      <RateCell row={row} kind="fee" onSave={onCellSave} />
      <Cell row={row} col="location" onSave={onCellSave} />
      <Cell row={row} col="door_number" onSave={onCellSave} />
      <Cell row={row} col="postcode" onSave={onCellSave} />
      <Cell row={row} col="accepting_postals" onSave={onCellSave} />
      <Cell row={row} col="phone" onSave={onCellSave} />
      <Cell row={row} col="label" onSave={onCellSave} />
      <Cell
        row={row} col="notes" className="max-w-48 truncate" onSave={onCellSave}
        display={row.notes || '—'}
      />
      <Cell
        row={row} col="bank_details" className="max-w-48 truncate" onSave={onCellSave}
        display={row.bank_details || '—'}
      />
      <Cell row={row} col="account_number" onSave={onCellSave} display={row.account_number || '—'} />
      <Cell row={row} col="sort_code" onSave={onCellSave} display={row.sort_code || '—'} />
      {/* Editable, like every other cell here. It is derived from the end
          date on import, but the sheet's end dates are frequently prose
          ("Ongoing", "TBC"), so the derived answer is wrong often enough
          that a human needs to be able to say otherwise. */}
      {/* READ ONLY, and `status` was never in EDITABLE so this cell never
          opened anyway. The select options it carried were inert, and they
          are gone with the three cells that really could set it. The period
          is a function of the payment start tint: green or amber is Active,
          red is Ended or Not yet paying. Change a date, not this. */}
      <Cell
        row={row}
        col="status"
        valueFrom="payment_period"
        onSave={onCellSave}
        display={<PaymentPeriod period={row.payment_period} />}
      />
      {/* whatbot's own payday confirmation, mirrored from payment_status
          (migration 016) — the person's answer, distinct from both columns
          above (the sheet's text, and the admin's decision). Editable, like
          everything else here: the admin is the final word on this table,
          and a reply the bot misread or never got is exactly the case that
          needs correcting by hand. */}
      <Cell
        row={row} col="payment_outcome" type="select" options={PAYMENT_OUTCOMES}
        display={row.payment_outcome ? <StatusBadge status={row.payment_outcome} /> : '—'}
        onSave={onCellSave}
      />
    </tr>
  );
});

/**
 * ===============================
 * * THE BAR'S WRITES, ON SCREEN BEFORE THE SERVER ANSWERS
 * ===============================
 * The same deal is cached three ways: the sheet's `{ rows, total }`, and a
 * person's and a company's `{ person|company: { deals } }`. Each returns
 * the rollback useBulkActions runs if the write fails.
 */
const BULK_COLUMN = { ...COLUMN_FOR, specialCaseDeal: 'special_case_deal' };

function eachDeal(data, fn) {
  for (const side of ['person', 'company']) {
    if (Array.isArray(data?.[side]?.deals)) {
      const deals = mapCachedRows(data[side].deals, fn);
      return deals === data[side].deals ? data : { ...data, [side]: { ...data[side], deals } };
    }
  }
  return mapCachedRows(data, fn);
}

// Fields onto the ticked deals wherever they are cached. `skipStopped`
// leaves a stopped deal alone, as the server does.
function setOnDeals(qc, ids, fields, { skipStopped = false } = {}) {
  const want = new Set(ids);
  const cols = Object.fromEntries(Object.entries(fields).map(([k, v]) => [BULK_COLUMN[k] ?? k, v]));
  return patchQueries(qc, [['master-sheet'], ['person'], ['company']], (data) => eachDeal(data, (r) => (
    want.has(r.id) && !(skipStopped && r.stopped_on) ? { ...r, ...cols } : r
  )));
}

// Off the live sheet: a Stop sends them to the Archive, a Delete away. The
// Archive's own list is under the same prefix, and they are not in it.
function dropFromSheet(qc, ids) {
  const want = new Set(ids);
  return patchQueries(qc, [['master-sheet']], (data) => mapCachedRows(data, (r) => (want.has(r.id) ? null : r)));
}

/**
 * ===============================
 * * ONE FIELD ONTO EVERY TICKED DEAL
 * ===============================
 * The bar's Edit. Only the columns that are genuinely the same across a
 * block of deals: a method, a currency, a group, a preset month, a
 * location. Names, amounts and banking differ row by row, so setting one
 * on six deals at once is a mistake waiting for a click.
 *
 * `month` is the preset: the boss's period marker is a month, and the
 * first of it is what the sheet stores.
 */
const BULK_EDIT_FIELDS = [
  { key: 'paymentMethod', label: 'Payment method', from: 'methods', closed: true },
  { key: 'currency', label: 'Currency', from: 'currencies' },
  { key: 'groupName', label: 'Group', from: 'groups', searchable: true },
  { key: 'presetOn', label: 'Preset month', type: 'month' },
  { key: 'location', label: 'Location', from: 'locations', searchable: true },
];

function BulkEditModal({ field, rows, options, busy, onClose, onApply }) {
  const [value, setValue] = useState('');
  const isMonth = field.type === 'month';
  const sent = isMonth && value ? `${value}-01` : value;
  const fields = { [field.key]: sent };
  // THE SAME WARNING THE CELL GIVES, counted across the ticked rows. A
  // preset move recomputes the payable amount, and on a row somebody typed
  // that figure into by hand, the typed one goes.
  const wiped = sent ? rows.filter((r) => recomputeWarning(r, fields)).length : 0;
  const shown = isMonth ? monthLabel(value, true) : value;
  const n = rows.length;

  return (
    <Modal title={`${field.label} on ${n} ${n === 1 ? 'deal' : 'deals'}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (sent) onApply(fields, field.label, shown);
        }}
      >
        <FloatingField label={field.label} filled={isMonth || Boolean(value)}>
          {isMonth ? (
            <input
              type="month"
              className="form-control"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={field.label}
            />
          ) : (
            <Select
              size="form"
              value={value}
              onChange={(v) => setValue(v ?? '')}
              options={options[field.from] ?? []}
              searchable={field.searchable}
              allowCustom={!field.closed}
              placeholder=""
            />
          )}
        </FloatingField>

        {wiped > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2.5 text-sm text-warning" role="alert">
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" />
            <p className="m-0">
              {wiped} of these {wiped === 1 ? 'has' : 'have'} a payable amount typed by hand.
              Changing the preset recomputes it from the formula, and the typed figure goes.
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button size="md" onClick={onClose}>Cancel</Button>
          <Button size="md" type="submit" variant="primary" disabled={!sent || busy} phase={busy ? 'working' : 'idle'}>
            {busy ? 'Applying…' : `Apply to ${n}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function MasterSheetPage() {
  // Roles and companies for the multi-select cells. Same source the row
  // editor uses, so a company typed into a cell appears in the modal too.
  const { data: filterOptions } = usePeopleFilters();
  const forgetFilters = useClearSticky('masterSheet.');
  // Both take a seed off the link that opened the page, so the dashboard's
  // ring and its group bars land on the rows they counted. See linkFilters.
  const [group, setGroup] = useStickyState('masterSheet.group', '', LINK_FILTER.group);
  const [source, setSource] = useStickyState('masterSheet.source', '');
  // Two CLOSED SETS off the sheet's own values, so both are filters rather
  // than search fields: three or four options each, and typing 'GBP' into a
  // box is worse than picking it.
  const [currency, setCurrency] = useStickyState('masterSheet.currency', '');
  const [paymentMethod, setPaymentMethod] = useStickyState('masterSheet.paymentMethod', '');
  // THE DEAL'S OWN STATUS, beside the company's. The column and the
  // dropdown shipped 2026-09-22 with no way to narrow by them, so "which
  // are going concerns" meant reading the whole sheet.
  const [dealStatus, setDealStatus] = useStickyState('masterSheet.dealStatus', '');
  // A DEAL PAID A MONTH ITS DATES EXCLUDE. Her filter answers this and the
  // page could not, so the same question had two answers. '' is any,
  // 'true' and 'false' are the two real sides: "which are NOT special"
  // is a question somebody asks.
  const [specialCase, setSpecialCase] = useStickyState('masterSheet.specialCase', '');
  // NOT the monthly review. This is "the import could not settle this row",
  // and the link param is named needsReview so the two cannot be confused.
  const [review, setReview] = useStickyState('masterSheet.review', '', LINK_FILTER.needsReview); // '' | 'true' | 'false'
  const [status, setStatus] = useStickyState('masterSheet.status', '', LINK_FILTER.period); // '' | one of PERIOD
  // undefined, not 'false', when cleared: the filter has to disappear
  // rather than become a filter for the opposite value.
  const [shouldBePaid, setShouldBePaid] = useStickyState('masterSheet.shouldBePaid', undefined); // undefined | 'true'
  const [paid, setPaid] = useStickyState('masterSheet.paid', undefined);
  // The deal's COMPANY status. "What have I still to set" once a company is
  // winding down is one click, not a read of ninety six rows.
  const [companyStatus, setCompanyStatus] = useStickyState('masterSheet.companyStatus', '');
  // { field, min, max } — one object, so a cleared filter is one comparison
  // and the query params travel together.
  const [amount, setAmount] = useStickyState('masterSheet.amount', {});
  const [query, setQuery] = useStickyState('masterSheet.query', '');
  // WHICH COLUMN the search box points at. Empty is everything, which is
  // what it always did, so nobody's habit breaks.
  const [searchField, setSearchField] = useStickyState('masterSheet.searchField', SEARCH_ANY);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // a row, or 'new'
  const [exporting, setExporting] = useState(false);
  // The count only, for the link below. The queue itself belongs to
  // /review, which fetches it when you get there.
  //
  // NO PANEL STATE ANY MORE. The review is a page, so Diane's briefing and
  // every other link go straight to `/review` rather than seeding a param
  // that opened a modal on this one.
  const reviewPending = useReviewPending();
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  // The bulk bar's own writes, and the two of them that ask first. None of
  // them waits: the rows change and the toast says so on the click.
  const { run: runBulk } = useBulkActions();
  const [confirmingBulkStop, setConfirmingBulkStop] = useState(false);
  // Which one field the bar's Edit is setting on every ticked deal.
  const [bulkEditing, setBulkEditing] = useState(null);

  // Parse, look, then apply. Shared with Settings and People so the diff
  // step cannot exist on one door and not the others. See useImportFlow.
  const {
    importState, busy: importing, preview, committing, rereading,
    deleting: deletingFromDiff,
    handleImport, applyImport, applyDefaults, cancelPreview, deleteRows,
  } = useImportFlow();

  const { data: groupNames } = useGroups();
  const debouncedQuery = useDebouncedValue(query);
  // Two: the checkbox and Name. Name alone answers "whose row is this",
  // which is the only question a horizontal scroll makes hard to answer.
  // Whether the end date takes part in the payment start colour. One
  // setting, read here and by the export, so the page and the file agree.
  const { data: settings } = useSettings();
  const colorUsesEndDate = Boolean(settings?.colorUsesEndDate);
  // The rail charge, one number for the whole system. Read here so every
  // row computes its rated figure from the same value the export uses.
  const cryptoPercent = Number(settings?.cryptoPercent) || 0;

  const tableRef = useStickyColumns(2, [page, group, source, review, status, shouldBePaid, paid, companyStatus, amount, debouncedQuery, searchField, currency, paymentMethod, dealStatus, specialCase]);

  // Any filter change can put the current page past the end of the new
  // result set — same reset every other paginated page here does.
  useEffect(() => setPage(1), [group, source, review, status, shouldBePaid, paid, companyStatus, amount, debouncedQuery, searchField, currency, paymentMethod, dealStatus, specialCase]);

  // Inline cell edits. Separate from the modal's own update mutation:
  // this one is optimistic, because a cell has no Save button and no
  // pending state of its own, and a ~450ms pause after every Enter is
  // what makes correcting twenty rows feel broken.
  const cellEdit = useMasterSheetCellEdit();

  /**
   * ===============================
   * * AN EDIT THAT WOULD WIPE A TYPED PAYABLE AMOUNT ASKS FIRST
   * ===============================
   * Typing into Payable amount wins in its own patch and was then silently
   * recomputed by the next edit to any of its five inputs. Someone sets
   * 5,000 by hand, moves the appointment a week later, and the row quietly
   * reads 1,935.48 with no warning and no toast.
   *
   * ONE INTERCEPT, because every inline cell on this page saves through
   * `cellEdit.mutate`. The row modal has its own and goes through the same
   * check below.
   */
  const [recompute, setRecompute] = useState(null);

  const { data: rows, total, counts, isLoading, error } = useMasterSheet({
    group: group || undefined,
    source: source || undefined,
    needsReview: review || undefined,
    status: status || undefined,
    shouldBePaid,
    paid,
    companyStatus: companyStatus || undefined,
    amountField: amount.field || undefined,
    amountMin: amount.min || undefined,
    amountMax: amount.max || undefined,
    q: debouncedQuery || undefined,
    searchField: searchField || undefined,
    currency: currency || undefined,
    paymentMethod: paymentMethod || undefined,
    dealStatus: dealStatus || undefined,
    specialCaseDeal: specialCase || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  // EVERY inline cell on this page saves through here, so the warning has
  // one place to live. The row modal goes through the same check.
  // NAMED FOR THE WRITE. `dealStatus` is the FILTER above, and one name
  // for a mutation and a query param on one page is how the wrong one gets
  // passed.
  const dealStatusWrite = useDealStatus();

  const saveCell = useCallback((patch, opts) => {
    const row = (rows ?? []).find((r) => r.id === patch?.id);
    const warn = recomputeWarning(row, patch?.fields);
    if (!warn) return cellEdit.mutate(patch, opts);
    return setRecompute({ patch, opts, row, warn });
  }, [rows, cellEdit]);

  /**
   * DEAL STATUS, its own write.
   *
   * Not through `saveCell`: that patches columns, and Deal Status is a
   * NAME for two of them that no row PATCH may carry. Optimistic, like
   * every write here, so the badge moves on the click rather than on the
   * refetch.
   */
  const pickDealStatus = useCallback(
    (row, status) => dealStatusWrite.mutate({ id: row.id, status, subject: row.person_name }),
    [dealStatusWrite],
  );

  /**
   * BULK SELECT, scoped to the rows on screen, never "every row matching
   * the filter". The hook cuts the ticks back to what is visible whenever a
   * filter, a search, a page turn or a sync changes it, so a bulk act can
   * never hit a row you can no longer see.
   */
  const visibleIds = useMemo(() => (rows ?? []).map((r) => r.id), [rows]);
  const sel = useRowSelection(visibleIds);
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => sel.has(r.id)), [rows, sel]);
  // AND A FILTER CHANGE DROPS IT OUTRIGHT. Pruning only removes rows that
  // left the screen; a widened filter would keep old ticks beside rows
  // nobody ticked, so the bar would act on a mix you never chose.
  const clearSelection = sel.clear;
  useEffect(() => { clearSelection(); }, [clearSelection, group, source, review, status, shouldBePaid, paid, companyStatus, amount, debouncedQuery, searchField, currency, paymentMethod, dealStatus, specialCase, page]);

  const groups = useMemo(() => groupNames ?? [], [groupNames]);
  // The lists the bar's Edit offers: the same ones the cells and the
  // filters already read, so a value picked in bulk is one a cell knows.
  const bulkEditOptions = useMemo(() => ({
    methods: PAYMENT_METHODS,
    currencies: unionOptions(filterOptions?.currencies, CURRENCIES),
    groups,
    locations: filterOptions?.locations ?? [],
  }), [filterOptions, groups]);

  /**
   * A SWITCH COLUMN ONTO EVERY TICKED DEAL. Should be paid, Paid and
   * Special case all skip a stopped deal: it is owed nothing, so deciding
   * its pay means nothing. The rows flip on the click, the same skip
   * applied on screen as the server applies; Undo is on the toast at once.
   */
  const bulkSwitch = useCallback((fields, verb, already) => {
    const ids = sel.ids;
    runBulk({
      call: () => apiService.masterSheet.bulkUpdate(ids, fields, { skipStopped: true }),
      optimistic: (qc) => setOnDeals(qc, ids, fields, { skipStopped: true }),
      toast: bulkMessage(verb, ids.length, 'deal'),
      report: (d) => bulkMessage(verb, d.updated.length, 'deal', [
        [d.skipped?.same, already],
        [d.skipped?.stopped, 'stopped, skipped'],
        [d.skipped?.gone, 'gone since'],
      ]),
      undoBatch: (d) => d.batchId,
      failure: `Couldn't update ${countOf(ids.length, 'deal')}`,
    });
    sel.clear();
  }, [sel, runBulk]);

  // STOP: the rows leave this list on the click (they live in the Archive
  // now) and the count drops with them.
  const bulkStop = () => {
    const ids = sel.ids;
    setConfirmingBulkStop(false);
    runBulk({
      call: () => apiService.masterSheet.bulkStop(ids),
      optimistic: (qc) => dropFromSheet(qc, ids),
      toast: { ...bulkMessage('stopped', ids.length, 'deal'), detail: 'Moved to the archive' },
      report: (d) => bulkMessage('stopped', d.stopped.length, 'deal', [[d.skipped, 'already stopped']]),
      undoBatch: (d) => d.batchId,
      failure: `Couldn't stop ${countOf(ids.length, 'deal')}`,
      icon: 'stop',
    });
    sel.clear();
  };

  // DELETE: gone on the click. No Undo, a delete has no batch to revert,
  // which is why it asks first.
  const bulkDeleteRows = () => {
    const ids = sel.ids;
    setConfirmingBulkDelete(false);
    runBulk({
      call: () => apiService.masterSheet.bulkDelete({ ids, via: 'admin' }),
      optimistic: (qc) => dropFromSheet(qc, ids),
      toast: bulkMessage('deleted', ids.length, 'deal'),
      report: (d) => bulkMessage('deleted', d.deleted?.length ?? ids.length, 'deal'),
      icon: 'trash',
      failure: `Couldn't delete ${countOf(ids.length, 'deal')}`,
    });
    sel.clear();
  };

  // ONE FIELD onto every ticked deal, from the bar's Edit.
  const bulkEdit = (fields, label, shown) => {
    const ids = sel.ids;
    setBulkEditing(null);
    runBulk({
      call: () => apiService.masterSheet.bulkUpdate(ids, fields),
      optimistic: (qc) => setOnDeals(qc, ids, fields),
      toast: bulkMessage(`set to ${shown}`, ids.length, 'deal'),
      report: (d) => bulkMessage(`set to ${shown}`, d.updated.length, 'deal', [
        [d.skipped?.same, 'already that'],
        [d.skipped?.gone, 'gone since'],
      ]),
      undoBatch: (d) => d.batchId,
      failure: `Couldn't change the ${label.toLowerCase()} on ${countOf(ids.length, 'deal')}`,
    });
    sel.clear();
  };

  // What each row's own switch SHOWS, undecided rows at their default, so
  // the hint above Yes / No counts what is on screen.
  const shownShouldBePaid = (r) => (r.override_should_be_paid === true || r.override_should_be_paid === false
    ? r.override_should_be_paid : true);
  const shownPaid = (r) => (r.override_paid === true || r.override_paid === false ? r.override_paid : false);
  const filterActive = Boolean(group || source || review || status || shouldBePaid || paid || companyStatus || amount.field || currency || paymentMethod || dealStatus || specialCase);
  const isEmpty = !isLoading && rows && rows.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">Master sheet</h1>
        {/* ONE ROW, the same shape the Expenses page uses: take a copy out,
            bring a file in, add one by hand. Add deal used to sit alone in
            the toolbar, which split three actions of the same kind across
            two rows and left the page's only create action in lighter type
            than the count beside it.

            THE PRIMARY IS LAST, where the eye lands, and it is the one that
            creates. Export and Import are quiet: one accent per row, and
            two primaries side by side means neither is primary.

            IMPORT, NOT UPLOAD. It is the pair to Export and the two read
            as one act in two directions. The only `upload` left anywhere is
            the VALUE whatbot posts as `origin`; see useImportFlow. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* ===============================
               * THE DOOR YOU WALK THROUGH WHEN YOU GO LOOKING
               * ===============================
               * The other door is a line in ExportWarnings, which comes to
               * find you. Both are needed: "is AJ Rayson still being paid"
               * is a reading question, and needing to start an export to
               * ask it is the wrong shape.
               *
               * ONLY WHEN THERE IS SOMETHING TO ANSWER. A permanent button
               * reading "Review 0" is a control that teaches you to ignore
               * it, which is the one thing this must not become. */}
          {reviewPending.count > 0 && (
            <LinkButton as={Link} to="/review" variant="warning">
              {/* The gold alert circle, which already means "work to do,
                  one press away" on CellSuggestion's marks. Not a warning
                  triangle: nothing is wrong, there is a question waiting. */}
              <AlertCircleIcon width={16} height={16} />
              Review {reviewPending.count}
            </LinkButton>
          )}
          {/* A modal, not a straight download link. The file is no longer
              one thing: it is this month's sheet or next month's, all
              groups or one. A link cannot ask, and generating the wrong
              month silently is worse than one extra click. */}
          <Button variant="quiet" onClick={() => setExporting(true)}>
            <DownloadIcon width={16} height={16} />
            Export
          </Button>
          {/* The messy human-made sheet goes in here, not into whatbot's
              upload folder: it parses in front of you and nothing is
              written until the diff is accepted. */}
          <FileButton
            disabled={importing}
            phase={importState.phase}
            percent={importState.percent}
            onChange={handleImport}
          >
            <ImportIcon width={16} height={16} />
            {importState.phase === 'uploading'
              ? `${importState.percent}%`
              : importState.phase === 'saving'
                ? 'Reading…'
                : 'Import'}
          </FileButton>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <PlusIcon width={16} height={16} />
            Add deal
          </Button>
        </div>
      </div>

      {/* NO RESULT BANNER. It repeated, after the decision, the three
          things the diff modal had already shown before it: where the
          group came from, which columns were not read, which were left
          alone. What actually happened is the commit's toast, and "N need
          a check" is the line below this one, which is always current
          rather than only right after an upload. */}
      <div className="flex gap-3 text-sm mb-4 flex-wrap">
        {/* THE COUNTS ARE THE FILTER. They were a static line above a
            dropdown that said the same two things, so the number you read
            and the control that acted on it were two separate objects.
            Clicking a count narrows to it; clicking it again clears.
            Underlined on hover so it reads as clickable, and while it IS
            the filter it stays underlined and takes the text colour. */}
        {[
          { key: 'synced', n: counts.synced ?? 0, label: 'from the sheet' },
          { key: 'manual', n: counts.manual ?? 0, label: 'added by hand' },
        ].map((s) => (
          <Button
            key={s.key}
            size="xs"
            aria-pressed={source === s.key}
            className={`px-0 hover:bg-transparent hover:underline ${
              source === s.key ? 'font-semibold text-text underline' : 'text-text-faint'
            }`}
            onClick={() => { setSource(source === s.key ? '' : s.key); setPage(1); }}
          >
            {s.n} {s.label}
          </Button>
        ))}
        {counts.needs_review > 0 && (
          <Button
            size="xs"
            className="px-0 font-semibold text-warning underline hover:bg-transparent hover:text-warning"
            onClick={() => setReview('true')}
          >
            {counts.needs_review} need a check
          </Button>
        )}
      </div>

      {/* Phones shared by more than one person. Here rather than on
          People, because a phone is a column on a ROW: this is the page
          where you can see both rows and fix the cell.

          It drives the SEARCH BOX, not a filter of its own. The rows it
          wants are exactly what searching the number gives, the box shows
          why the table narrowed, and the toolbar's Clear already undoes
          it. A private phone filter would be a second thing to clear. */}
      <DuplicateBanner
        showing={query}
        onShow={setQuery}
      />

      {/* The shared Toolbar, like every other page: search on one row,
          filtering on the next. */}
      <Toolbar
        search={
          /* THE COLUMN PICKER SITS WITH THE BOX IT AIMS, not in the filter
             panel. It is not a filter: on its own it narrows nothing, and
             it is meaningless without something typed beside it.

             Only columns no filter can reach. See configs/searchFields.js.

             `min-w-0` so the search box can shrink beside the picker: a
             flex item will not go below its content width without it, and
             the pair ran off a phone screen. */
          <div className="flex w-full items-center gap-2 sm:w-auto [&>*:last-child]:min-w-0">
            {/* Narrow on purpose: the open panel floors at 224px, so the
                options stay readable. Wide enough that the default,
                "Anything", reads whole: cut to "Anyt…" it looked broken. */}
            <Select
              size="sm" className="w-28 shrink-0"
              value={searchField}
              onChange={(v) => { setSearchField(v ?? SEARCH_ANY); setPage(1); }}
              options={SEARCH_FIELDS}
              placeholder="Anything"
            />
            <SearchInput
              icon={SearchIcon}
              placeholder={searchPlaceholder(searchField)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
        // The server's count for the current filters, not `rows.length`,
        // which is only the page that happened to load.
        count={isLoading ? undefined : total}
        countLabel="deals"
        // No actions here any more: Add deal moved up to the title row with
        // Export and Import, so the three acts of the same kind read as one
        // row rather than being split across two.
        /* The search counts as a filter here. The duplicate-numbers notice
           narrows the table by writing into it, so a Clear that left the
           number behind would be the one control on the page that does
           not undo what the page just did. */
        // `review` is absent on purpose: it has no control in the panel,
        // so opening it would show nothing. It stays in filtersCount, so
        // Clear still shows and still undoes it.
        filtersActive={Boolean(group || status || companyStatus || amount.field || query || currency || paymentMethod || dealStatus || specialCase || shouldBePaid || paid)}
        filtersCount={[group, source, status, review, shouldBePaid, paid, companyStatus, amount.field, currency, paymentMethod, dealStatus, specialCase].filter(Boolean).length}
        storageKey="masterSheet.panel"
        onClearFilters={() => {
          setGroup(''); setSource(''); setStatus(''); setReview(''); setQuery(''); setSearchField(SEARCH_ANY); setCurrency(''); setPaymentMethod('');
          setDealStatus('');
          setSpecialCase('');
          setShouldBePaid(undefined); setPaid(undefined);
          setCompanyStatus(''); setAmount({}); setPage(1);
          // AND FORGET THEM. Resetting the state alone leaves the old
          // values in storage, so Clear would work until you walked to a
          // row and came back to the filters you had just cleared.
          forgetFilters();
        }}
        filters={
          <>
            {/* The shared Select, like every other filter row in the CRM.
                Group is searchable because the list grows with the sheet;
                source and status are closed sets of two. */}
            <Select
              size="sm" className="w-44" searchable
              value={group} onChange={(v) => { setGroup(v ?? ''); setPage(1); }}
              options={groups} placeholder="All groups"
            />
            {/* The PERSON's payment period on that deal, from its end
                date. Not the company's own active/closed. */}
            <Select
              size="sm" className="w-44"
              value={status} onChange={(v) => { setStatus(v ?? ''); setPage(1); }}
              options={PERIOD_FILTER_OPTIONS}
              placeholder="All payment periods"
            />
            {/* THE DEAL'S COMPANY, not the deal. A deal has no status the
                UI may call that: this is the company's, and it is here so
                "what have I still to set on a company winding down" is one
                click rather than a read of the whole sheet. */}
            <Select
              size="sm" className="w-48"
              value={companyStatus} onChange={(v) => { setCompanyStatus(v ?? ''); setPage(1); }}
              options={COMPANY_STATUS_OPTIONS.map((o) => ({
                value: o.value, label: `Company: ${o.label.toLowerCase()}`,
              }))}
              placeholder="All company statuses"
            />
            {/* AND THE DEAL'S OWN, which is his word or the review tick,
                never a stored column. Labelled "Deal:" against the one
                above it, because this page already calls three different
                things a status and the filter must say which. */}
            <Select
              size="sm" className="w-52"
              value={dealStatus} onChange={(v) => { setDealStatus(v ?? ''); setPage(1); }}
              options={DEAL_STATUS_OPTIONS.map((o) => ({
                value: o.value, label: `Deal: ${o.label.toLowerCase()}`,
              }))}
              placeholder="All deal statuses"
            />
            {/* SHOULD BE PAID AND PAID, IN THE PANEL. They were two switches
                beside the search, and once the bulk bar arrived a switch in
                the toolbar read as an ACTION on the ticked rows rather than
                a filter. Here they are filters like every other, and both
                sides are offered: "who is not paid yet" is the question. */}
            <Select
              size="sm" className="w-48"
              value={shouldBePaid ?? ''} onChange={(v) => { setShouldBePaid(v || undefined); setPage(1); }}
              options={[
                { value: 'true', label: 'Should be paid: yes' },
                { value: 'false', label: 'Should be paid: no' },
              ]}
              placeholder="Should be paid: any"
            />
            <Select
              size="sm" className="w-40"
              value={paid ?? ''} onChange={(v) => { setPaid(v || undefined); setPage(1); }}
              options={[
                { value: 'true', label: 'Paid: yes' },
                { value: 'false', label: 'Paid: no' },
              ]}
              placeholder="Paid: any"
            />
            {/* SPECIAL CASE: a deal paid a month its own dates exclude.
                Diane can narrow by it and this page could not, so the same
                question had two answers depending on where it was asked.
                BOTH SIDES offered: "which are not special cases" is a real
                question, and a filter that only says yes cannot answer it. */}
            <Select
              size="sm" className="w-52"
              value={specialCase} onChange={(v) => { setSpecialCase(v ?? ''); setPage(1); }}
              options={[
                { value: 'true', label: 'Special case' },
                { value: 'false', label: 'Not a special case' },
              ]}
              placeholder="Any special case"
            />
            {/* CURRENCY AND METHOD ARE FILTERS, NOT SEARCH FIELDS. Both
                are closed sets of three or four off the sheet's own values,
                and a closed set is something you pick, never something you
                type.

                The options are DERIVED from the deals, never a hardcoded
                list: the sheet already uses "EURO", which no ISO list has,
                and the next one may invent another. Same rule the local
                locations card follows. */}
            <Select
              size="sm" className="w-36"
              value={currency} onChange={(v) => { setCurrency(v ?? ''); setPage(1); }}
              options={(filterOptions?.currencies ?? []).map((c) => ({ value: c, label: c }))}
              placeholder="All currencies"
            />
            <Select
              size="sm" className="w-40"
              value={paymentMethod} onChange={(v) => { setPaymentMethod(v ?? ''); setPage(1); }}
              // The word the CELL shows, not a prettier one. "Bank Transfer"
              // in the filter above a column reading "bank" is two names for
              // one thing on one screen.
              options={(filterOptions?.methods ?? []).map((m) => ({ value: m, label: m }))}
              placeholder="All methods"
            />
            {/* A FIGURE BETWEEN TWO BOUNDS, from the shared component, so
                the next page that needs one does not grow its own. */}
            <NumberRangeFilter
              fields={[
                { value: 'monthlyAmount', label: 'Monthly amount' },
                { value: 'payableAmount', label: 'Payable amount' },
                { value: 'payableDays', label: 'Payable days' },
              ]}
              value={amount}
              onChange={(v) => { setAmount(v); setPage(1); }}
            />
          </>
        }
        // The bulk act lives in the bar at the bottom now, beside the rows
        // you just ticked rather than at the top of a long table.
      />

      <ErrorState error={error} title="Couldn't load the master sheet" />

      {isEmpty && (
        query || filterActive
          ? <EmptyState icon={SearchIcon} title="No deals match that" hint="Try another search, or clear the filters." />
          // Both doors are on THIS page, in the row above: Import and
          // Add deal. Pointing at Settings sent people somewhere else.
          : <EmptyState icon={ImportIcon} title="No deals yet" hint="Import a sheet or add a deal with the buttons above." />
      )}

      {/* Cards on a phone. The table below is 26 columns wide and no
          amount of horizontal scrolling makes that usable on 375px. */}
      {rows && rows.length > 0 && (
        <CardList>
          {rows.map((r) => (
            <DealCard
              key={r.id}
              row={r}
              selected={sel.has(r.id)}
              onToggleSelect={sel.toggle}
              onEdit={setEditing}
            />
          ))}
        </CardList>
      )}

      {(isLoading || (rows && rows.length > 0)) && (
        <div className="table-wrap hidden md:block">
          {/* border-separate, not border-collapse. A collapsed table
              merges adjacent cell borders into one shared grid, and a
              sticky cell then has no border of its own to keep — which is
              why the frozen column's right edge never appeared and the
              header's bottom rule vanished while scrolling. Zero spacing
              makes it look identical to a collapsed table. */}
          <table ref={tableRef} className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="th sticky-col w-8">
                  <SelectAll count={sel.count} total={sel.total} onChange={sel.setAll} />
                </th>
                {/* Every column the boss's own sheet has (21 of them, see
                    docs/boss/Master sheet for tech-4.xlsx), in its order,
                    plus whatbot's payday confirmation, which has no sheet
                    column. The admin's should-be-paid / paid answers are
                    the bulk bar's now. The table scrolls horizontally
                    (.table-wrap) rather than hiding columns. */}
                <th className="th sticky-col sticky-edge">Name</th>
                <th className="th">Group</th>
                <th className="th">Role</th>
                <th className="th">Company</th>
                <th className="th">Appointment</th>
                <th className="th">Payment start</th>
                <th className="th">Preset</th>
                <th className="th">End date</th>
                {/* Immediately after the date it explains. See the cell. */}
                <th className="th">Deal status</th>
                <th className="th">Days</th>
                <th className="th">Method</th>
                <th className="th">Monthly</th>
                <th className="th">Payable</th>
                <th className="th">Currency</th>
                <th className="th">Add on %</th>
                <th className="th">Fee %</th>
                <th className="th">Location</th>
                <th className="th">Door no.</th>
                <th className="th">Postcode</th>
                <th className="th">Postals</th>
                <th className="th">Phone</th>
                <th className="th">Label</th>
                <th className="th">Notes</th>
                <th className="th">Bank details</th>
                <th className="th">Account no.</th>
                <th className="th">Sort code</th>
                <th className="th">Payment period</th>
                {/* whatbot's payday answer. Should be paid and Paid are
                    set from the bulk bar now, and filtered by the two
                    toggles above; no column of switches. */}
                <th className="th">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <TableSkeleton columns={29} />
                : rows.map((r) => (
                    <SheetRow
                      colorUsesEndDate={colorUsesEndDate}
                      cryptoPercent={cryptoPercent}
                      key={r.id}
                      row={r}
                      selected={sel.has(r.id)}
                      onToggleSelect={sel.toggle}
                      onEdit={setEditing}
                      onCellSave={saveCell}
                      onDealStatus={pickDealStatus}
                      groups={groups}
                      options={filterOptions}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      {/* Seeded with the page's own group filter, so the modal opens on
          what you were already looking at. */}
      {exporting && (
        <MasterSheetExportModal group={group} onClose={() => setExporting(false)} />
      )}

      {/* Nothing from the file has been written at this point. Cancel here
          leaves the table exactly as it was. */}
      {preview && (
        <ImportDiffModal
          preview={preview}
          committing={committing}
          rereading={rereading}
          deleting={deletingFromDiff}
          onCancel={cancelPreview}
          onCommit={applyImport}
          onApplyDefaults={applyDefaults}
          onDeleteRows={deleteRows}
        />
      )}

      {editing && (
        <RowModal
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {/* The table's own bulk select. Same dialog as the single row, so
          deleting six says what deleting one says. */}
      {/* Both close on the click: the rows change at once and the
          request runs behind them. */}
      {confirmingBulkDelete && (
        <ConfirmDialog
          {...confirm.bulkDeleteRows(sel.count)}
          icon={<TrashIcon width={16} height={16} />}
          onCancel={() => setConfirmingBulkDelete(false)}
          onConfirm={bulkDeleteRows}
        />
      )}

      {/* The ending you can take back, for many. Red like every Stop, told
          apart from Delete by the palm; Undo in the toast puts the lot back. */}
      {confirmingBulkStop && (
        <ConfirmDialog
          {...confirm.bulkStopRows(sel.count)}
          confirmVariant="danger"
          icon={<StopHandIcon width={16} height={16} />}
          onCancel={() => setConfirmingBulkStop(false)}
          onConfirm={bulkStop}
        />
      )}

      {bulkEditing && (
        <BulkEditModal
          field={bulkEditing}
          rows={selectedRows}
          options={bulkEditOptions}
          onClose={() => setBulkEditing(null)}
          onApply={bulkEdit}
        />
      )}

      {/* ===============================
          * THE TYPED PAYABLE AMOUNT IS ABOUT TO GO
          * ===============================
          Two real answers and neither is destructive, so Cancel keeps its
          one meaning and the second choice is its own button. The OLD AND
          NEW figures are both named: "will recompute" is abstract, "5,000
          becomes 1,935.48" is a decision. */}
      {recompute && (
        <ConfirmDialog
          {...confirm.payableWouldRecompute({
            columns: recompute.warn.labels,
            was: formatMoney(recompute.warn.was, recompute.row?.currency),
            willBe: recompute.warn.willBe === null
              ? null
              : formatMoney(recompute.warn.willBe, recompute.row?.currency),
          })}
          confirmVariant="primary"
          busy={cellEdit.isPending}
          onCancel={() => setRecompute(null)}
          altLabel={`Keep ${formatMoney(recompute.warn.was, recompute.row?.currency)}`}
          onAlt={() => {
            cellEdit.mutate(
              { ...recompute.patch, fields: keepingPayable(recompute.patch.fields, recompute.row) },
              recompute.opts,
            );
            setRecompute(null);
          }}
          onConfirm={() => {
            cellEdit.mutate(recompute.patch, recompute.opts);
            setRecompute(null);
          }}
        />
      )}

      {/* ===============================
          * WHAT YOU CAN DO TO THE TICKED DEALS
          * ===============================
          The bar rises from the bottom when a row is ticked. Stop and Delete
          are both red, told apart by the palm and the bin. Nothing here
          waits for the server, so nothing is ever disabled. */}
      <BulkBar count={sel.count} noun="deal" onClear={sel.clear}>
        <BulkMenu
          icon={ShouldBePaidIcon}
          label="Should be paid"
          hint={splitHint(selectedRows, shownShouldBePaid)}
          options={[
            { label: 'Yes', onSelect: () => bulkSwitch({ overrideShouldBePaid: true }, 'marked should be paid', 'already yes') },
            { label: 'No', onSelect: () => bulkSwitch({ overrideShouldBePaid: false }, 'marked not to be paid', 'already no') },
          ]}
        />
        <BulkMenu
          icon={PaidIcon}
          label="Paid"
          hint={splitHint(selectedRows, shownPaid)}
          options={[
            { label: 'Yes', onSelect: () => bulkSwitch({ overridePaid: true }, 'marked paid', 'already yes') },
            { label: 'No', onSelect: () => bulkSwitch({ overridePaid: false }, 'marked unpaid', 'already no') },
          ]}
        />
        <BulkMenu
          icon={EditIcon}
          label="Edit"
          options={BULK_EDIT_FIELDS.map((f) => ({ label: f.label, onSelect: () => setBulkEditing(f) }))}
        />
        {/* The same value the row's star writes: true on, false off. */}
        <BulkMenu
          icon={StarIcon}
          label="Special case"
          hint={splitHint(selectedRows, (r) => Boolean(r.special_case_deal))}
          options={[
            { label: 'On', onSelect: () => bulkSwitch({ specialCaseDeal: true }, 'made a special case', 'already on') },
            { label: 'Off', onSelect: () => bulkSwitch({ specialCaseDeal: false }, 'back to their dates', 'already off') },
          ]}
        />
        <BulkAction icon={StopHandIcon} variant="danger" onClick={() => setConfirmingBulkStop(true)}>
          Stop
        </BulkAction>
        {/* ASKS IN A DIALOG that says what SURVIVES: deleting deals leaves
            every person and company standing. */}
        <BulkAction icon={TrashIcon} variant="danger" onClick={() => setConfirmingBulkDelete(true)}>
          Delete
        </BulkAction>
      </BulkBar>

      {/* Diane is mounted once at app level (Layout.jsx) rather than per
          page — one instance, one conversation, one WebGL context. */}
    </div>
  );
}
