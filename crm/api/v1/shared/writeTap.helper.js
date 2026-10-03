// ***************************************************
// * Did this call actually write?
// ***************************************************
//
// Every write broadcasts to the pages it changed, and nothing else does
// (CLAUDE.md). So a broadcast inside a watched call IS the write, read as a
// fact rather than guessed from the words the tool answered with.

const { AsyncLocalStorage } = require('node:async_hooks');

const watching = new AsyncLocalStorage();

/** Runs `run` and reports whether anything inside it wrote. */
async function watchWrites(run) {
  const seen = { wrote: false };
  const result = await watching.run(seen, run);
  return { result, wrote: seen.wrote };
}

/** Called by `broadcast`. Outside a watched call it does nothing. */
function noteWrite() {
  const seen = watching.getStore();
  if (seen) seen.wrote = true;
}

module.exports = { watchWrites, noteWrite };
