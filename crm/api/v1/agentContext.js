const { Router } = require('express');
const env = require('../configs/env');
const { getClient } = require('./agent/chatClient');

// ***************************************************
// * WHICH CONTEXT DID THEY MEAN? (docs/feature.md 11)
// ***************************************************
//
// The command center reads "expenses", "go to debts" and the like in code,
// for nothing. Only a short phrase that starts like a switch and names
// nothing it knows ("take me to the money stuff") comes here, as TEXT, for
// one small model call that picks from the contexts it was given or none.

const router = Router();
const LIGHT = (process.env.AI_MODEL_LIGHT ?? 'gpt-4.1-mini').trim() === 'off' ? env.openaiModel : (process.env.AI_MODEL_LIGHT ?? 'gpt-4.1-mini').trim();

router.post('/agent-context/guess', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '').slice(0, 200);
    const contexts = (Array.isArray(req.body?.contexts) ? req.body.contexts : [])
      .filter((c) => c && typeof c.key === 'string' && typeof c.label === 'string').slice(0, 10);
    const openai = getClient();
    if (!text || !contexts.length || !openai) return res.json({ key: '' });
    const keys = contexts.map((c) => c.key);
    const out = await openai.chat.completions.create({
      model: LIGHT,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `An admin said something to their CRM assistant. Did they ask to SWITCH to one of these work areas? `
            + `${contexts.map((c) => `${c.key} (${c.label})`).join(', ')}. Answer the key, or "" if they did not ask to switch `
            + 'or it fits none. Spending, costs and receipts are expenses; deals, payroll and the sheet are the master sheet; '
            + 'money owed and loans are debts.',
        },
        { role: 'user', content: text },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'context', strict: true,
          schema: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', enum: ['', ...keys] } } },
        },
      },
    });
    const key = JSON.parse(out.choices?.[0]?.message?.content ?? '{"key":""}').key ?? '';
    res.json({ key: keys.includes(key) ? key : '' });
  } catch (err) {
    // A guess that failed is "not a switch": the message is sent as it is.
    req.log?.warn?.({ err: err.message }, 'context guess failed');
    res.json({ key: '' });
  }
});

module.exports = { router };
