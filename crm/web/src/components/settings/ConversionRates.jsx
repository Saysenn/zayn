import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Button from '../buttons/Button';
import CellInfo from '../display/CellInfo';
import { Skeleton } from '../display/Skeleton';
import ConfirmDialog from '../modals/ConfirmDialog';
import BulkBar, { BulkAction } from '../layout/BulkBar';
import { TrashIcon } from '../icons';
import { useFxRates, useSetFxRate } from '../../hooks/useSettings';
import { useNotifications } from '../../hooks/useNotifications';
import useRowSelection from '../../hooks/useRowSelection';
import useBulkActions, { bulkMessage, patchQueries } from '../../hooks/useBulkActions';
import { apiService } from '../../configs/api.config';
import { formatNumber } from '../../helpers/formatMoney';
import { NUMBER_INPUT, nonNegative } from '../../helpers/numberInput';

/**
 * ***************************************************
 * * The conversion rates, ours to set and ours to check
 * ***************************************************
 *
 * Every USD figure in the CRM comes from these: the dashboard's totals, the
 * converted breakdown on a payout file, and every figure Diane quotes in
 * dollars. Previously a live feed with a hardcoded standby carrying GBP,
 * USD and AED and NOTHING ELSE, which is why the sheet's EURO rows went
 * unconverted for weeks with no way to fix it from in here.
 *
 * ===============================
 * * THE BOX TAKES THE DIRECTION EVERY RATE SITE PRINTS
 * ===============================
 * `1 USD = X CODE`. Xe, Google and the sheet's own "3.6725 per dollar" all
 * read that way, so a rate is a COPY AND PASTE and there is no direction
 * left to get wrong.
 *
 * It asked for the inverse, what one unit is worth in USD, and the only
 * thing saying so was an aria-label nobody sees while the sentence beside
 * the box read the other way. Three of the four live rates were entered
 * upside down: AED at 3.67 made every dirham figure 13.5x too high and GBP
 * at 0.75 made every pound figure 44% too low, in the totals every
 * conversion in the CRM uses. Found 2026-09-23. A label would have left the
 * trap there; this removes it.
 *
 * AND STORAGE FOLLOWED, migration 065. `tb_fx_rates.per_usd` holds what is
 * typed here, and `toUsd` divides by the same number. Nothing inverts
 * anywhere any more, which is what makes the box exact: it held the
 * inverse for half a day and a typed 3.75 came home 3.74999995.
 *
 * OPTIMISTIC, through `useOptimisticUpdate`. Written first as a plain
 * mutation that waited for the server, on the argument that a rate is a
 * figure every conversion will use. The user's call, overruled: a Save
 * button that sits there doing nothing reads as one that did not work.
 *
 * ONE ROW EACH, ONE LINE EACH. The notes were a paragraph under every
 * field, which is the exact thing this CRM already took out of every form
 * once for making them twice as tall. They are icons now, said at the
 * moment they are asked for.
 *
 * IT DOES NOT REACH THE PAST. A saved month keeps the rates it was taken
 * with, so a change here moves this month and every month after it.
 *
 * ===============================
 * * AND THEN THE OTHER WAY ROUND, his call 2026-10-13. Migration 085.
 * ===============================
 * The boss reads xe.com, "1 GBP = 1.36 USD", and typed 1.36 into a box that
 * meant 1 USD = 1.36 GBP. So the box now takes WHAT ONE OF THE CURRENCY IS
 * WORTH IN DOLLARS, the way he reads it, and every line here says it that
 * way. The typed number is stored exactly in its own column, so 1.36 comes
 * back 1.36 (the round trip 065 fixed cannot return); the units per dollar
 * the converters divide by is worked out from it on the server.
 *
 * THE NEWER ONE WINS (his call, same day): a pull, daily or "Pull now",
 * replaces a rate typed here before it; a rate typed after the pull is used
 * until the next. The row says which it is running on, and shows that rate.
 */

// Only a currency whose rate has a story needs a note. Each reads in the
// box's own direction, one of the currency in US dollars.
const NOTES = {
  GBP: 'What one pound is worth in US dollars, as xe.com shows it. Also the export rate when nothing is typed into the run.',
  EUR: 'The sheet writes EURO. It is read as EUR, so set it here as EUR. Paste xe.com\'s "1 EUR = ... USD" figure.',
  AED: 'Pegged at 3.6725 dirhams to the dollar since 1997, which is 1 AED = 0.2723 USD. Set it only if that changes.',
  USD: 'The base. It is never converted.',
};

// Where a row's rate comes from right now.
// SHORT, his call 2026-10-13: the box already says the rate.
const ROW_SOURCE = {
  saved: 'Manual',
  daily: 'Auto',
  fallback: 'Built in',
};

// One grid, so every row's boxes and buttons line up instead of each row
// wrapping to its own shape.
// The first column is the bulk bar's tick, empty on a row with nothing saved.
const ROW = 'grid grid-cols-[1rem_1fr_auto] items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-0 sm:grid-cols-[1rem_15rem_1fr_auto]';
// The button beside the box on a phone too: auto placed, it fell to a row of its own under the note.
const BTN = 'col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto';
// The note under the box on a phone, beside it from sm up.
const NOTE = 'col-span-2 col-start-2 text-xs text-text-faint sm:col-span-1 sm:col-start-auto';

/**
 * ===============================
 * * THE CODE IS AN ADDON, NOT A SENTENCE
 * ===============================
 * `GBP | value`, then "USD" after it: the box is "1 GBP = [ 1.36 ] USD"
 * read left to right, the shape xe.com prints.
 */
const GROUP = 'flex items-stretch overflow-hidden rounded border border-border-strong bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-accent-strong focus-within:outline-offset-1';
const CODE = 'flex min-h-9 shrink-0 items-center border-r border-border-strong bg-surface-sunken px-2.5 text-xs font-semibold text-text-muted';
const UNIT = 'flex min-h-9 shrink-0 items-center border-l border-border-strong bg-surface-sunken px-2.5 text-xs font-semibold text-text-muted';
// Border and padding come from the group, so the box inside draws neither.
const BOX = 'min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm tabular-nums outline-none min-h-9';

// Negatives blocked on the key and on the change. One definition, shared
// with the expenses form: see helpers/numberInput.js.
const numberOnly = NUMBER_INPUT;

/** A rate to read: enough decimals for PHP's 0.0175, none wasted on GBP's 1.36. */
const readable = (n) => formatNumber(n, n >= 1 ? 4 : 6).replace(/\.?0+$/, '');

/**
 * The typed figure back as it was typed. A row from before migration 085
 * has only units per dollar, mirrored once until somebody saves it again.
 */
const shownFor = (saved) => {
  if (!saved) return '';
  if (saved.usdPerUnit != null) return String(saved.usdPerUnit);
  return saved.perUsd > 0 ? String(Number((1 / saved.perUsd).toFixed(6))) : '';
};

function RateRow({ code, saved, pulled, pulledAt, source, onSave, saving, checked, onToggle }) {
  const [value, setValue] = useState('');
  // The rate in use: today's pull when it replaced the hand set one.
  const auto = source === 'daily' && pulled;
  const shown = auto ? readable(pulled) : shownFor(saved);
  // Re-seeded when the saved rate changes underneath, so a save elsewhere
  // does not leave a stale number in the box.
  useEffect(() => { setValue(shown); }, [shown]);

  const typed = Number(value);
  const valid = Number.isFinite(typed) && typed > 0;
  // Compared as text, so "1.3600" against "1.36" is a change nobody made.
  const changed = valid && value !== shown;
  // The TEXT is sent, so the server stores exactly what was typed.
  const save = () => { if (changed) onSave(code, value.trim()); };

  return (
    <div className={`${ROW} ${checked ? 'row-selected' : ''}`}>
      {/* Only a saved rate can be cleared, so only it can be ticked. */}
      {saved
        ? <input type="checkbox" checked={checked} onChange={() => onToggle(code)} aria-label={`Select the ${code} rate`} />
        : <span aria-hidden="true" />}
      <div className={GROUP}>
        <span className={CODE}>1 {code} =</span>
        <input
          {...numberOnly}
          className={BOX}
          // Not set by hand: today's rate shows as the hint, so the row is never blank.
          placeholder={pulled ? readable(pulled) : 'Value'}
          value={value}
          aria-label={`US dollars for one ${code}`}
          onChange={(event) => nonNegative(event.target.value) && setValue(event.target.value)}
          onKeyDown={(event) => {
            numberOnly.onKeyDown(event);
            if (event.key === 'Enter') save();
          }}
        />
        <span className={UNIT}>USD</span>
      </div>

      <p className={`${NOTE} flex items-center gap-1.5`}>
        <span>
          {auto && `${ROW_SOURCE.daily} · ${pulledAt ? new Date(pulledAt).toLocaleDateString('en-GB') : 'today'}`}
          {!auto && saved && `${ROW_SOURCE.saved} · ${new Date(saved.updatedAt).toLocaleDateString('en-GB')}`}
          {!auto && !saved && (ROW_SOURCE[source] ?? 'No rate')}
        </span>
        <CellInfo
          label={`About the ${code} rate`}
          body={[
            NOTES[code] ?? `What one ${code} is worth in US dollars, as xe.com shows it.`,
            ...(valid ? [`**1 USD = ${readable(1 / typed)} ${code}**.`] : []),
            ...(saved?.updatedBy ? [`Set by ${saved.updatedBy}.`] : []),
            ...(auto && saved ? [`Replaced your manual **${shownFor(saved)}**. Save a rate to use yours until the next pull.`] : []),
            ...(!auto && saved && pulled ? [`Today's auto rate: **1 ${code} = ${readable(pulled)} USD**. The next pull replaces yours.`] : []),
          ]}
        />
      </p>

      {/* Clearing a saved rate is the bulk bar's: tick it, then Clear. */}
      <Button variant="primary" size="form" className={BTN} disabled={!changed || saving} onClick={save}>
        Save
      </Button>
    </div>
  );
}

/**
 * A currency nobody has used yet. Crypto here is a payment METHOD on a
 * fiat row, so nothing needs a coin rate today; the day somebody types USDT
 * into the currency column, the feed may not quote it, and this is the door.
 */
function AddCurrency({ existing, onAdd, saving }) {
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');

  const wanted = code.trim().toUpperCase();
  const typed = Number(value);
  const known = existing.includes(wanted);
  const ready = /^[A-Z]{2,8}$/.test(wanted) && !known && Number.isFinite(typed) && typed > 0;

  return (
    <div className={`${ROW} mt-1 border-0`}>
      <span aria-hidden="true" />
      {/* The same shape, with the code panel typed into rather than fixed. */}
      <div className={GROUP}>
        <span className={`${CODE} border-r-0 pr-0`}>1</span>
        <input
          className={`${CODE} w-20 border-0 border-r bg-surface-sunken uppercase outline-none`}
          placeholder="CODE"
          value={code}
          maxLength={8}
          aria-label="Currency code"
          onChange={(event) => setCode(event.target.value)}
        />
        <input
          {...numberOnly}
          className={BOX}
          placeholder="Value"
          value={value}
          aria-label="US dollars for one of that currency"
          onChange={(event) => nonNegative(event.target.value) && setValue(event.target.value)}
        />
        <span className={UNIT}>USD</span>
      </div>

      <p className={NOTE}>
        {known ? `${wanted} is already above.` : 'Add a currency'}
      </p>

      <Button variant="secondary" size="form" className={BTN} disabled={!ready || saving} onClick={() => { onAdd(wanted, value.trim()); setCode(''); setValue(''); }}>
        Add
      </Button>
    </div>
  );
}

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const FEED = { openexchangerates: 'Open Exchange Rates', 'open.er-api': 'open.er-api.com' };

export default function ConversionRates() {
  const { data, isLoading } = useFxRates();
  const setRate = useSetFxRate();
  const { run } = useBulkActions();
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const [pulling, setPulling] = useState(false);
  // The ticked codes waiting on the confirm.
  const [confirming, setConfirming] = useState(null);

  const saved = new Map((data?.rates ?? []).map((rate) => [rate.code, rate]));
  const sel = useRowSelection([...saved.keys()].sort());

  if (isLoading) return <Skeleton className="h-40 rounded-lg" />;

  const busy = setRate.isPending;
  const pulled = data?.pulled ?? {};
  const sources = data?.sources ?? {};

  // Gone from the list as you confirm. Loops the per-rate DELETE: there is
  // no bulk route for four rows. Back as they were if any of them fails.
  function clearConfirmed() {
    const list = confirming;
    const gone = new Set(list);
    run({
      call: () => Promise.all(list.map((code) => apiService.settings.clearRate(code))),
      invalidates: [['fx-rates'], ['dashboard']],
      optimistic: (qc) => patchQueries(qc, [['fx-rates']], (old) => (
        Array.isArray(old?.rates) ? { ...old, rates: old.rates.filter((r) => !gone.has(r.code)) } : old
      )),
      icon: 'trash',
      toast: bulkMessage('cleared', list.length, 'rate'),
      failure: `Couldn't clear ${list.length} ${list.length === 1 ? 'rate' : 'rates'}`,
    });
    sel.clear();
    setConfirming(null);
  }

  async function pullNow() {
    setPulling(true);
    try {
      const out = await apiService.settings.pullRates();
      notify({ level: 'success', icon: 'check', message: `Today's rates pulled from ${FEED[out.source] ?? out.source}` });
      queryClient.invalidateQueries({ queryKey: ['fx-rates'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      notify({ level: 'error', message: "Couldn't pull today's rates", detail: err.message });
    } finally {
      setPulling(false);
    }
  }

  // What the sheet needs, then anything already saved that the sheet no
  // longer uses, so an obsolete rate can still be cleared.
  const codes = [...new Set([...(data?.needed ?? []), ...saved.keys()])].sort();

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-accent-tint px-2.5 py-1.5 text-xs text-accent-strong">
        <span>
          A pull replaces manual rates. A rate saved after it is used until the next pull.
          {data?.pulledAt ? ` Last pull: ${FEED[data.pulledFrom] ?? data.pulledFrom}, ${when(data.pulledAt)}.` : ' None pulled yet.'}
        </span>
        <Button variant="secondary" size="sm" disabled={pulling} onClick={pullNow}>
          {pulling ? 'Pulling…' : 'Pull now'}
        </Button>
      </div>

      {codes.length === 0 && (
        <p className="py-3 text-center text-xs text-text-faint">No currency on the sheet needs converting yet.</p>
      )}

      {codes.map((code) => (
        <RateRow
          key={code}
          code={code}
          saved={saved.get(code)}
          pulled={pulled[code]}
          pulledAt={data?.pulledAt}
          source={sources[code]}
          saving={busy}
          checked={sel.has(code)}
          onToggle={sel.toggle}
          onSave={(next, usdPerUnit) => setRate.mutate({ code: next, usdPerUnit })}
        />
      ))}

      <AddCurrency existing={codes} saving={busy} onAdd={(code, usdPerUnit) => setRate.mutate({ code, usdPerUnit })} />

      <p className="mt-2 text-xs text-text-faint">
        Type it as xe.com shows it: 1 GBP = 1.36 USD. Applies from this month on.
      </p>

      {confirming && (
        <ConfirmDialog
          title={confirming.length === 1 ? `Clear the ${confirming[0]} rate?` : `Clear ${confirming.length} rates?`}
          subject={confirming.join(', ')}
          detail="Conversions go back to today's pulled rate, or the built in rate where there is one. A saved month keeps the rates it was taken with."
          confirmLabel="Clear"
          onCancel={() => setConfirming(null)}
          onConfirm={clearConfirmed}
        />
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={TrashIcon} variant="danger" onClick={() => setConfirming(sel.ids)}>
          Clear
        </BulkAction>
      </BulkBar>
    </div>
  );
}
