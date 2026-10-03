import { useEffect, useState } from 'react';
import Button from '../buttons/Button';
import CellInfo from '../display/CellInfo';
import { Skeleton } from '../display/Skeleton';
import { useClearFxRate, useFxRates, useSetFxRate } from '../../hooks/useSettings';
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
 */

// Only a currency whose rate has a story needs a note.
// EVERY ONE READS IN THE BOX'S OWN DIRECTION, so a note can be acted on
// without translating it. The AED note already did, and was the one rate
// somebody got right.
const NOTES = {
  GBP: 'How many pounds one dollar buys. Also the export rate when nothing is typed into the run.',
  EUR: 'The sheet writes EURO. It is read as EUR, so set it here as EUR. Paste the "1 USD = ..." figure.',
  AED: 'Pegged at 3.6725 per dollar since 1997. Set it only if that changes.',
  USD: 'The base. It is never converted.',
};

const SOURCE_NOTE = {
  live: 'A live feed is answering, so these are a standby and are not in use today.',
  cache: 'A rate fetched earlier is still current, so these are a standby.',
  saved: 'These are what every conversion is using right now.',
  fallback: 'No feed and nothing saved: conversions use the built in GBP rate and the AED peg, and every other currency is reported as unconvertible.',
};

// One grid, so every row's boxes and buttons line up instead of each row
// wrapping to its own shape.
const ROW = 'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-0 sm:grid-cols-[15rem_1fr_auto]';

/**
 * ===============================
 * * THE CODE IS AN ADDON, NOT A SENTENCE
 * ===============================
 * `AED | value`. It was a floating label reading "1 AED in USD", then an
 * equation reading `1 AED = [ ] USD`, and both put words where the eye
 * wants a column. A currency code on its own panel, then the box, is the
 * shape every payment form uses because it scans in one glance.
 *
 * The code is a PERSISTENT label, so it is not the "placeholder alone" the
 * forms rule forbids: it does not vanish when you type. The box only ever
 * holds a number, which is why its placeholder can just say so.
 */
const GROUP = 'flex items-stretch overflow-hidden rounded border border-border-strong bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-accent-strong focus-within:outline-offset-1';
const CODE = 'flex min-h-9 shrink-0 items-center border-r border-border-strong bg-surface-sunken px-2.5 text-xs font-semibold text-text-muted';
// Border and padding come from the group, so the box inside draws neither.
// A class beats the base `input` element rule on specificity.
const BOX = 'min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm tabular-nums outline-none min-h-9';

// Negatives blocked on the key and on the change. One definition, shared
// with the expenses form: see helpers/numberInput.js.
const numberOnly = NUMBER_INPUT;

/**
 * ===============================
 * * NOTHING IS INVERTED ON THE WAY IN OR OUT. Migration 065.
 * ===============================
 * The column holds units per dollar, which is what this box takes, so the
 * number you type is the number that is stored and the number that comes
 * back. There is no round trip left to lose anything in.
 *
 * IT WAS INVERTED HERE FOR HALF A DAY. `numeric(18, 8)` keeps eight
 * decimals and 1 / (1 / 3.75) is 3.74999995 at that precision, so a typed
 * rate came home changed: 3.67 as 3.67000005, the AED peg as 3.67249997.
 * Rounding the display was the alternative and is not a fix, because six
 * decimals straightens AED and mangles PHP.
 *
 * `flip` survives for the one thing that genuinely reads the other way:
 * the stored half, shown inside the icon.
 */
const flip = (n) => 1 / n;

function RateRow({ code, saved, onSave, onClear, saving }) {
  const [value, setValue] = useState('');
  // What the box holds for the saved rate. The column's own value, with no
  // conversion, so it is exactly what somebody typed. Named, because
  // `changed` compares against it.
  const shown = saved ? String(saved.perUsd) : '';
  // Re-seeded when the saved rate changes underneath, so a save elsewhere
  // does not leave a stale number in the box.
  useEffect(() => { setValue(shown); }, [shown]);

  const typed = Number(value);
  const valid = Number.isFinite(typed) && typed > 0;
  /**
   * COMPARED AS TEXT, against what the box was seeded with, so "3.6700"
   * and "3.67" are a change nobody made. It also used to be the only way
   * to avoid Save lighting up on every untouched row, back when the value
   * was inverted on both sides and never came back exactly equal.
   */
  const changed = valid && value !== shown;

  // STRAIGHT THROUGH. What is typed is what is stored. Migration 065.
  const save = () => { if (changed) onSave(code, typed); };

  return (
    <div className={ROW}>
      <div className={GROUP}>
        <span className={CODE}>{code}</span>
        <input
          {...numberOnly}
          className={BOX}
          placeholder="Value"
          value={value}
          aria-label={`${code} for one US dollar`}
          onChange={(event) => nonNegative(event.target.value) && setValue(event.target.value)}
          onKeyDown={(event) => {
            numberOnly.onKeyDown(event);
            if (event.key === 'Enter') save();
          }}
        />
      </div>

      {/* The note lives HERE, in its own cell. Beside the field it was an
          icon sitting on top of this text: the group is elastic and the
          column is not. */}
      <p className="col-span-2 flex items-center gap-1.5 text-[11px] text-text-faint sm:col-span-1 sm:text-xs">
        <span>
          {/* ===============================
              * THE ROW READS ONE WAY, END TO END
              ===============================
              It showed the INVERSE here, on the reasoning that the row
              should display both halves. That put two directions back on
              one line, which is the whole fault this change removed: the
              box said 0.87 and the sentence said 1.1494 beside it. His
              call 2026-09-23.

              The box's OWN TEXT, not a reformatted number, so a pasted
              0.87927969 reads back exactly and can be checked against the
              site it came from. The stored half moved into the icon. */}
          {valid && <span className="tabular-nums text-text-muted">1 USD = {value.trim()} {code}. </span>}
          {saved
            ? `Saved ${new Date(saved.updatedAt).toLocaleDateString('en-GB')}${saved.updatedBy ? ` by ${saved.updatedBy}` : ''}`
            : 'Not set'}
        </span>
        {/* THE STORED HALF LIVES HERE, not on the row. It is the number the
            converter actually multiplies by, so it is worth being able to
            see; it is not worth a second direction on a line somebody
            reads at a glance. An icon is where extra information goes. */}
        <CellInfo
          label={`About the ${code} rate`}
          // `body`, not children: it is the popup's own shape, so the two
          // paragraphs get their spacing from one place.
          body={[
            NOTES[code] ?? `How many ${code} one US dollar buys.`,
            ...(valid ? [`Stored as **1 ${code} = ${formatNumber(flip(typed), 6)} USD**, which is what every conversion multiplies by.`] : []),
          ]}
        />
      </p>

      <div className="flex items-center gap-1.5">
        <Button variant="primary" size="form" disabled={!changed || saving} onClick={save}>
          Save
        </Button>
        {saved && (
          <Button variant="danger" size="form" disabled={saving} onClick={() => onClear(code)}>Clear</Button>
        )}
      </div>
    </div>
  );
}

/**
 * A currency nobody has used yet.
 *
 * Crypto in this CRM is a payment METHOD and the row is still denominated
 * in fiat, so nothing needs a coin rate today. The day somebody types USDT
 * into the currency column, the feed will not quote it and the built in
 * fallback carries three fiat currencies, so without this the amount is
 * unconvertible for good.
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
      {/* The same shape, with the code panel typed into rather than fixed. */}
      <div className={GROUP}>
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
          aria-label="How many of that currency one US dollar buys"
          onChange={(event) => nonNegative(event.target.value) && setValue(event.target.value)}
        />
      </div>

      <p className="col-span-2 text-[11px] text-text-faint sm:col-span-1 sm:text-xs">
        {known ? `${wanted} already has a row above.` : 'A currency not on the sheet yet, a coin included.'}
      </p>

      {/* FLIPPED HERE TOO. The two doors write the same column, so a new
          currency added the other way up would be the original fault back
          on the one row nobody would think to check. */}
      <Button variant="secondary" size="form" disabled={!ready || saving} onClick={() => { onAdd(wanted, typed); setCode(''); setValue(''); }}>
        Add
      </Button>
    </div>
  );
}

export default function ConversionRates() {
  const { data, isLoading } = useFxRates();
  const setRate = useSetFxRate();
  const clearRate = useClearFxRate();

  if (isLoading) return <Skeleton className="h-40 rounded-lg" />;

  const saved = new Map((data?.rates ?? []).map((rate) => [rate.code, rate]));
  const inUse = data?.inUse ?? 'fallback';
  const busy = setRate.isPending || clearRate.isPending;
  // What the sheet needs, then anything already saved that the sheet no
  // longer uses, so an obsolete rate can still be cleared.
  const codes = [...new Set([...(data?.needed ?? []), ...saved.keys()])].sort();
  const backfilled = data?.backfilled ?? [];

  return (
    <div>
      <p className={`mb-2 rounded-md px-2.5 py-1.5 text-[11px] ${inUse === 'saved' ? 'bg-accent-tint text-accent-strong' : 'bg-surface-sunken text-text-muted'}`}>
        {SOURCE_NOTE[inUse] ?? SOURCE_NOTE.fallback}
        {/* A saved rate can be in use even while the feed answers, for a
            currency the feed does not quote. Without this the banner above
            reads as "none of these are being used". */}
        {backfilled.length > 0 && (
          <span className="block text-accent-strong">
            {backfilled.join(', ')} {backfilled.length === 1 ? 'is' : 'are'} not quoted by the feed, so your saved
            {backfilled.length === 1 ? ' rate is' : ' rates are'} in use for {backfilled.length === 1 ? 'it' : 'those'}.
          </span>
        )}
      </p>

      {codes.length === 0 && (
        <p className="py-3 text-center text-xs text-text-faint">No currency on the sheet needs converting yet.</p>
      )}

      {codes.map((code) => (
        <RateRow
          key={code}
          code={code}
          saved={saved.get(code)}
          saving={busy}
          onSave={(next, perUsd) => setRate.mutate({ code: next, perUsd })}
          onClear={(next) => clearRate.mutate(next)}
        />
      ))}

      <AddCurrency existing={codes} saving={busy} onAdd={(code, perUsd) => setRate.mutate({ code, perUsd })} />

      <p className="mt-2 text-[11px] text-text-faint">
        A change applies to this month onward. A saved month keeps the rates it was taken with.
      </p>
    </div>
  );
}
