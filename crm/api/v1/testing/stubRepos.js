// ***************************************************
// * Stub a repo, so a test needs no database
// ***************************************************
//
// The same require.cache trick was written out in five test files. It is
// fiddly in one specific way, and each copy got it right by hand: the
// PROXY. Without it a module that calls a repo function the test did not
// think to stub throws, and the failure names the stub rather than the
// thing under test.
//
// TESTING ONLY. Nothing in v1/ may require this.

/**
 * Every cached module that requires a stubbed one, however indirectly. A helper
 * the subject requires otherwise keeps the first load's stubs (ratedRows under
 * the review queue, 2026-09-28). Modules that do not depend on them, and so
 * may hold shared state a test reads (writeTap), are left alone.
 */
function dependents(paths) {
  const stale = new Set(paths);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [p, mod] of Object.entries(require.cache)) {
      if (stale.has(p) || mod?.isStub) continue;
      if ((mod?.children ?? []).some((c) => stale.has(c.id) || stale.has(c.filename))) {
        stale.add(p);
        grew = true;
      }
    }
  }
  return [...stale].filter((p) => !paths.includes(p));
}

/** A module whose exports answer anything, with `impl` taking precedence. */
function stub(impl = {}, fallback = async () => []) {
  return {
    id: 'stub',
    filename: 'stub',
    loaded: true,
    exports: new Proxy(impl, { get: (target, key) => (key in target ? target[key] : fallback) }),
  };
}

/**
 * Replace modules in the require cache, then load the subject fresh.
 *
 * @param {string} subject  resolved path of the module under test
 * @param {object} modules  resolved path -> the object its exports become
 * @returns whatever the subject exports
 */
function loadWith(subject, modules = {}) {
  const paths = Object.keys(modules);
  // The SUBJECT is cleared too, or a second load in the same file returns
  // the first one, still holding the previous test's stubs.
  for (const p of [subject, ...dependents(paths), ...paths]) delete require.cache[p];
  for (const p of paths) require.cache[p] = { ...stub(modules[p]), id: p, filename: p, isStub: true };
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(subject);
}

/** Broadcasts, captured. Every route calls it and no test wants a socket. */
function socketStub(sent = []) {
  return {
    id: 'stub',
    filename: 'stub',
    loaded: true,
    exports: { broadcast: (room, event, payload) => sent.push({ room, event, payload }) },
  };
}

module.exports = { stub, loadWith, socketStub };
