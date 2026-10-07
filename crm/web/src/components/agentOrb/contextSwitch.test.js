import test from 'node:test';
import assert from 'node:assert/strict';
import { readSwitch } from './contextSwitch.js';

const CONTEXTS = [{ key: 'master-sheet' }, { key: 'expenses' }, { key: 'debts', soon: true }];
const read = (t) => readSwitch(t, CONTEXTS);

test('SAYING THE CONTEXT switches, in many wordings and with a slip', () => {
  for (const t of ['expenses', 'Expenses.', 'go to expenses', "let's do expenses", 'okay, expenses mode', 'expnses', 'take me to the spending side']) {
    assert.equal(read(t)?.key, 'expenses', t);
  }
  for (const t of ['back to the master sheet', 'open master sheet please', 'deals', 'master']) {
    assert.equal(read(t)?.key, 'master-sheet', t);
  }
  assert.deepEqual(read('switch to debts'), { key: 'debts', soon: true, rest: '' }, 'coming soon is still recognised');
});

test('A REQUEST AFTER THE SWITCH is kept for the new context', () => {
  assert.deepEqual(read('go to expenses, taxi 45 for MANBAT'), { key: 'expenses', soon: false, rest: 'taxi 45 for MANBAT' });
  assert.equal(read('switch to expenses and add taxi 45').rest, 'add taxi 45');
});

test('NOT A SWITCH: questions and requests that merely mention a context', () => {
  for (const t of ['how much were expenses this month', 'add expense taxi 45', 'expense report for INDIGO', 'show me paddy', 'remove the taxi']) {
    assert.equal(read(t), null, t);
  }
});

test('STARTS LIKE A SWITCH but names nothing known: the meaning check decides', () => {
  assert.deepEqual(read('go to the money stuff'), { maybe: 'go to the money stuff', rest: '' });
});
