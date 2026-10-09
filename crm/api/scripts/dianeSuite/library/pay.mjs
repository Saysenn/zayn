// TODAY'S PAY FEATURES (2026-10-08): the person's switches and what they
// said on payday. Who is in which state is set in data.mjs.
import { all, none, everyDeal, wordings } from './helpers.mjs';
import { dealOf, dealsOf } from './data.mjs';

export const READS = [
  ...wordings('PAY-001', 'all paid people: Otto Fenn and Juno Park', [
    'show all paid people',
    'who has been paid',
    'list everyone marked paid',
  ], { tools: ['list_people'], reply: all('Otto Fenn', 'Juno Park'), noReply: none('Theo Brandt') }),
  ...wordings('PAY-002', 'all unpaid people include Theo Brandt, never Otto Fenn', [
    'show all unpaid people',
    "who hasn't been paid yet",
    'who is not marked paid',
  ], { tools: ['list_people'], reply: all('Theo Brandt'), noReply: none('Otto Fenn') }),
  ...wordings('PAY-003', 'portion: Baker Jones and Kiran Vale', [
    'who said portion',
    'who only got part of their pay',
  ], { reply: all('Baker Jones', 'Kiran Vale'), noReply: none('Otto Fenn') }),
  ...wordings('PAY-004', "hasn't confirmed: Theo, Juno and Felix, never the Paid switch", [
    "who hasn't confirmed payment",
    "who hasn't said they received their pay",
  ], { reply: all('Theo Brandt', 'Juno Park', 'Felix Orr'), noReply: none('Otto Fenn') }),
  ...wordings('PAY-005', 'awaiting: Felix Orr', [
    'who are we still waiting to hear from about payday',
    'who has not answered the payday check',
  ], { reply: all('Felix Orr'), noReply: none('Otto Fenn', 'Theo Brandt') }),
  ...wordings('PAY-006', 'Mara Quill should not be paid', [
    'should mara quill be paid?',
  ], { reply: /\bnot\b|\bno\b|shouldn/i }),
  ...wordings('PAY-007', 'Kiran Vale is paid on some deals, not all', [
    'is kiran vale paid?',
    'has kiran been paid',
  ], { reply: /some|mixed|one of|not all|partly|Brightwell/i }),
];

export const WRITES = [
  {
    id: 'PAY-010',
    name: '"mark kiran vale paid" is every live deal of hers, after a yes',
    risky: true,
    turns: [
      { say: 'mark kiran vale paid', expect: { db: async (db) => ((await dealOf(db, 'Kiran Vale', 'Ironleaf')).override_paid === true ? 'wrote before the yes' : null) } },
      { say: 'yes', expect: { db: everyDeal(dealsOf, 'Kiran Vale', (r) => r.override_paid === true, 'not every deal paid') } },
    ],
  },
  {
    id: 'PAY-011',
    name: 'payment received is set by name, after a yes',
    turns: [
      { say: 'set payment received for theo brandt to paid', expect: { db: async (db) => ((await dealOf(db, 'Theo Brandt', 'Brightwell')).payment_outcome === 'confirmed' ? 'wrote before the yes' : null) } },
      { say: 'yes', expect: { db: async (db) => { const r = await dealOf(db, 'Theo Brandt', 'Brightwell'); return r.payment_outcome === 'confirmed' ? null : `payment_outcome ${r.payment_outcome}`; } } },
    ],
  },
  {
    id: 'PAY-012',
    name: 'setting payment received on a portion clears its payday flag',
    turns: [
      { say: "set baker jones's payment received to unpaid" },
      { say: 'yes', expect: { db: async (db) => { const r = await dealOf(db, 'Baker Jones', 'Pinecrest'); return r.payment_outcome === 'not_received' && !/payday/i.test(r.review_reason ?? '') ? null : `${r.payment_outcome} / ${r.review_reason}`; } } },
    ],
  },
  {
    id: 'PAY-013',
    name: '"mark him paid" never writes payment received',
    turns: [
      { say: 'mark felix orr paid' },
      { say: 'yes', expect: { db: async (db) => { const r = await dealOf(db, 'Felix Orr', 'Ironleaf'); return r.override_paid === true && r.payment_outcome === 'sent' ? null : `paid ${r.override_paid}, said ${r.payment_outcome}`; } } },
    ],
  },
];
