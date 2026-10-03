const test = require('node:test');
const assert = require('node:assert/strict');
const { streamCompletion } = require('./runAgent');

/**
 * ***************************************************
 * * NOTHING REACHES THE SCREEN UNTIL THE TURN COMMITS
 * ***************************************************
 *
 * Live 2026-09-17: she wrote an answer and then instantly replaced it. The
 * cleaned text went out as it arrived, and three things could overwrite it
 * afterwards: prose sent in the same message as tool calls, a guard retry
 * streaming a second answer over the first, and a tool's computed terminal
 * reply.
 *
 * Reassembly had no test at all, which is the half that matters most:
 * getting tool call accumulation wrong breaks every write she makes.
 */

/** The provider's stream, faked. Deltas in, one completion out. */
function fakeOpenAI(chunks) {
  const sent = [];
  return {
    sent,
    chat: {
      completions: {
        create: async (params) => {
          sent.push(params);
          return (async function* stream() {
            for (const chunk of chunks) yield chunk;
          }());
        },
      },
    },
  };
}

const content = (text) => ({ choices: [{ delta: { content: text } }] });
const done = (reason = 'stop') => ({ choices: [{ delta: {}, finish_reason: reason }] });

test('it takes no emitter at all, so there is nothing to leak through', () => {
  // The guard is the SIGNATURE. An optional callback is one careless
  // argument away from putting half an answer back on screen.
  assert.equal(streamCompletion.length, 2);
});

test('content deltas are reassembled whole', async () => {
  const openai = fakeOpenAI([content('Richard'), content("'s payable"), content(' days: 30.'), done()]);
  const out = await streamCompletion(openai, { model: 'x', messages: [] });

  assert.equal(out.choices[0].message.content, "Richard's payable days: 30.");
  assert.equal(out.choices[0].finish_reason, 'stop');
  assert.equal(out.choices[0].message.tool_calls, undefined);
});

test('it asks the provider to stream, and passes the params through', async () => {
  const openai = fakeOpenAI([content('hi'), done()]);
  await streamCompletion(openai, { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(openai.sent[0].stream, true);
  assert.equal(openai.sent[0].model, 'gpt-x');
});

// ===============================
// * TOOL CALLS ARRIVE AS DELTAS TOO, and indexed so they interleave
// ===============================
test('two interleaved tool calls accumulate into two whole calls', async () => {
  const openai = fakeOpenAI([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'find_and', arguments: '{"name":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'total_', arguments: '{"group":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '_show_details', arguments: '"Richard"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'master_sheet', arguments: '"ALPHA"}' } }] } }] },
    done('tool_calls'),
  ]);
  const out = await streamCompletion(openai, { model: 'x', messages: [] });
  const calls = out.choices[0].message.tool_calls;

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.function.name), ['find_and_show_details', 'total_master_sheet']);
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.function.arguments)),
    [{ name: 'Richard' }, { group: 'ALPHA' }],
  );
  assert.deepEqual(calls.map((c) => c.id), ['a', 'b']);
});

test('prose sent ALONGSIDE tool calls is kept for the loop and shown to nobody', async () => {
  // "Let me check that for you" was typed out, the tools ran, and the real
  // answer overwrote it. It was never the answer.
  const openai = fakeOpenAI([
    content('Let me check that for you.'),
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{}' } }] } }] },
    done('tool_calls'),
  ]);
  const out = await streamCompletion(openai, { model: 'x', messages: [] });

  assert.equal(out.choices[0].message.content, 'Let me check that for you.');
  assert.equal(out.choices[0].message.tool_calls.length, 1);
});

test('an empty stream still returns the shape the loop expects', async () => {
  const openai = fakeOpenAI([done('length')]);
  const out = await streamCompletion(openai, { model: 'x', messages: [] });

  assert.equal(out.choices[0].message.content, '');
  assert.equal(out.choices[0].message.role, 'assistant');
  assert.equal(out.choices[0].finish_reason, 'length');
});

test('a chunk with no choices is skipped rather than throwing', async () => {
  const openai = fakeOpenAI([{}, { choices: [] }, content('ok'), done()]);
  const out = await streamCompletion(openai, { model: 'x', messages: [] });
  assert.equal(out.choices[0].message.content, 'ok');
});
