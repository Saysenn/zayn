// ***************************************************
// * WHICH WORKSPACE ANSWERS DIANE, BY CONTEXT
// ***************************************************
//
// The master sheet's own context is runAgent and is not listed here. Every
// other workspace answers its own context on the same event stream, so the
// chat needs nothing new, and the master sheet's route never names another
// workspace (expenses/expenseIsolation.test.js).

const HANDLERS = {
  // Opened 2026-10-07: the expense brain WhatBot's admins use, for every group.
  // eslint-disable-next-line global-require
  expenses: (...args) => require('../expenseBot').dianeTurn(...args),
  // Opened 2026-10-10: HMRC & CIS, answered from GOV.UK and our own notes.
  // eslint-disable-next-line global-require
  hmrc: (...args) => require('./hmrc').hmrcTurn(...args),
};

/** A handler for this context, or null for the master sheet's own. */
function handlerFor(context) {
  return HANDLERS[context] ?? null;
}

module.exports = { handlerFor };
