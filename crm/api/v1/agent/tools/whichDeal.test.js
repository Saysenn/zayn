const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { whatSeparates, dealsWhere } = require('./whichDeal');

/**
 * ***************************************************
 * * ASKING ON THE FIELD THAT CANNOT TELL THEM APART
 * ***************************************************
 *
 * Four times, same shape, two doors:
 *
 *   2026-09-18, closure: "Gloria holds 4 live deals: Workforce, Workforce,
 *     Workforce, Workforce. Ask which company they mean."
 *   2026-09-29, update:  "Zayn has 2 deals. Which company, or both?" with
 *     both deals on Workforce, one in MILKMAN and one in INDIGO.
 *
 * A question whose answer narrows nothing is the dead end `resolvePerson`
 * exists to prevent one level up.
 */

// Zayn's real rows, the ones that produced the 2026-09-29 transcript.
const ZAYN = [
  { id: 1, company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' },
  { id: 2, company: 'Workforce', group_name: 'MILKMAN', role_label: 'Tech' },
];

test('THE REAL FAULT: one company, two groups, so the question is the GROUP', () => {
  assert.equal(whatSeparates(ZAYN), 'group');
});

test('AND A COMPANY THAT REALLY DOES DIFFER IS STILL THE COMPANY', () => {
  assert.equal(whatSeparates([
    { company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' },
    { company: 'A J Rayson', group_name: 'INDIGO', role_label: 'Tech' },
  ]), 'company');
});

test('THE ROLE IS THE LAST RESORT, and only when it is the only difference', () => {
  assert.equal(whatSeparates([
    { company: 'Workforce', group_name: 'INDIGO', role_label: 'Director' },
    { company: 'Workforce', group_name: 'INDIGO', role_label: 'Mid 1' },
  ]), 'role');
});

test('ALIKE ON ALL THREE RETURNS NULL, rather than inventing a field', () => {
  // A real answer, not a miss. The caller has to ask by deal, and
  // pretending otherwise is how this came back four times.
  assert.equal(whatSeparates([
    { id: 1, company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' },
    { id: 2, company: 'Workforce', group_name: 'INDIGO', role_label: 'Tech' },
  ]), null);
  assert.equal(whatSeparates([]), null);
  assert.equal(whatSeparates(undefined), null);
});

test('CASE AND SPACING ARE NOT A DIFFERENCE', () => {
  // "Relia PA" and "Relia Pa" are one company, as everywhere else.
  assert.equal(whatSeparates([
    { company: 'Relia PA', group_name: 'INDIGO', role_label: 'Tech' },
    { company: 'Relia  Pa', group_name: 'INDIGO', role_label: 'Tech' },
  ]), null);
});

test('THE LIST SAYS BOTH HALVES, never only the one that differs', () => {
  // A list saying only the group reads as a list of groups.
  assert.equal(dealsWhere(ZAYN), 'Workforce in INDIGO; Workforce in MILKMAN');
  assert.equal(dealsWhere([{ id: 7 }]), '#7');
});

/* ---- and both doors read it ---- */

const read = (file) => readFileSync(require.resolve(file), 'utf8');

test('THE CARD LIST NAMES THE FIELD THAT DIFFERS', () => {
  const src = read('./masterSheet.js');
  const fn = src.slice(src.indexOf('function dealList('), src.indexOf('function dealList(') + 400);
  assert.match(fn, /whatSeparates\(rows\)/);
  assert.doesNotMatch(fn, /subtitle: 'Choose a company/, 'the hardcoded company is the bug');
});

test('AND SO DOES THE CLOSURE REFUSAL, from the same function', () => {
  const src = read('./closure.js');
  assert.match(src, /whatSeparates, dealsWhere \} = require\('\.\/whichDeal'\)/);
  assert.doesNotMatch(src, /const sameCompany =/, 'the second copy is gone');
});

test('AND NEITHER DOOR IMPORTS THE OTHER', () => {
  // The reason this has its own file. masterSheet is 7,800 lines and must
  // not become a dependency of every tool that asks which deal.
  assert.doesNotMatch(read('./closure.js'), /require\('\.\/masterSheet'\)/);
  assert.doesNotMatch(read('./whichDeal.js'), /require\('\.\/(masterSheet|closure)'\)/);
});
