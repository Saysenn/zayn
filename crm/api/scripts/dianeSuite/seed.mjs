// FAKE DATA ONLY. Every name is invented. Dates are relative to today, so the
// suite never goes stale: this month's preset, three deals past their end
// date (the review queue), and one stopped deal (the archive).
//
// "Today" is the BUSINESS month the API itself uses, not this machine's:
// near a month boundary a Dubai laptop and an LA business zone disagree,
// and the seed would mark every deal for a month the API is not in.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: new URL('../../.env', import.meta.url).pathname });
const { currentMonth } = require('../../v1/shared/presetMonth.helper');

const [thisYear, thisPart] = currentMonth().split('-').map(Number);
// Month arithmetic in UTC, so no host zone can shift a 1st into the 31st.
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthAt = (offset) => ym(new Date(Date.UTC(thisYear, thisPart - 1 + offset, 1)));
const month = monthAt(0);
const monthsAgo = (n) => monthAt(-n);
const monthsAhead = (n) => monthAt(n);
// The whole month, so a full monthly amount is owed in a 31 day month too.
const daysInMonth = new Date(Date.UTC(thisYear, thisPart, 0)).getUTCDate();

const D = (o) => ({
  assignedOn: `${monthsAgo(10)}-01`,
  paymentStartOn: `${monthsAgo(9)}-01`,
  presetOn: `${month}-01`,
  endOn: `${monthsAhead(9)}-28`,
  payableDays: daysInMonth,
  currency: 'GBP',
  paymentMethod: 'bank',
  ...o,
});

export const DEALS = [
  D({ personName: 'Kiran Vale', groupName: 'BAKER', company: 'Brightwell', roleLabel: 'Director', monthlyAmount: 3000, feePercent: 5, phone: '07700900001' }),
  D({ personName: 'Kiran Vale', groupName: 'CORVID', company: 'Ironleaf', roleLabel: 'Mid 1', monthlyAmount: 2500 }),
  D({ personName: 'Kiran Vale', groupName: 'OTTER', company: 'Harbor Nine', roleLabel: 'Admin', monthlyAmount: 6000, currency: 'AED', paymentMethod: 'cash' }),
  D({ personName: 'Baker Jones', groupName: 'CORVID', company: 'Pinecrest', roleLabel: 'Mid 2', monthlyAmount: 2200 }),
  D({ personName: 'Otto Fenn', groupName: 'BAKER', company: 'Ironleaf', roleLabel: 'Tech', monthlyAmount: 1500 }),
  D({ personName: 'Karin Vole', groupName: 'OTTER', company: 'Pinecrest', roleLabel: 'Sales', monthlyAmount: 1200 }),
  D({ personName: 'Mara Quill', groupName: 'BAKER', company: 'Pinecrest', roleLabel: 'Closer', monthlyAmount: 1100 }),
  D({ personName: 'Theo Brandt', groupName: 'CORVID', company: 'Brightwell', roleLabel: 'Visa', monthlyAmount: 700 }),
  D({ personName: 'Ines Calder', groupName: 'OTTER', company: 'Ironleaf', roleLabel: 'Graphics', monthlyAmount: 4000, currency: 'AED', paymentMethod: 'cash' }),
  D({ personName: 'Juno Park', groupName: 'BAKER', company: 'Harbor Nine', roleLabel: 'KP', monthlyAmount: 600 }),
  D({ personName: 'Felix Orr', groupName: 'CORVID', company: 'Ironleaf', roleLabel: 'Accounts', monthlyAmount: 1300 }),
  // Past their end date: the monthly review queue.
  D({ personName: 'Nell Arden', groupName: 'BAKER', company: 'Quarry Lane', roleLabel: 'Director', monthlyAmount: 2000, endOn: `${monthsAgo(3)}-15` }),
  D({ personName: 'Silas Moor', groupName: 'CORVID', company: 'Quarry Lane', roleLabel: 'Mid 1', monthlyAmount: 900, endOn: `${monthsAgo(1)}-15` }),
  D({ personName: 'Pia Torres', groupName: 'OTTER', company: 'Harbor Nine', roleLabel: 'Support', monthlyAmount: 800, endOn: `${monthsAgo(2)}-15` }),
  // Stopped below: the archive.
  D({ personName: 'Wren Hollis', groupName: 'BAKER', company: 'Brightwell', roleLabel: 'Holding', monthlyAmount: 500 }),
];

export async function seed(api) {
  const made = [];
  for (const d of DEALS) {
    const r = await api('POST', '/master-sheet', d);
    if (r.status !== 201) throw new Error(`seed ${d.personName}: ${r.status} ${JSON.stringify(r.body)}`);
    made.push(r.body.row);
  }
  const wren = made.find((r) => r.person_name === 'Wren Hollis');
  const stopped = await api('POST', `/master-sheet/${wren.id}/stop`);
  if (stopped.status >= 300) throw new Error(`seed stop: ${stopped.status}`);
  return made;
}
