const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

function loadTool(useEndDate) {
  const toolPath = require.resolve('./masterSheet.js');
  const settingsPath = require.resolve('../../repos/settings.repo.js');
  for (const path of [toolPath, settingsPath]) delete require.cache[path];
  require.cache[settingsPath] = stub({
    async get() { return { color_uses_end_date: useEndDate }; },
  });
  return require(toolPath).masterSheetTools.find((tool) => tool.name === 'explain_preset_rules');
}

const { PAYMENT_START_OFFSET_DAYS } = require('../../shared/fromAppointment.helper');

/**
 * IN THE SUMMARY SINCE 2026-09-17, not in a `reply`.
 *
 * It was a computed reply, so this paragraph was the whole answer to
 * anything that reached this tool: asked "why is RICHARD not payable this
 * month" she recited it word for word and never mentioned him, twice in
 * one conversation. A tool that computes a FIGURE hands back the finished
 * sentence; this one explains a RULE, and which part answers depends on
 * the question.
 */
test('the formula answer is computed from the current end date setting', async () => {
  const off = await loadTool(false).handler();
  assert.match(off.summary, /monthly amount ÷ days in the preset month × payable days/i);
  assert.match(off.summary, /no preset uses the full monthly amount/i);
  assert.match(off.summary, /end dates are currently ignored/i);

  const on = await loadTool(true).handler();
  assert.match(on.summary, /end dates are currently included/i);
  // NOT terminal. The general paragraph is one option, offered by name.
  assert.equal(on.computedReply, undefined);
  assert.match(on.summary, /IF THEY ASKED THE GENERAL QUESTION/);
});

/**
 * ===============================
 * * SHE KNEW THE LAST STEP AND NOTHING ABOVE IT
 * ===============================
 * The answer stopped at the payable amount, so "why does hers start in
 * July" had nowhere to go: the two links off the appointment date, which
 * are where every one of these figures actually begins, were not in her
 * prompt at all.
 */

test('the answer carries the whole chain, starting at the appointment date', async () => {
  const { reply, summary } = await loadTool(false).handler();
  const chain = `${reply}\n${summary}`;
  assert.match(chain, /appointment date \+ 90 days/i, 'payment start = appointment + 90');
  assert.match(chain, /appointment \+ one year|appointment date \+ one year/i, 'end = appointment + 1yr');
});

test('the offset comes from the one definition, never retyped', async () => {
  // 90 or 84 is a live question: his two written documents say 84 and his
  // spreadsheet says 90. If the decision moves, her answer has to move.
  const { summary } = await loadTool(false).handler();
  assert.match(summary, new RegExp(`appointment date \\+ ${PAYMENT_START_OFFSET_DAYS} days`, 'i'));
});

test('she is told the appointment edit moves four more cells', async () => {
  const { summary } = await loadTool(false).handler();
  assert.match(summary, /payable days and the payable amount all move with it/i);
  // And that a hand set date is not one of them.
  assert.match(summary, /typed by hand is left alone/i);
});
