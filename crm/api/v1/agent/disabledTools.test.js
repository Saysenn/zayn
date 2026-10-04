const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveContext } = require('./contexts');
const {
  withDisabled, DISABLED_TOOLS, DISABLED, CANNOT, POINTS_AT, checkPointed,
} = require('./disabledTools');

/**
 * ***************************************************
 * * Turned off means it cannot finish, not that it is asked not to
 * ***************************************************
 *
 * Export and add-a-deal were off from 2026-09-09 and came back on
 * 2026-09-29: his test list for that night expects both. The list is
 * empty now, and the MACHINERY is still pinned here against a fixture, so
 * turning one off again is one line and still refuses in the handler.
 */

const toolsOf = () => resolveContext('master-sheet').tools;
const byName = (name) => toolsOf().find((t) => t.name === name);

// The shape an entry takes, kept as a fixture for the day one goes back on.
const FIXTURE = {
  export_sheet: "I can't export a sheet for you honey. Hit the Export button at the top of the "
    + 'Master sheet page.',
};
const FIXTURE_POINTS = { export_sheet: 'Export' };

test('export is off, adding a deal is live (both 2026-09-29)', () => {
  assert.deepEqual([...DISABLED_TOOLS], ['export_sheet']);
  assert.equal(POINTS_AT.export_sheet, 'Export');
  assert.ok(CANNOT.export_sheet.includes('Export button'));
  assert.ok(DISABLED.export_sheet.includes('Export button'));
  const exp = byName('export_sheet');
  assert.ok(exp, 'still there, so turning it on again is one line');
  assert.match(exp.description, /TURNED OFF/);
  assert.equal(exp.disabledTool, true);
  // The add FORM went 2026-10-04: adding a deal is asked in words now.
  assert.equal(byName('new_deal_checklist'), undefined, 'the add-a-deal form is gone');
  for (const name of ['add_deal', 'update_master_sheet_row']) {
    const tool = byName(name);
    assert.ok(tool, `${name} is offered`);
    assert.doesNotMatch(tool.description, /TURNED OFF/, `${name} is live`);
    assert.notEqual(tool.disabledTool, true);
  }
});

test('CALLING EXPORT DOES NOTHING, and hands back his sentence', async () => {
  const out = await byName('export_sheet').handler({ template: 'bank' });
  assert.ok(out.summary.startsWith(DISABLED.export_sheet));
  assert.equal(out.disabled, 'export_sheet');
  assert.equal(out.card, undefined);
});

test('CALLING A DISABLED ONE DOES NOTHING, and hands back the finished sentence', async () => {
  const [tool] = withDisabled(
    [{ name: 'export_sheet', description: 'x', parameters: {}, handler: async () => ({ card: 1 }) }],
    FIXTURE,
  );
  const out = await tool.handler({ template: 'bank' });
  assert.ok(out.summary.startsWith(FIXTURE.export_sheet));
  assert.equal(out.card, undefined, 'the original handler never runs');
  assert.match(out.summary, /do not claim otherwise/);
  assert.match(out.summary, /do not try another tool/);
  assert.equal(out.disabled, 'export_sheet', 'marked, so a guard can check she followed it');
  assert.equal(tool.disabledTool, true, 'says so on itself, so the gates can stand aside');
  assert.match(tool.description, /TURNED OFF/);
  assert.ok(tool.description.includes(FIXTURE.export_sheet));
});

test('a tool that is not on the list is passed through untouched', () => {
  const original = { name: 'total_master_sheet', description: 'd', parameters: {}, handler: async () => ({ ok: 1 }) };
  assert.equal(withDisabled([original], FIXTURE)[0], original, 'the same object, not a copy');
  assert.equal(withDisabled([original])[0], original);
});

test('an invented pending export is caught', () => {
  const refused = [{ disabled: 'export_sheet' }];
  const out = checkPointed(
    'You want the bank master sheet for all groups in September, got it! '
    + 'But I need you to say "go" or "build it" to start the export.',
    refused,
    FIXTURE_POINTS,
  );
  assert.equal(out.ok, false);
  assert.equal(out.button, 'Export');
});

test('her own words pass, so long as the button is named', () => {
  const refused = [{ disabled: 'export_sheet' }];
  for (const said of [
    'That one is not mine any more. Hit the Export button on the Master sheet page.',
    'I cannot build that, honey. The export button up top will do it faster.',
  ]) assert.equal(checkPointed(said, refused, FIXTURE_POINTS).ok, true, said);
});

test('it is silent when nothing was refused', () => {
  assert.equal(checkPointed('anything at all', [{ rows: [] }], FIXTURE_POINTS).ok, true);
  assert.equal(checkPointed('anything at all', []).ok, true);
});

test('the export gate stands aside for a disabled tool', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  assert.match(src, /name === 'export_sheet' && !tool\.disabledTool/);
});
