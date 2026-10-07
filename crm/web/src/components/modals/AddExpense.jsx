import { useMemo, useState } from 'react';
import Modal from './Modal';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import FloatingField from '../forms/FloatingField';
import { unionOptions } from '../../helpers/optionList';
import { aedAmount } from '../../helpers/expenseAed';
import { formatMoney, formatNumber } from '../../helpers/formatMoney';
import { NUMBER_INPUT, MONEY_INPUT, nonNegative } from '../../helpers/numberInput';
import { AED, SEED_CURRENCIES, STALE_RATE_DAYS } from '../../configs/expenses.config';
import { today } from '../../helpers/formatDate';

// The rate is 8dp, so it takes the free spinner; money counts in pence.
const RATE_INPUT = NUMBER_INPUT;

/**
 * ***************************************************
 * * One expense, added or edited
 * ***************************************************
 *
 * A MODAL, NOT A WIZARD: it is one screen, and a wizard is a form with
 * steps. ONE COMPONENT FOR BOTH ACTS, `mode`, the way DealsEditor gained
 * one: an edit form that drifts from the add form is two answers to what an
 * expense is.
 *
 * THE RATE IS THIS ROW'S OWN. It is suggested from the last expense in the
 * same currency, never from the Settings rates panel, and it is stored on
 * the row so nothing later moves this figure. See docs/expense.md.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const asList = (values) => values.map((v) => ({ value: v, label: v }));


// KEPT BETWEEN ONE RECEIPT AND THE NEXT. A stack of receipts is nearly
// always one currency, one rate and one group; retyping those four for
// every row is the reason somebody reaches for a spreadsheet instead.
const REPEATED = ['spentOn', 'currency', 'exchangeRate', 'groupName', 'spentBy'];

const BLANK = {
  spentOn: today(),
  description: '',
  payee: '',
  currency: '',
  rawAmount: '',
  exchangeRate: '',
  groupName: '',
  spentBy: '',
};

/** A stored row back into the shape this form holds. */
function formFrom(expense) {
  if (!expense) return { ...BLANK };
  return {
    spentOn: String(expense.spent_on ?? '').slice(0, 10) || today(),
    description: expense.description ?? '',
    payee: expense.payee ?? '',
    currency: expense.currency ?? '',
    rawAmount: expense.raw_amount ?? '',
    exchangeRate: expense.exchange_rate ?? '',
    groupName: expense.group_name ?? '',
    spentBy: expense.spent_by ?? '',
  };
}

/** How old the suggested rate is, in whole days, or null if there is none. */
function ageInDays(takenAt) {
  if (!takenAt) return null;
  const then = new Date(takenAt).getTime();
  return Number.isNaN(then) ? null : Math.floor((Date.now() - then) / DAY_MS);
}

export default function AddExpense({
  options, busy, onSave, onClose, expense = null,
}) {
  const editing = Boolean(expense);
  const [form, setForm] = useState(() => formFrom(expense));
  const [added, setAdded] = useState(0);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const suggestion = options?.lastRateByCurrency?.[form.currency];
  const suggestionAge = ageInDays(suggestion?.takenAt);

  /**
   * Picking a currency fills the rate in, and AED fixes it at 1.
   *
   * It is a PREFILL, not a rule: the field stays editable, because an
   * expense converts at the rate on the day it was spent.
   */
  function pickCurrency(code) {
    const next = code ?? '';
    const suggested = options?.lastRateByCurrency?.[next]?.rate;
    setForm((f) => ({
      ...f,
      currency: next,
      exchangeRate: next === AED ? '1' : (suggested ?? f.exchangeRate ?? ''),
    }));
  }

  const rateLocked = form.currency === AED;
  const aed = aedAmount(form.rawAmount, form.exchangeRate);
  const rate = Number(form.exchangeRate);
  const rateUsable = Number.isFinite(rate) && rate > 0;

  const ready = useMemo(() => (
    form.spentOn && form.description.trim() && form.currency
    && form.rawAmount !== '' && Number(form.rawAmount) >= 0
  ), [form]);

  const currencies = unionOptions(options?.currencies, SEED_CURRENCIES);

  const payload = () => ({
    ...form,
    payee: form.payee || null,
    groupName: form.groupName || null,
    spentBy: form.spentBy || null,
    exchangeRate: form.exchangeRate === '' ? null : form.exchangeRate,
  });

  /**
   * SAVE AND ADD ANOTHER keeps the repeated half and clears the rest, so a
   * stack of receipts is one modal rather than eight. The count says how
   * many have gone in, because the modal staying open otherwise looks like
   * a save that did not take.
   */
  function saveAgain() {
    onSave(payload(), {
      keepOpen: true,
      onDone: () => {
        setForm((f) => {
          const next = { ...BLANK };
          for (const key of REPEATED) next[key] = f[key];
          return next;
        });
        setAdded((n) => n + 1);
      },
    });
  }

  return (
    <Modal title={editing ? 'Edit expense' : 'Add expense'} onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FloatingField label="Date" required filled>
            {/* `form-control` on every raw input, or it sizes to its own
                content and sits narrower and shorter than the Select
                opposite it. It matches Select's size="form" exactly. */}
            <input
              type="date"
              className="form-control"
              value={form.spentOn}
              onChange={(e) => set('spentOn', e.target.value)}
            />
          </FloatingField>

          <Select
            label="Payee"
            size="form"
            searchable
            allowCustom
            value={form.payee}
            onChange={(v) => set('payee', v ?? '')}
            options={asList(options?.payees ?? [])}
            placeholder="Who was paid"
          />
        </div>

        {/* SPANS BOTH, because a description is a sentence and half a row
            of empty space beside it reads as a field somebody forgot. */}
        <FloatingField label="Description" required filled={Boolean(form.description)}>
          <input
            type="text"
            className="form-control"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FloatingField>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Currency"
            size="form"
            required
            searchable
            allowCustom
            value={form.currency}
            onChange={pickCurrency}
            options={asList(currencies)}
            placeholder="Pick a currency"
          />

          <FloatingField label="Raw amount" required filled={form.rawAmount !== ''}>
            <input
              {...MONEY_INPUT}
              className="form-control"
              value={form.rawAmount}
              onChange={(e) => nonNegative(e.target.value) && set('rawAmount', e.target.value)}
            />
          </FloatingField>
        </div>

        {/* ===============================
            * THE RATE, AND THE SENTENCE THAT CATCHES IT UPSIDE DOWN
            * ===============================
            Typing 57 for the peso instead of 0.0644 books a ₱5,000 fare as
            AED 285,000. Both directions are printed so whichever way round
            you think about it, the number in front of you is checkable.
            The check sits BESIDE the field, not under it: underneath, it
            pushed every row below out of line with the column opposite. */}
        <div className="grid items-center gap-3 sm:grid-cols-2">
          <FloatingField
            label={`AED per 1 ${form.currency || 'unit'}`}
            filled={form.exchangeRate !== ''}
            hint="This row's own rate, stored on it. Nothing in Settings ever changes it."
          >
            <input
              {...RATE_INPUT}
              className="form-control"
              value={form.exchangeRate}
              disabled={rateLocked}
              onChange={(e) => nonNegative(e.target.value) && set('exchangeRate', e.target.value)}
            />
          </FloatingField>

          <p className="text-xs leading-5 text-text-faint">
            {rateLocked && 'AED converts to itself, so the rate is 1.'}
            {!rateLocked && rateUsable && form.currency && (
              <span className="block tabular-nums text-text-muted">
                1 {form.currency} = {formatNumber(rate, 4)} {AED}
                <br />
                1 {AED} = {formatNumber(1 / rate, 4)} {form.currency}
              </span>
            )}
            {!rateLocked && suggestion && (
              <span className={suggestionAge > STALE_RATE_DAYS ? 'block font-semibold text-warning' : 'block'}>
                {suggestionAge > STALE_RATE_DAYS
                  ? `Your last ${form.currency} rate is ${suggestionAge} days old. Check it.`
                  : `From your last ${form.currency} expense.`}
              </span>
            )}
            {!rateLocked && !suggestion && form.currency && (
              <span className="block">No earlier rate for this currency, so type one.</span>
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Group"
            size="form"
            searchable
            allowCustom
            value={form.groupName}
            onChange={(v) => set('groupName', v ?? '')}
            options={asList(options?.groups ?? [])}
            placeholder="Any group"
          />

          <div>
            <Select
              label="Spent by"
              size="form"
              searchable
              allowCustom
              value={form.spentBy}
              onChange={(v) => set('spentBy', v ?? '')}
              options={asList(options?.spentBy ?? [])}
              placeholder="Who spent it"
            />
            {/* A NAME NOBODY ON THE MASTER SHEET HAS is kept as typed, and
                nobody sees it on WhatsApp: said here, before saving */}
            {form.spentBy && options?.people && !options.people.some((n) => n.toLowerCase() === form.spentBy.trim().toLowerCase()) && (
              <p className="mt-1 text-[11px] text-text-faint">Not on the master sheet, so they won&apos;t see it on WhatsApp.</p>
            )}
          </div>
        </div>

        {/* NOT A FIELD. It is computed from the two above it, and the
            database computes the stored one the same way. */}
        <div className="flex items-baseline justify-between rounded-md bg-surface-sunken px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">AED amount</span>
          <span className="text-sm font-bold tabular-nums">
            {aed === null ? 'Needs an amount and a rate' : formatMoney(aed, AED)}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {added > 0 && (
            <span className="mr-auto text-xs text-text-muted">
              {added} added. The date, currency, rate and group carry over.
            </span>
          )}
          <Button size="md" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          {!editing && (
            <Button size="md" variant="secondary" disabled={!ready || busy} onClick={saveAgain}>
              Save and add another
            </Button>
          )}
          <Button size="md" variant="primary" disabled={!ready || busy} phase={busy ? 'working' : 'idle'} onClick={() => onSave(payload())}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
