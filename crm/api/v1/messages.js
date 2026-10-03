const { Router } = require('express');
const env = require('../configs/env');
const messagesRepo = require('./repos/messages.repo');
const threadReadsRepo = require('./repos/threadReads.repo');
const { broadcast } = require('./sockets/index');

const router = Router();

router.get('/messages/threads', async (req, res, next) => {
  try {
    res.json({ threads: await messagesRepo.listThreads() });
  } catch (err) {
    next(err);
  }
});

// Server-persisted, not per-tab — one shared "last read" per thread (there's
// no per-admin identity to track separately, it's one shared login). This is
// what makes the sidebar/tab/person unread counts survive a refresh and stay
// in sync across every admin's browser tab.
router.get('/messages/unread', async (req, res, next) => {
  try {
    res.json({ unread: await threadReadsRepo.unreadCounts() });
  } catch (err) {
    next(err);
  }
});

router.get('/messages/thread', async (req, res, next) => {
  try {
    const { group, personId } = req.query;
    if (!group || !personId) {
      return res.status(400).json({ error: 'group and personId query params are required' });
    }
    res.json({ messages: await messagesRepo.findThread(group, personId) });
  } catch (err) {
    next(err);
  }
});

// Broadcasting this (not just responding to the caller) is the whole point:
// one admin opening Nathan's thread clears his badge in every other admin's
// tab too, since "read" is shared, not per-tab.
router.post('/messages/thread/read', async (req, res, next) => {
  try {
    const { group, personId } = req.body || {};
    if (!group || !personId) {
      return res.status(400).json({ error: 'group and personId are required' });
    }
    await threadReadsRepo.markRead(group, personId);
    broadcast(group, 'thread:read', { group, personId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Admin sends a reply. Saved (and shown, via the response + broadcast)
// immediately; delivery over WhatsApp happens after, through whatbot's own
// webhook — never a direct connection to WhatsApp from the CRM. If the
// webhook fails, the message stays visible but marked failed rather than
// silently vanishing.
router.post('/messages', async (req, res, next) => {
  try {
    const { groupName, personId, body } = req.body || {};
    if (!groupName || !personId || !body) {
      return res.status(400).json({ error: 'groupName, personId and body are required' });
    }

    const message = await messagesRepo.create({ groupName, personId, direction: 'outbound', body });
    broadcast(groupName, 'message:new', message);
    res.status(201).json({ message });

    deliver(message).catch(() => {});
  } catch (err) {
    next(err);
  }
});

async function deliver(message) {
  if (!env.whatbotWebhookUrl || !env.whatbotWebhookKey) {
    const failed = await messagesRepo.updateStatus(message.id, 'failed');
    broadcast(message.group_name, 'message:updated', failed);
    return;
  }

  let ok = false;
  try {
    const res = await fetch(`${env.whatbotWebhookUrl}/webhook/admin-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-key': env.whatbotWebhookKey,
      },
      body: JSON.stringify({
        personId: message.person_id,
        groupName: message.group_name,
        message: message.body,
      }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }

  const updated = await messagesRepo.updateStatus(message.id, ok ? 'sent' : 'failed');
  broadcast(message.group_name, 'message:updated', updated);
}

module.exports = { router };
