const test = require('node:test');
const assert = require('node:assert');
const { toolCall } = require('./readRouter');

const names = { people: ['Gloria', 'Gloria difference', 'Abe', 'Abe Lincoln', 'Nathan'], groups: ['INDIGO', 'MILKMAN', 'NEXUS', 'ALL GROUPS'], companies: ['Souracore', 'Workforce'] };
const none = {
  paymentMethod: '', currency: '', paid: '', status: '', amountMin: null, amountMax: null, endWhen: '', paymentStartWhen: '', appointmentWhen: '', dealStatus: '', roleLabel: '', missingPhone: false, missingBank: false, needsReview: false,
};
const shape = (o) => ({
  sure: true, ask: 'list', person: '', people: [], groups: [], company: '', filters: { ...none, ...(o.filters ?? {}) }, rank: null, preset: '', month: '', ...o, ...(o.filters ? { filters: { ...none, ...o.filters } } : {}),
});

test('A LIST WITH A FLOOR IS A FILTER, not a total ("who\'s on more than 1k")', () => {
  assert.deepEqual(toolCall(shape({ groups: ['INDIGO'], filters: { amountMin: 1000 } }), names), {
    name: 'filter_master_sheet', args: { group: 'INDIGO', amountMin: 1000, amountField: 'monthlyAmount' },
  });
});

test('WHO EARNS THE MOST is a ranked total', () => {
  assert.deepEqual(toolCall(shape({ ask: 'total', groups: ['NEXUS'], rank: 1 }), names), { name: 'total_master_sheet', args: { group: 'NEXUS', rank: 1 } });
});

test('A PERSON\'S TOTAL, and two people added together', () => {
  assert.deepEqual(toolCall(shape({ ask: 'total', person: 'Gloria difference' }), names).args, { person: 'Gloria difference' });
  assert.deepEqual(toolCall(shape({ ask: 'total', people: ['Gloria', 'gloria diference'] }), names).args, { people: ['Gloria', 'Gloria difference'] });
});

test('A NAME NOT ON THE SHEET goes back to the normal turn, never guessed', () => {
  assert.equal(toolCall(shape({ ask: 'total', person: 'Glenda' }), names), null);
  assert.equal(toolCall(shape({ groups: ['WALLABY'] }), names), null);
});

test('several groups, a sheet, a person\'s details', () => {
  assert.deepEqual(toolCall(shape({ groups: ['INDIGO', 'milkman'], filters: { paymentMethod: 'cash' } }), names).args, { groups: ['INDIGO', 'MILKMAN'], paymentMethod: ['cash'] });
  assert.deepEqual(toolCall(shape({ ask: 'sheet', preset: 'bank', groups: ['NEXUS'] }), names), { name: 'show_sheet_preset', args: { preset: 'bank', group: 'NEXUS' } });
  assert.deepEqual(toolCall(shape({ ask: 'details', person: 'Nathan' }), names), { name: 'find_and_show_details', args: { name: 'Nathan' } });
});

test('"IN ALL GROUPS" IS EVERY GROUP, unless they say that group', () => {
  const s = shape({ groups: ['ALL GROUPS'], filters: { paymentMethod: 'cash' } });
  assert.deepEqual(toolCall(s, { ...names, said: 'cash deals over 1000 in all groups' }).args, { paymentMethod: ['cash'] });
  assert.deepEqual(toolCall(s, { ...names, said: 'cash deals in the all groups group' }).args, { group: 'ALL GROUPS', paymentMethod: ['cash'] });
});

test('SEVERAL PEOPLE NAMED TOGETHER IS THEIR TOTAL, whatever the ask', () => {
  assert.deepEqual(toolCall(shape({ ask: 'details', person: 'Gloria', people: ['Gloria', 'Gloria difference'] }), names), { name: 'total_master_sheet', args: { people: ['Gloria', 'Gloria difference'] } });
});
