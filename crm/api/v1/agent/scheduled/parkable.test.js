
// ---- a later month said as timing (2026-10-13) ----
{
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { LATER_TIMING } = require('./parkable');
  test('A LATER MONTH AS TIMING is caught, a month as a VALUE is not', () => {
    for (const s of ['from next month put ines calder on 4200', 'as of december bump juno to 700', 'stop otto fenn end of this month', 'add 5% to kiran vale deals next month']) {
      assert.ok(LATER_TIMING.test(s), s);
    }
    for (const s of ['can u set the preset for everyone in otter to next month', 'set juno payment start to next month', 'give everyone in baker 5% raise']) {
      assert.ok(!LATER_TIMING.test(s), s);
    }
  });
}
