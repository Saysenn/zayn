const fxRatesRepo = require('../../repos/fxRates.repo');
const undoRepo = require('../../repos/agentUndo.repo');
const fxRates = require('../../shared/fxRates.helper');
const { codeFor } = require('../../shared/toUsd.helper');
const { confirmFirst } = require('./confirmFirst');
const { broadcast } = require('../../sockets/index');

// ***************************************************
// * SETTING THE EXCHANGE RATES, FOR DIANE (his call 2026-10-13)
// ***************************************************
//
// Settings → Global rates, by asking: set a manual rate the xe.com way
// (1 GBP = 1.36 USD), clear one, or pull today's rates (which replaces the
// manual ones, his rule). Reading them stays `exchange_rate`.
//
// THE DIRECTION IS CHECKED IN CODE. A rate typed upside down (0.74 for GBP,
// which is 1 USD in pounds) is the one mistake this screen has already
// had twice; against today's pulled rate it is caught and shown before yes.

const BY = 'Diane';
const read = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: n >= 1 ? 4 : 6 });

/** A sentence when a typed rate looks wrong against today's pull, or null. */
function looksWrong(code, typed, pulledUsdPerUnit) {
  if (!(pulledUsdPerUnit > 0)) return null;
  const ratio = typed / pulledUsdPerUnit;
  const flipped = typed * pulledUsdPerUnit;
  if (Math.abs(flipped - 1) < 0.1 && Math.abs(ratio - 1) > 0.25) {
    return `${read(typed)} looks UPSIDE DOWN: that is what 1 USD is in ${code}. Today 1 ${code} = ${read(pulledUsdPerUnit)} USD.`;
  }
  if (ratio > 1.25 || ratio < 0.8) {
    return `${read(typed)} is ${Math.round(Math.abs(ratio - 1) * 100)}% away from today's rate (1 ${code} = ${read(pulledUsdPerUnit)} USD).`;
  }
  return null;
}

const setExchangeRate = {
  name: 'set_exchange_rate',
  writes: true,
  description:
    'Change the exchange rates in Settings. `rates`: manual rates the xe.com way, what ONE of the currency '
    + 'is worth in US dollars (1 GBP = 1.36 USD → GBP "1.36"). `clear`: currencies to take back to the daily '
    + 'rate. `pull`: fetch today\'s rates now, which replaces the manual ones. Confirmed false first and show '
    + 'the lines; true only after yes. `undo` true puts back your last change AT ONCE (no confirm). To READ a rate use exchange_rate.',
  parameters: {
    type: 'object',
    properties: {
      rates: {
        type: 'array',
        items: {
          type: 'object',
          properties: { currency: { type: 'string' }, usdPerUnit: { type: 'string', description: 'As they said it: "1.36".' } },
          required: ['currency', 'usdPerUnit'],
        },
      },
      clear: { type: 'array', items: { type: 'string' } },
      pull: { type: 'boolean' },
      undo: { type: 'boolean' },
      confirmed: { type: 'boolean', description: 'False first, which changes nothing. True only after they said yes.' },
    },
  },
  async handler(args = {}) {
    if (args.undo) return undoRates();
    const saved = new Map((await fxRatesRepo.all()).map((r) => [r.code, r]));
    const live = await fxRates.usdPerGbp();
    const day = await fxRatesRepo.daily().catch(() => null);
    const pulled = (code) => (day?.perUsd?.[code] > 0 ? 1 / day.perUsd[code] : null);
    const inUse = (code) => (live.perUsd?.[code] > 0 ? 1 / live.perUsd[code] : null);

    const lines = [];
    const warnings = [];
    const sets = [];
    const clears = [];
    const refused = [];
    for (const r of args.rates ?? []) {
      const code = codeFor(r.currency) ?? String(r.currency ?? '').trim().toUpperCase();
      const typed = String(r.usdPerUnit ?? '').trim().replace(/^\$|usd$/gi, '').trim();
      const n = Number(typed);
      if (!/^[A-Z]{2,8}$/.test(code)) { refused.push(`"${r.currency}" is not a currency code`); continue; }
      if (code === 'USD') { refused.push('USD is the base; it has no rate'); continue; }
      if (!/^\d*\.?\d+$/.test(typed) || !(n > 0)) { refused.push(`"${r.usdPerUnit}" is not a rate for ${code}`); continue; }
      const now = inUse(code);
      lines.push(`${lines.length + 1}. ${code}: ${now ? `1 ${code} = ${read(now)} USD (${live.sources?.[code] === 'saved' ? 'manual' : 'auto'})` : 'no rate'} → 1 ${code} = ${typed} USD (manual)`);
      const w = looksWrong(code, n, pulled(code));
      if (w) warnings.push(`${code}: ${w}`);
      sets.push({ code, typed });
    }
    for (const c of args.clear ?? []) {
      const code = codeFor(c) ?? String(c ?? '').trim().toUpperCase();
      if (!saved.has(code)) { refused.push(`${code} has no manual rate to clear`); continue; }
      lines.push(`${lines.length + 1}. ${code}: manual ${saved.get(code).usdPerUnit ?? read(1 / saved.get(code).perUsd)} cleared → today's rate${pulled(code) ? ` (1 ${code} = ${read(pulled(code))} USD)` : ''}`);
      clears.push(code);
    }
    if (args.pull) {
      lines.push(`${lines.length + 1}. Pull today's rates now: it replaces every manual rate it quotes${saved.size ? ` (${[...saved.keys()].join(', ')})` : ''}.`);
    }
    if (refused.length) return { summary: `NOTHING HAS BEEN CHANGED. ${refused.join('. ')}. Ask them.` };
    if (!lines.length) return { summary: 'Say which rate to set, clear, or to pull today\'s. Nothing has been changed.' };

    const pending = confirmFirst(args.confirmed, {
      act: 'change the exchange rates every total converts at, from this month on',
      count: lines.length,
      noun: 'change',
      keeps: `${warnings.length ? `CHECK FIRST, say this to them plainly: ${warnings.join(' ')} ` : ''}Saved months keep their rates.`,
      lines,
      // Matched against what she read out, which drops the "1." numbering.
      identity: lines.map((l) => l.replace(/^\d+\.\s*/, '')).join(' '),
    });
    if (pending) return pending;

    // Keep what each replaced, for undo (a pull cannot be undone: it is the market's).
    const restore = [...sets.map((s) => s.code), ...clears].map((code) => {
      const r = saved.get(code);
      return { code, usdPerUnit: r ? String(r.usdPerUnit ?? 1 / r.perUsd) : null };
    });
    for (const s of sets) {
      // eslint-disable-next-line no-await-in-loop
      await fxRatesRepo.set(s.code, s.typed, BY);
    }
    for (const code of clears) {
      // eslint-disable-next-line no-await-in-loop
      await fxRatesRepo.remove(code);
    }
    let pulledNote = '';
    if (args.pull) {
      const out = await fxRates.pullDaily({ force: true });
      pulledNote = out.pulled ? ` Today's rates pulled from ${out.source}.` : ` The pull failed: ${out.reason}.`;
    }
    fxRates.resetCache();
    if (restore.length) await undoRepo.record('rates', `${restore.map((r) => r.code).join(', ')} rate`, { rates: restore }, BY);
    broadcast(null, 'fx-rates:changed', { via: 'agent' });

    // READ BACK what conversions now use.
    const after = await fxRates.usdPerGbp();
    const check = sets.map((s) => `1 ${s.code} = ${read(1 / after.perUsd[s.code])} USD`).join(', ');
    const reply = `Done.${check ? ` Now ${check}.` : ''}${clears.length ? ` ${clears.join(', ')} back on today's rate.` : ''}${pulledNote} Saved months keep their rates.`;
    return { summary: reply, reply, computedReply: true };
  },
};

async function undoRates() {
  const last = await undoRepo.latest('rates');
  if (!last) {
    const reply = 'There is no rate change of mine to undo. A pull of today\'s rates cannot be undone.';
    return { summary: reply, reply, computedReply: true };
  }
  // AT ONCE, like the Liquidations page's undo: see liquidations.js.
  const rates = last.restore.rates ?? [];
  for (const r of rates) {
    // eslint-disable-next-line no-await-in-loop
    if (r.usdPerUnit) await fxRatesRepo.set(r.code, r.usdPerUnit, `${BY} (undo)`);
    // eslint-disable-next-line no-await-in-loop
    else await fxRatesRepo.remove(r.code);
  }
  fxRates.resetCache();
  await undoRepo.markUndone(last.id);
  const reply = `Undone: ${rates.map((r) => (r.usdPerUnit ? `${r.code} back to 1 ${r.code} = ${r.usdPerUnit} USD (manual)` : `${r.code} back on today's rate`)).join(', ')}.`;
  return { summary: reply, reply, computedReply: true };
}

module.exports = { fxTools: [setExchangeRate], setExchangeRate, looksWrong };
