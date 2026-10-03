const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const repo = require('./repos/monthlyReview.repo');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');
const { currentMonth } = require('./shared/presetMonth.helper');
const { dueThisMonth, pendingThisMonth } = require('./shared/reviewQueue.helper');
const { broadcast } = require('./sockets/index');

// ***************************************************
// * The monthly review: is this deal still running?
// ***************************************************
//
// ONE ROUTER, ONE WRITE PATH. The panel and Diane both come through here.
// A second way to write an answer is a second place for the rule to live,
// and this one sets `stopped_on`. See docs/closure.md section 5.

const router = Router();

/**
 * ===============================
 * * THE CURRENT MONTH, ALWAYS. NO PICKER.
 * ===============================
 * `currentMonth()` from the business timezone, never the browser's and
 * never a query param. The review writes a DATE, not a month, so the export
 * and this never have to agree on which month it is: it reads `stopped_on`
 * against whatever month it is building.
 *
 * Tying this to a chosen month would create a second definition of "now"
 * beside the one presetMonth.helper already owns.
 */
function period() {
  return currentMonth();
}

router.get('/monthly-review', async (req, res, next) => {
  try {
    const p = period();
    // RATED, never raw. The panel prints money, so it reads the queue
    // through shared/reviewQueue.helper like every other reader.
    const rows = await dueThisMonth(p, {
      group: req.query.group || undefined,
      personId: req.query.personId || undefined,
      company: req.query.company || undefined,
    });
    res.json({ period: p, rows, pending: await pendingThisMonth(p) });
  } catch (err) {
    next(err);
  }
});

// Just the count and the money, for the Master Sheet header's button and
// for ExportWarnings. Its own route so a badge is not a page load.
router.get('/monthly-review/pending', async (req, res, next) => {
  try {
    const p = period();
    res.json({ period: p, ...await pendingThisMonth(p) });
  } catch (err) {
    next(err);
  }
});

/**
 * ===============================
 * * ONE WRITE DOOR, AND IT TAKES A LIST
 * ===============================
 * Not a single-deal route beside a bulk one. The panel answers a selection,
 * and a selection of one is one answer: a second route would be a second
 * place for the queue guard and the stop date to live, over a difference of
 * list length.
 *
 * PER ROW, NOT ONE STATEMENT, the same shape bulk-update already takes: each
 * answer is its own transaction with its own stop, and a deal that has
 * dropped out of the queue since the panel was drawn is SKIPPED rather than
 * failing the batch.
 *
 * REFUSES A DEAL THAT IS NOT IN THE QUEUE rather than creating a review for
 * it. Otherwise "mark them all no" reaches deals nobody was being asked
 * about, which is the whole of somebody's income decided by a typo. The
 * count that comes back is what ACTUALLY moved, so the toast cannot claim
 * more than happened.
 */
// ONE BATCH PER REQUEST, so a bulk answer is one entry in History.
async function answerAll(req, answer) {
  const p = period();
  const ids = [...new Set((req.body?.dealIds ?? []).map(Number).filter(Number.isInteger))];
  const batchId = randomUUID();
  // One guard query, then every deal at once: each is its own transaction on
  // its own row, so nothing waits on the deal before it.
  const answered = await repo.dueIds(ids, p);
  const results = await Promise.all(
    answered.map((id) => repo.setAnswer(id, p, answer, { batchId })),
  );
  const stopped = answered
    .map((id, i) => ({ id, stoppedOn: results[i].stoppedOn }))
    .filter((s) => s.stoppedOn);
  broadcast(null, 'master-sheet:changed', { action: 'reviewed', ids: answered });
  return { answered, stopped, period: p };
}

router.post('/monthly-review/answer', async (req, res, next) => {
  try {
    const { answer } = req.body || {};
    if (!repo.ANSWERS.includes(answer)) {
      return next(new AppError(400, messages.notAnAnswer(answer)));
    }
    res.json(await answerAll(req, answer));
  } catch (err) {
    next(err);
  }
});

// NO CLEAR ROUTE. The way back from a misclick is History's undo, which goes
// through repo.revertAnswer and needs no queue guard: a deal answered "already
// ended" has left the queue by design, so a door that only the queue can open
// could not have reached it anyway.

module.exports = { router };
