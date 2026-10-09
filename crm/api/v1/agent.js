const { Router } = require('express');
const masterSheetRowsRepo = require('./repos/masterSheetRows.repo');
const companiesRepo = require('./repos/companies.repo');
const concernsRepo = require('./repos/concerns.repo');
const messagesRepo = require('./repos/messages.repo');
const settingsRepo = require('./repos/settings.repo');
const { toAgentRow, fromAgentRow } = require('./masterSheet/toAgentRow');
const { broadcast } = require('./sockets/index');
const { captureLog } = require('./shared/captureLog.helper');
// `messages`, the words. Not `messagesRepo` above, which is the chat table.
const { messages } = require('./shared/messages');

/**
 * Everything here is called by whatbot, never a browser — requireApiKey
 * (mounted in app.js) gates the whole router, separately from the admin
 * session cookie auth.helper.js/session.helper.js handle.
 *
 * THE CONTRACT IS NOW MUCH SMALLER. whatbot no longer syncs anything INTO
 * the CRM (user's explicit decision). The whole relationship is:
 *
 *   PULL   the master sheet, every 5 minutes, to answer WhatsApp questions
 *   WRITE  `paid` and `confirmed` onto a deal, and nothing else
 *   WRITE  escalations into tb_concerns, and chat messages
 *
 * The old /sync/assignments upsert and the `assignments`, `companies` and
 * `payment_status` tables behind it are gone (migration 022). The deals
 * are the CRM's own now, entered by uploading the human-made sheet.
 */
const router = Router();

// What each payday outcome says about whether the person actually got
// money. `undefined` means "says nothing about it", which is why 'sent'
// and 'no_response' are absent rather than false — see the Paid toggle
// rule in PATCH /payment-status below.
//
// 'partial' is absent too, his call 2026-10-08: a portion is flagged for an
// admin to mark which deals were paid, so the switch is theirs to set.
const PAID_BY_OUTCOME = {
  confirmed: true,
  not_received: false,
};

// whatbot answers "who handles this company" from its own pulled roster
// now; this stays so it can look a person's deals up directly when it
// needs the authoritative figure rather than its cached copy.
router.get('/handlers/:personId', async (req, res, next) => {
  try {
    const rows = await masterSheetRowsRepo.findByPersonId(req.params.personId);
    res.json({ assignments: rows.map(toAgentRow) });
  } catch (err) {
    next(err);
  }
});

router.get('/companies/:name', async (req, res, next) => {
  try {
    const company = await companiesRepo.findByKey(req.params.name);
    if (!company) return res.status(404).json({ error: messages.notFound.company });
    res.json({ company });
  } catch (err) {
    next(err);
  }
});

/**
 * The ONE thing whatbot is allowed to write onto a deal.
 *
 * Keyed on sync_key — the deal's own identity — rather than going through
 * a separate payment_status table keyed to a separate assignments row.
 * Both of those are gone; the outcome lands on the deal itself.
 *
 * TOGGLEABLE. `whatbot_writes_enabled` in tb_settings turns this off
 * without a deploy, per the user's explicit ask. When it is off the call
 * is accepted and ignored rather than erroring, so whatbot doesn't retry
 * a write the admin deliberately disabled.
 *
 * There is no `period` any more: the CRM holds one month at a time and
 * does not keep history (settled decision), so a period-keyed row had
 * nothing to key against.
 */
router.patch('/payment-status', async (req, res, next) => {
  try {
    const { syncKey, outcome, note } = req.body || {};
    if (!syncKey || !outcome) {
      return res.status(400).json({ error: 'syncKey and outcome are required' });
    }

    const settings = await settingsRepo.get();
    if (settings?.whatbot_writes_enabled === false) {
      return res.json({ accepted: false, reason: 'whatbot writes are disabled in Settings' });
    }

    const row = await masterSheetRowsRepo.findBySyncKey(syncKey);
    if (!row) return res.status(404).json({ error: 'Deal not found' });

    // The payday answer drives the Paid toggle: 'confirmed' turns it on,
    // 'not_received' off. 'partial' leaves it for the admin, who is asked
    // to review it (applyPaydayOutcome flags the deal).
    //
    // 'sent' and 'no_response' deliberately touch nothing. Nobody has told
    // us anything, and defaulting a silent person to unpaid would erase an
    // admin's own record on the strength of no evidence at all.
    const receivedSomething = PAID_BY_OUTCOME[outcome];

    const updated = await masterSheetRowsRepo.applyPaydayOutcome(row.id, {
      outcome,
      note,
      repliedAt: new Date(),
      paid: receivedSomething,
    });

    // Both events, not one: a payday reply changes what People, Companies
    // and the master sheet all show, and firing a single event only ever
    // refreshed whichever page the change originated from.
    broadcast(null, 'master-sheet:changed', { action: 'payday', personId: row.person_id });
    broadcast(null, 'people:changed', { action: 'payday', personId: row.person_id });

    res.json({ accepted: true, deal: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/concerns', async (req, res, next) => {
  try {
    const { personId, groupName, category, message } = req.body || {};
    if (!personId || !groupName || !category || !message) {
      return res.status(400).json({ error: 'personId, groupName, category and message are required' });
    }
    const concern = await concernsRepo.create({ personId, groupName, category, message });
    broadcast(groupName, 'concern:new', concern);
    res.status(201).json({ concern });
  } catch (err) {
    next(err);
  }
});

router.patch('/concerns/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'status must be open, in_progress or resolved' });
    }
    const concern = await concernsRepo.updateStatus(req.params.id, status);
    if (!concern) return res.status(404).json({ error: 'Concern not found' });
    res.json({ concern });
  } catch (err) {
    next(err);
  }
});

// whatbot posts every inbound WhatsApp message here, best-effort, after it's
// already answered it — this is what feeds the chatbox's thread history. See
// crmClient.js on whatbot's side: never blocks or risks the real reply.
router.post('/messages', async (req, res, next) => {
  try {
    const { personId, groupName, body } = req.body || {};
    if (!personId || !groupName || !body) {
      return res.status(400).json({ error: 'personId, groupName and body are required' });
    }
    const message = await messagesRepo.create({
      groupName,
      personId,
      direction: 'inbound',
      body,
    });
    broadcast(groupName, 'message:new', message);
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The CRM's own master sheet — whatbot's half of the loop
// ---------------------------------------------------------------------------
//
// The whole of it, now that /sync/assignments is gone. whatbot reads the
// deals far more often than it writes to them, and the only thing it
// writes is a payday outcome (PATCH /payment-status above).

// The 5-minute pull. Whatbot replaces its own roster with this, so it
// answers off the admin's latest polish rather than the raw uploaded file.
// Returned in whatbot's own assignment shape (masterSheet/toAgentRow.js) —
// nothing for it to reshape on arrival.
router.get('/master-sheet', async (req, res, next) => {
  try {
    const rows = await masterSheetRowsRepo.findAllRows();
    res.json({ rows: rows.map(toAgentRow), count: rows.length });
  } catch (err) {
    next(err);
  }
});

// The month-start push. `origin` is the whole decision here:
//
//   'import'  a new human-made sheet was found in whatbot's folder. Synced
//             rows missing from it are deleted (they're gone from the
//             source of record); admin-added rows are kept regardless.
//   'repull'  nothing was uploaded, so whatbot is pushing back the copy it
//             pulled from here. Upsert only, deletes nothing.
//
// Zero rows is always refused, at any origin — the same rule whatbot's own
// syncSheet.js applies to Redis. An empty parse means a broken read far
// more often than it means an empty payroll, and this endpoint can delete.
router.post('/sync/master-sheet', async (req, res, next) => {
  try {
    const { rows, origin } = req.body || {};
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows must be an array' });
    }
    if (!['import', 'repull'].includes(origin)) {
      return res.status(400).json({ error: "origin must be 'import' or 'repull'" });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'refusing to sync zero rows' });
    }
    for (const r of rows) {
      if (!r.assignmentId || !r.personId || !r.personName || !r.group || !r.roleLabel) {
        return res.status(400).json({
          error: 'every row needs assignmentId, personId, personName, group and roleLabel',
        });
      }
    }

    const result = await masterSheetRowsRepo.syncUpsert(rows.map(fromAgentRow), origin);
    broadcast(null, 'master-sheet:changed', { action: 'synced', origin, ...result });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// whatbot's own warn/error logs, best-effort forwarded — see whatbot's
// system/logger.js. Never gated by anything the caller has to know: the CRM
// alone decides (via captureLog's dev-mode check) whether to actually keep
// it, so whatbot can send unconditionally without knowing dev mode's state.
router.post('/logs', async (req, res, next) => {
  try {
    const { level, message, detail } = req.body || {};
    if (!level || !message) {
      return res.status(400).json({ error: 'level and message are required' });
    }
    await captureLog({ source: 'agent', level, message, detail });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
