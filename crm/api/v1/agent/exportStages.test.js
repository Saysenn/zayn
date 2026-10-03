const test = require('node:test');
const assert = require('node:assert/strict');
const { answeredBy, STEP } = require('./exportStages');

/**
 * ***************************************************
 * * WIDENING IS ONLY AN ANSWER IF THEY ASKED FOR IT
 * ***************************************************
 *
 * Live transcript 2026-09-06. "yeah I want the bank sheet" came back as
 * "Switched the document to Bank FOR EVERY GROUP". She had set `allGroups`
 * herself, which settled the Groups step, so the card skipped a question
 * nobody had answered. The next turn asked for NEXUS and could not rescope,
 * because the step it belonged to was already gone.
 */

test('naming groups is always an answer', () => {
  assert.ok(answeredBy({ groups: ['NEXUS'] }).includes(STEP.GROUPS));
  // Even with no words at all: they picked from the card.
  assert.ok(answeredBy({ groups: ['NEXUS', 'INDIGO'], said: '' }).includes(STEP.GROUPS));
});

test('widening settles the step when their own words widened it', () => {
  for (const said of [
    'actually no, all of them',
    'every group please',
    'the whole book',
    'both of them',
  ]) {
    assert.ok(
      answeredBy({ allGroups: true, said }).includes(STEP.GROUPS),
      `"${said}" should settle the groups step`,
    );
  }
  // The legacy spelling settles it on the same evidence.
  assert.ok(answeredBy({ everyGroup: true, said: 'all of them' }).includes(STEP.GROUPS));
});

test('widening she decided on her own does NOT settle the step', () => {
  assert.equal(answeredBy({ allGroups: true, said: 'yeah I want the bank sheet' }).includes(STEP.GROUPS), false);
  assert.equal(answeredBy({ allGroups: true, said: '' }).includes(STEP.GROUPS), false);
  assert.equal(answeredBy({ allGroups: true }).includes(STEP.GROUPS), false);
});

test('a step already answered stays answered', () => {
  const before = [STEP.SHEET, STEP.GROUPS];
  assert.ok(answeredBy({ allGroups: true, said: 'the bank sheet' }, before).includes(STEP.GROUPS));
});

test('the other steps are untouched by this', () => {
  assert.ok(answeredBy({ template: 'bank' }).includes(STEP.SHEET));
  assert.ok(answeredBy({ breakdownDesign: 'standard' }).includes(STEP.BREAKDOWN));
  assert.ok(answeredBy({ primaryColor: 'green' }).includes(STEP.COLOUR));
  assert.ok(answeredBy({ multiFile: false }).includes(STEP.DELIVERY));
  assert.ok(answeredBy({ hideColumns: ['sort_code'] }).includes(STEP.COLUMNS));
});
