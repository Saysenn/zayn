import { useState } from 'react';
import { useStickyState } from '../hooks/useStickyState';
import { formatNumber } from '../helpers/formatMoney';
import { Link } from 'react-router-dom';
import { useSettings, useUpdateSettings, useBurnMonth } from '../hooks/useSettings';
import { useImportFlow } from '../hooks/useImportFlow';
import ImportDiffModal from '../components/import/ImportDiffModal';
import { Skeleton } from '../components/display/Skeleton';
import LocalLocations from '../components/settings/LocalLocations';
import PaymentStartRules from '../components/settings/PaymentStartRules';
import ConversionRates from '../components/settings/ConversionRates';
import ThemePicker from '../components/settings/ThemePicker';
import ExpenseAdmins from '../components/settings/ExpenseAdmins';
import ExpenseStyle from '../components/settings/ExpenseStyle';
import Button, { FileButton, LinkButton } from '../components/buttons/Button';
import Toggle from '../components/forms/Toggle';
import Select from '../components/forms/Select';
import PercentField from '../components/forms/PercentField';
import UnderlineTabs from '../components/layout/UnderlineTabs';
import PageHeader from '../components/layout/PageHeader';
import { ACTIVE_NAV_CLASS } from '../configs/navigationStyles';
import {
  ImportIcon, MasterSheetIcon, ChatIcon, ToolsIcon, WarningIcon, ReceiptIcon,
  LogsIcon, TrashIcon, PaletteIcon, SparkleIcon,
} from '../components/icons';

/**
 * Settings, split by concern rather than stacked in one column.
 *
 * Four sections, in the order someone actually needs them: getting data
 * in, what whatbot may do, debugging, and the two buttons that destroy
 * things. The last one is last and looks different for a reason.
 *
 * The sidebar is a real tab switch, not an anchor scroll — the danger
 * zone should not be reachable by scrolling past it on the way to
 * something harmless.
 */

/**
 * ===============================
 * * Grouped by WHAT IT DOES, not by which table it touches.
 * ===============================
 * Was seven flat items, four of which were master sheet concerns wearing
 * different names. The sidebar picks a subject; tabs pick a job within it.
 *
 * Every label names the JOB, not the noun: "Import a sheet" rather than
 * "Data", "Cell colours" rather than "Sheet colours".
 */
/**
 * ===============================
 * * A DISPLAY CAP, AND IT DELETES NOTHING
 * ===============================
 * How far back the dashboard OFFERS to look. Retention is a constant on the
 * server, `SNAPSHOT_MONTHS`, and keeps twelve months whatever this says.
 *
 * The obvious version drove both, so 12 -> 3 would delete nine immutable
 * snapshots on the next cron tick: permanently, unwatched, and a snapshot
 * froze the sheet as it stood that day and cannot be rebuilt. His call
 * 2026-09-09 to separate them, which also makes RAISING this instant: the
 * months were never gone.
 *
 * A DELIBERATE MIRROR of DASHBOARD_HISTORY_OPTIONS in
 * api/v1/shared/snapshotWindow.helper.js. The server folds an unknown value
 * to its own default, so this list drifting cannot write a bad one.
 */
const HISTORY_MONTHS = [3, 6, 12];
const DEFAULT_HISTORY_MONTHS = 3;
const HISTORY_OPTIONS = HISTORY_MONTHS.map((value) => ({
  value: String(value), label: `${value} months`,
}));

/** The window in real month names, so a number is never the only clue. */
function historyWindow(months) {
  const now = new Date();
  const at = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Longest view: ${at(-(months - 1))} to ${at(0)}, and ${at(1)} forecast.`;
}

const SECTIONS = [
  {
    key: 'master-sheet',
    label: 'Master sheet',
    icon: MasterSheetIcon,
    tabs: [
      { key: 'data', label: 'Data' },
      { key: 'preset-formula', label: 'Preset formula' },
      { key: 'locations', label: 'Locations' },
      // NO HISTORY TAB. It was a card with one button opening the same list
      // the account menu's History page shows, so the safety net had two
      // doors that could drift. The account menu is the one.
    ],
  },
  // GLOBAL RATES, its own subject. Not a master sheet tab: these apply to
  // a payment rail, not to the sheet.
  { key: 'rates', label: 'Global rates', icon: ReceiptIcon },
  { key: 'whatbot', label: 'Whatbot', icon: ChatIcon },
  // HER OWN SECTION: the sign-in briefing and auto mode sat under Whatbot,
  // where nobody looking for Diane would find them. 2026-09-29.
  { key: 'diane', label: 'Diane', icon: SparkleIcon },
  // The theme: every page, the login and Diane's screens. Saved in this browser.
  { key: 'appearance', label: 'Appearance', icon: PaletteIcon },
  { key: 'developer', label: 'Developer', icon: ToolsIcon },
  { key: 'danger', label: 'Danger zone', icon: WarningIcon, danger: true },
];

const TABS_FOR = new Map(SECTIONS.map((s) => [s.key, s.tabs ?? null]));

// Shared shape for both destructive actions — a collapsed warning that
// only reveals a type-to-confirm field once explicitly opened, same
// "don't make the dangerous thing easy to reach by accident" idea as
// MasterSheetPage's own confirmingDelete pattern, just with a typed phrase
// instead of a second click since this destroys far more than one row.
function DangerAction({ title, description, phrase, mutation, doneMessage, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(false);

  function handleConfirm() {
    mutation.mutate(typed, {
      onSuccess: () => {
        setDone(true);
        setOpen(false);
        setTyped('');
      },
    });
  }

  return (
    // A red border around the whole card shouts before anyone has done
    // anything, and makes the two cards look like errors rather than
    // controls. The danger lives in the button, which is the part that
    // actually does something.
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-text-muted text-sm mb-3">{description}</p>

      {done && <p className="text-sm text-success-strong font-semibold mb-3">{doneMessage}</p>}

      {!open ? (
        <Button variant="danger" size="sm" onClick={() => { setOpen(true); setDone(false); }}>
          {Icon && <Icon width={16} height={16} />}
          {title}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 max-w-sm">
          <label className="field-label" htmlFor={`confirm-${phrase}`}>
            Type <span className="font-mono font-semibold text-text">{phrase}</span> to confirm
          </label>
          <input
            id={`confirm-${phrase}`}
            className="input-inline"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          {mutation.error && <p className="text-sm text-danger">{mutation.error.message}</p>}
          {/* Cancel left, the destructive one right, as in every confirm. */}
          <div className="flex gap-2">
            <Button size="form" onClick={() => { setOpen(false); setTyped(''); }}>Cancel</Button>
            <Button
              variant="danger"
              size="form"
              disabled={typed !== phrase || mutation.isPending}
              onClick={handleConfirm}
            >
              {mutation.isPending ? 'Working…' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, description, children }) {
  return (
    <div className="max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {description && <p className="text-text-muted text-sm mb-3">{description}</p>}
      {children}
    </div>
  );
}

// One switch, one sentence of state. Replaces the Off/On button pair,
// which was two controls saying what one switch says.
function SettingSwitch({ label, checked, onChange, disabled, on, off }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
      <span className="text-sm">{checked ? on : off}</span>
    </div>
  );
}

/** The arithmetic worked, so the rate is not just a number in a box. */
function CryptoExample({ percent }) {
  const base = 1000;
  return (
    <p className="text-xs text-text-muted">
      {`Someone paid in crypto and owed ${formatNumber(base)} is worth `}
      {`${formatNumber(base + base * (percent / 100))} to find: `}
      {`their amount plus ${formatNumber(base * (percent / 100))}.`}
    </p>
  );
}

export default function SettingsPage() {
  // The sidebar picks a subject, the tab row picks a job within it. A
  // section with one job shows no tab row at all.
  //
  // BOTH SURVIVE A RELOAD. Settings is the page you refresh on: you change
  // a rule, reload to check it took, and landed back on Master sheet / Data
  // every time. Same reasoning as the filter panels.
  const [section, setSection] = useStickyState('settings.section', 'master-sheet');
  const [storedTab, setTab] = useStickyState('settings.tab', 'data');
  const tabs = TABS_FOR.get(section);
  // A remembered tab that no longer exists (History moved to the account
  // menu) falls back to the section's first, rather than a blank panel.
  const tab = tabs && !tabs.some((t) => t.key === storedTab) ? tabs[0].key : storedTab;

  function pickSection(key) {
    setSection(key);
    // Land on the section's first tab, never on one belonging to the
    // section you just left.
    const next = TABS_FOR.get(key);
    if (next) setTab(next[0].key);
  }
  const { data, isLoading } = useSettings();
  const { mutate: update, isPending } = useUpdateSettings();
  const burnMonth = useBurnMonth();
  // The same three-step flow all three upload doors use: parse, look at
  // the diff, apply what was accepted. Shared so the diff step cannot end
  // up on one door and not the others.
  const {
    importState, busy, preview, committing, rereading,
    handleImport, applyImport, applyDefaults, cancelPreview,
  } = useImportFlow();

  const devMode = data?.devMode ?? false;
  // Defaults ON — a fresh install that silently ignored whatbot's payday
  // write would look broken rather than configured.
  const whatbotWrites = data?.whatbotWrites ?? true;
  const colorUsesEndDate = Boolean(data?.colorUsesEndDate);
  // Defaults ON, like whatbotWrites and for the same reason: the point of
  // the briefing is that nobody has to remember to look at the queue.
  const loginBriefing = data?.loginBriefing ?? true;
  // Defaults OFF, unlike the two above, and that is the point: a write that
  // skips its preview is one nobody read before it happened, so an
  // unreadable or missing value must never read as permission.
  const autoConfirm = data?.agentAutoConfirm === true;
  const historyMonths = HISTORY_MONTHS.includes(Number(data?.dashboardHistoryMonths))
    ? Number(data.dashboardHistoryMonths)
    : DEFAULT_HISTORY_MONTHS;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage CRM data, payment rules and workspace preferences" />

      <div className="flex flex-col gap-5 md:flex-row md:gap-6">
        <nav className="shrink-0 rounded-lg border border-border bg-surface p-2 shadow-sm md:sticky md:top-[calc(theme(spacing.header)+1.5rem)] md:w-52 md:self-start" aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = s.key === section;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => pickSection(s.key)}
                    aria-current={active ? 'page' : undefined}
                    /**
                     * ACTIVE AND HOVER MUST NOT LOOK THE SAME. Both were a
                     * pale tinted rectangle, so the section you are on and
                     * the one under the cursor read at the same weight.
                     *
                     * Active uses the same solid accent fill as the filter
                     * control. Hover stays a plain grey wash, so the coloured
                     * one is always the section you are on.
                     */
                    className={`w-full min-h-0 justify-start gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? s.danger
                          ? 'bg-danger-tint font-semibold text-danger ring-1 ring-inset ring-danger/30'
                          : ACTIVE_NAV_CLASS
                        : `bg-transparent hover:bg-surface-sunken ${s.danger ? 'text-danger' : 'text-text-muted'}`
                    }`}
                  >
                    <Icon width={15} height={15} />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 flex flex-col gap-6">
          {/* ONLY WHERE THERE IS MORE THAN ONE JOB. Most sections have
              one, so the extra layer costs nothing where it is not needed.
              The same UnderlineTabs every other page uses: the segmented
              pill this was drew a second, heavier tab style for one page. */}
          {tabs && <UnderlineTabs tabs={tabs} active={tab} onChange={setTab} />}

          {tab === 'data' && section === 'master-sheet' && (
            <>
              <Card
                title="Import a master sheet"
                description="Drop a master sheet xlsx in here. It is read on the spot and you see exactly what it would change before anything is written. The same import sits on the Master sheet page."
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <FileButton
                    size="sm"
                    disabled={busy}
                    phase={importState.phase}
                    percent={importState.percent}
                    onChange={handleImport}
                  >
                    <ImportIcon width={16} height={16} />
                    {importState.phase === 'uploading'
                      ? `Sending ${importState.percent}%`
                      : importState.phase === 'saving'
                        ? 'Saving…'
                        : 'Choose a file'}
                  </FileButton>
                  {busy ? (
                    <span className="text-xs text-text-muted">
                      {importState.phase === 'saving'
                        ? 'Reading the sheet and writing the rows. This takes a few seconds.'
                        : 'Sending the file.'}
                    </span>
                  ) : (
                    <span className="text-xs text-text-faint">.xlsx only, up to 20MB</span>
                  )}
                </div>

                {/* NO RESULT PANEL. It repeated what the diff modal showed
                    before the decision, under a green background that also
                    had to carry an amber warning. What happened is the
                    commit's toast; a failed parse is its own toast too. */}
              </Card>

              <Card
                title="What an import does"
                description="Existing rows update. Rows missing from the new sheet are kept, and listed on the Potentially ended deals tab for you to remove or not. Anything you edited by hand stays as you left it, and rows you added by hand are never offered there."
              />
            </>
          )}

          {tab === 'locations' && section === 'master-sheet' && (
            <Card
              title="Which locations are local"
              description="The payout breakdown splits cash into what stays here and what has to be sent. Tick the places that are local. Everything else is counted as going out, so a new place is counted as sent until you say otherwise. The list is every location on the sheet, so a new one appears here on its own."
            >
              <LocalLocations />
            </Card>
          )}

          {tab === 'preset-formula' && section === 'master-sheet' && (
            <Card
              title="Payment start colour"
              description="The payment start cell is green, amber or red on the Master Sheet page and in every exported file. These are the boss's own rules from his sheet. The end date is optional: with it on, red also means finished and amber also means this is the last month."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <div className="space-y-3">
                  <SettingSwitch
                    label="Include the end date"
                    checked={colorUsesEndDate}
                    disabled={isPending}
                    onChange={(v) => update({ colorUsesEndDate: v })}
                    // THE LABEL IS THE ACT, not the state: the switch itself
                    // already shows which way it is set, and beside it the
                    // worked example below repaints the moment it moves. It
                    // read "Only the payment start and the preset", which
                    // said what was true and never what pressing it would do.
                    on="Remove end date from the formula"
                    off="Add end date to the formula"
                  />
                  <PaymentStartRules useEndDate={colorUsesEndDate} />
                </div>
              )}
            </Card>
          )}

          {tab === 'preset-formula' && section === 'master-sheet' && (
            <Card
              title="Dashboard history"
              description="How far back the dashboard offers to look. Next month is always drawn on top as a forecast, so 3 months is four points on the chart. This does NOT delete anything: twelve months of snapshots are kept whatever this says, so raising it draws real history straight away."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <div className="space-y-2">
                  <Select
                    label="Months of history"
                    size="form"
                    disabled={isPending}
                    value={String(historyMonths)}
                    onChange={(v) => update({ dashboardHistoryMonths: Number(v) })}
                    options={HISTORY_OPTIONS}
                  />
                  {/* THE MONTHS, NAMED. Same rule as the dashboard's own
                      control: a number alone is what let "3 months" be read
                      as three months BACK for as long as it was. */}
                  <p className="text-xs text-text-faint">{historyWindow(historyMonths)}</p>
                </div>
              )}
            </Card>
          )}

          {section === 'rates' && (
            <Card
              title="Conversion rates"
              description="Every USD figure in the CRM is converted with these: the dashboard totals, the converted breakdown on a payout file, and any figure Diane quotes in dollars. Each box takes what one US dollar buys, the same way a rate site prints it, so it is a straight paste. A live feed is used when one is configured and answering; these are what runs when api is not set. Set them here so a rate can be checked before a conversion, not after."
            >
              <ConversionRates />
            </Card>
          )}

          {section === 'rates' && (
            <Card
              title="Crypto charges"
              description="What a crypto payment costs us in gas. It is ADDED to what a crypto row is owed and it reaches every total, so a person paid in crypto is worth their amount plus this."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <div className="space-y-3">
                  <PercentField
                    inline
                    label="On every crypto payment"
                    value={data?.cryptoPercent}
                    disabled={isPending}
                    onSave={(v) => update({ cryptoPercent: v })}
                  />
                  <CryptoExample percent={Number(data?.cryptoPercent) || 0} />
                </div>
              )}
            </Card>
          )}

          {section === 'whatbot' && (
            <Card
              title="Payday writes"
              description="Lets whatbot record a payday answer onto a row. That is the only thing it can write. Turn it off and those writes stop at once. Whatbot still reads the master sheet and still answers questions."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <SettingSwitch
                  label="Whatbot payday writes"
                  checked={whatbotWrites}
                  disabled={isPending}
                  onChange={(v) => update({ whatbotWrites: v })}
                  on="Payday answers are being recorded"
                  off="Payday answers are being ignored"
                />
              )}
            </Card>
          )}

          {section === 'whatbot' && (
            <Card
              title="Expense admins"
              description="Who may send expenses to WhatBot, and on which group's number. Only these numbers can save, change or remove expenses, and only for that group: anyone else is ignored. The bot shows what it read and saves nothing until they reply yes."
            >
              <ExpenseAdmins />
            </Card>
          )}

          {section === 'whatbot' && (
            <Card
              title="Expense message style"
              description="How an expense preview and a saved note look, on WhatsApp and in Diane's chat. A picture opens full screen when tapped, and its caption still says what needs an answer and how to reply. Anything that needs checking is tinted on its own cell."
            >
              <ExpenseStyle
                value={data?.expenseStyle}
                isLoading={isLoading}
                disabled={isPending}
                onChange={(v) => update({ expenseStyle: v })}
              />
            </Card>
          )}

          {section === 'diane' && (
            <Card
              title="Diane's briefing at sign-in"
              description="She says what needs doing when you sign in: the review queue, anything unpaid this month, open concerns and rows the last import flagged. She says nothing at all when there is nothing in any of them, and every line she says is a link to the data."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <SettingSwitch
                  label="Diane's briefing at sign-in"
                  checked={loginBriefing}
                  disabled={isPending}
                  onChange={(v) => update({ loginBriefing: v })}
                  on="She speaks when you sign in"
                  off="Sign-in goes straight to the CRM"
                />
              )}
            </Card>
          )}

          {section === 'diane' && (
            <Card
              title="Let Diane act without asking"
              description="She shows a change and waits for a yes before making it. With this on she makes it straight away, for ONE named deal or ONE person, and tells you what she did. Every change is still in History and still undoable, field by field. She will always ask before anything that deletes, stops, closes or reaches more than the row you named, whatever this says."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <SettingSwitch
                  label="Skip the confirmation on one named change"
                  checked={autoConfirm}
                  disabled={isPending}
                  onChange={(v) => update({ agentAutoConfirm: v })}
                  on="She makes the change and tells you"
                  off="She asks first, every time"
                />
              )}
            </Card>
          )}

          {section === 'appearance' && (
            <Card
              title="Theme"
              description="The accent colour of the whole CRM, the sign-in page and Diane's screens. Status colours and exported files keep their own. Saved in this browser."
            >
              <ThemePicker />
            </Card>
          )}

          {section === 'developer' && (
            <Card
              title="Developer mode"
              description="Shows full error details instead of a generic message, and records backend errors to the Logs page. A debugging aid. Leave it off day to day."
            >
              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <SettingSwitch
                  label="Developer mode"
                  checked={devMode}
                  disabled={isPending}
                  onChange={(v) => update({ devMode: v })}
                  on="Recording errors"
                  off="Off"
                />
              )}
              {/* THE ONE WAY TO THE LOGS PAGE. It is not in the sidebar, so
                  this has to read as a door rather than a footnote. */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <LinkButton as={Link} to="/logs" variant="secondary" size="sm">
                  <LogsIcon width={16} height={16} />
                  Open the Logs page
                </LinkButton>
                <span className="text-xs text-text-faint">
                  {devMode ? 'New errors are being recorded there.' : 'Nothing new is recorded while this is off.'}
                </span>
              </div>
            </Card>
          )}

          {section === 'danger' && (
            <div className="max-w-2xl flex flex-col gap-3">
              {/* ONE BUTTON, not two. Ending a month was two destructive
                  acts in a row and the first one only did half the job, so
                  Burn now clears the deals as well. There is no second card
                  behind it: the description says everything that goes. */}
              <DangerAction
                title="Burn this month"
                icon={TrashIcon}
                description="Clears every deal, and with them People and Companies, which are views of the same table. The Flagged queue, the chat history and the edit history go too. Nothing brings any of it back except importing a sheet, so have next month's file ready first."
                phrase="BURN THIS MONTH"
                mutation={burnMonth}
                doneMessage="Burned. Nothing is left until you import a sheet."
              />
            </div>
          )}
        </div>
      </div>

      {/* Nothing from the file has been written yet. Cancel leaves the
          table exactly as it was. */}
      {preview && (
        <ImportDiffModal
          preview={preview}
          committing={committing}
          rereading={rereading}
          onCancel={cancelPreview}
          onCommit={applyImport}
          onApplyDefaults={applyDefaults}
        />
      )}
    </div>
  );
}
