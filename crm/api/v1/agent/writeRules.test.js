const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeTool } = require('./runAgent');
const { remember } = require('./confirmReplay');
const { broadcast } = require('../sockets');

// ***************************************************
// * The runtime owns a write, not her wording
// ***************************************************
//
// Both found talking to her 2026-09-25:
//   1  she sent `confirmed: true` for a list she had shown half of, and the
//      unseen half was written;
//   2  a "which company?" was remembered as a finished write, and the next
//      "yes" made her claim an add on nobody wrote.

/** A write tool that writes (broadcasts) only when confirmed. */
function rateTool(name, calls) {
  return {
    name,
    writes: true,
    parameters: { type: 'object', properties: { who: { type: 'string' }, confirmed: { type: 'boolean' } } },
    async handler(args) {
      calls.push(Boolean(args.confirmed));
      if (!args.confirmed) return { summary: 'pending', pending: true, confirming: `${args.who} to 3%` };
      broadcast(null, 'people:changed', {});
      return { summary: `${args.who}: done.` };
    },
  };
}

const said = (admin, diane) => [
  { role: 'assistant', content: diane },
  { role: 'user', content: admin },
];

test('HER confirmed IS DROPPED when the admin never saw that change', async () => {
  const calls = [];
  const tool = rateTool('rate_a', calls);
  remember('rate_a', { who: 'Ines Pardew' }, 'Ines Pardew to 3%');
  const out = await invokeTool([tool], 'rate_a', JSON.stringify({ who: 'Ines Pardew', confirmed: true }),
    said('yes please', 'Orla Quennell would go to 3%. Shall I?'));
  assert.deepEqual(calls, [false], 'it wrote what was never shown');
  assert.equal(out.pending, true);
});

test('and it stands when the answer showed it and they said yes', async () => {
  const calls = [];
  const tool = rateTool('rate_b', calls);
  remember('rate_b', { who: 'Ines Pardew' }, 'Ines Pardew to 3%');
  await invokeTool([tool], 'rate_b', JSON.stringify({ who: 'Ines Pardew', confirmed: true }),
    said('yes please', 'Ines Pardew would go to 3%. Shall I?'));
  assert.deepEqual(calls, [true]);
});

test('A CALL THAT WROTE NOTHING IS NEVER "ALREADY DONE" on the next yes', async () => {
  let ran = 0;
  const asks = {
    name: 'ask_c',
    writes: true,
    parameters: { type: 'object', properties: { who: { type: 'string' } } },
    async handler() { ran += 1; return { summary: 'Which company?' }; },
  };
  await invokeTool([asks], 'ask_c', JSON.stringify({ who: 'Bram' }), said('bram tevish', 'Which Bram?'));
  const again = await invokeTool([asks], 'ask_c', JSON.stringify({ who: 'Bram' }), said('yes', 'Which company?'));
  assert.equal(ran, 2);
  assert.doesNotMatch(again.summary, /ALREADY DONE/);
});

test('a call that DID write is refused on a bare yes, quoting what it said', async () => {
  const writes = {
    name: 'write_d',
    writes: true,
    parameters: { type: 'object', properties: { who: { type: 'string' } } },
    async handler(args) { broadcast(null, 'x', {}); return { summary: `${args.who}: payable days to 19.` }; },
  };
  await invokeTool([writes], 'write_d', JSON.stringify({ who: 'Quill' }), said('set quill to 19', 'Hi'));
  const again = await invokeTool([writes], 'write_d', JSON.stringify({ who: 'Quill' }), said('yes', 'Done.'));
  assert.match(again.summary, /ALREADY DONE/);
  assert.match(again.summary, /Quill: payable days to 19/);
});

test('A PENDING BORN IN THE SAME TURN AS THE YES IS NEVER AUTO CONFIRMED', async () => {
  // Her question was about the profile; the call she made was a DEAL bulk
  // write whose only fact, "0", happened to be in that question.
  const calls = [];
  const tool = {
    ...rateTool('rate_e', calls),
    async handler(args) {
      calls.push(Boolean(args.confirmed));
      if (!args.confirmed) return { summary: 'pending', pending: true, confirming: 'set add on % (added) to "0"' };
      broadcast(null, 'x', {});
      return { summary: 'done' };
    },
  };
  const out = await invokeTool([tool], 'rate_e', JSON.stringify({ who: 'Bram' }),
    said('yes', 'Should I set his profile add on to 0?'));
  assert.deepEqual(calls, [false]);
  assert.equal(out.pending, true);
});

test('the same call, pending LAST turn and shown, is confirmed on yes', async () => {
  const calls = [];
  const tool = rateTool('rate_f', calls);
  remember('rate_f', { who: 'Nell Ivory' }, 'Nell Ivory to 3%');
  await invokeTool([tool], 'rate_f', JSON.stringify({ who: 'Nell Ivory' }),
    said('yes', 'Nell Ivory would go to 3%. Shall I?'));
  assert.deepEqual(calls, [false, true]);
});

test('THE TURN RECORDS A REAL WRITE, and only a real one', async () => {
  const calls = [];
  const tool = rateTool('rate_g', calls);
  const turn = { wrote: new Map(), claims: [] };
  await invokeTool([tool], 'rate_g', JSON.stringify({ who: 'Ada' }), said('set ada to 3%', 'Hi'), null, turn);
  assert.equal(turn.wrote.get('__written'), undefined, 'a pending is not a write');
  remember('rate_g', { who: 'Ada' }, 'Ada to 3%');
  await invokeTool([tool], 'rate_g', JSON.stringify({ who: 'Ada', confirmed: true }), said('yes', 'Ada would go to 3%.'), null, turn);
  assert.equal(turn.wrote.get('__written'), true);
});

test('A YES TURN THAT APPLIED ITS CHANGE PROPOSES NO OTHER', async () => {
  const calls = [];
  const tool = rateTool('rate_h', calls);
  const turn = { wrote: new Map([['__held', true]]), claims: [] };
  const out = await invokeTool([tool], 'rate_h', JSON.stringify({ who: 'Ines' }), said('yes', 'Undo it?'), null, turn);
  assert.deepEqual(calls, [], 'a second write ran in the turn that already applied one');
  assert.match(out.summary, /ALREADY APPLIED WHAT THEY AGREED TO/);
});

test('A QUESTION ABOUT A RATE NEVER REACHES A WRITE', async () => {
  const calls = [];
  const tool = rateTool('rate_i', calls);
  const out = await invokeTool([tool], 'rate_i', JSON.stringify({ who: 'Ines' }), said('is ines pardew on a 2% fee?', 'Hi'));
  assert.deepEqual(calls, []);
  assert.match(out.summary, /Call check_rates/);
});
