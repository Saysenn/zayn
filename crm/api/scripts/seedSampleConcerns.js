/**
 * Twenty sample flags, so the Flagged page can be looked at.
 *
 * `tb_concerns` is whatbot's table and it is empty until whatbot has run
 * against real conversations, which leaves the page with nothing to show
 * and no way to judge the layout. These rows exist to be looked at and
 * then deleted.
 *
 * REVERSIBLE ON PURPOSE, and WITHOUT A MARKER IN THE TEXT. It first
 * appended "[sample]" to every message so the clear-up could find them
 * again, which put the word on the card: the page is being looked at to
 * judge how a real flag reads, and every card carrying a tag saying it is
 * fake defeats that.
 *
 * The MESSAGES list below is the marker instead. The clear-up deletes rows
 * whose message matches one of them exactly, which is precise enough that
 * a real flag would have to be word for word identical to one of these
 * paragraphs to be caught. It never truncates the table, so a real flag
 * arriving while the samples sit there survives.
 *
 *   npm run seed-concerns              insert them
 *   npm run seed-concerns -- --clear   remove them again
 */
require('dotenv').config();
const pool = require('../configs/db');

// What the first version appended. Still cleared, so rows written before
// the marker was dropped go too and nobody is left picking them out by
// hand. Delete this once no database has them.
const LEGACY_MARK = '[sample]';

const CATEGORIES = [
  'dispute', 'distress', 'legal', 'wrong-recipient', 'wants-human', 'anger', 'data-request',
];

const STATUSES = ['open', 'open', 'open', 'in_progress', 'in_progress', 'resolved'];

// Deliberately uneven: a one line flag beside a very long one is the case
// the card has to survive, and the long ones are what the clamp and the
// icon exist for.
const MESSAGES = [
  'Not been paid.',
  'This is the third month running that the amount is wrong and nobody has come back to me about any of it. I have sent the figures twice, once to the group and once directly, and each time I am told it will be looked into. I would like someone to actually call me rather than send another message, because I do not think the sums are being read.',
  'Who is this?',
  'I want to speak to a person please, not a bot.',
  'Wrong number, I do not work for you.',
  'You have my old bank details. The account was closed in March and I told the group at the time. Anything sent to it has bounced, and I have no idea whether that means the money is sitting somewhere or has gone back to you. Please confirm which before you send anything else.',
  'Please remove my number from this list.',
  'I am going to have to take advice on this if it is not sorted this week.',
  'Can you send me everything you hold about me.',
  'The payment came through short again, £250 less than the figure I agreed. It is the same shortfall as last month so I assume it is a standing error rather than a one off.',
  'I never agreed to this company being added to my name and I want it taken off.',
  'Genuinely struggling this month, is there any way it can go out early.',
  'Stop messaging me.',
  'I have been chasing since the 4th. Nobody has replied. I have sent four messages to this number and two to the other one, and the only answer I have had was an automated one. At this point I would like it escalated to whoever is actually responsible, and I would like that in writing.',
  'Money arrived but it is under a different name so I cannot tell what it is for.',
  'My solicitor has asked me to request a copy of the agreement.',
  'That is not my company. I think you have me confused with someone else with a similar name, which has happened before.',
  'Why has the end date moved.',
  'The amount is right this time, thank you. Ignore my last message.',
  'Nobody told me the arrangement had ended and I have only found out because the payment stopped. If it ended on the 6th then I am owed six days, and I would like that confirmed before the next run.',
];

async function clear() {
  const { rowCount } = await pool.query(
    'DELETE FROM tb_concerns WHERE message = ANY($1) OR message LIKE $2',
    [MESSAGES, `%${LEGACY_MARK}`],
  );
  console.log(`Removed ${rowCount} sample flags.`);
}

// The page shows 20 cards to a page, so the sample deliberately makes MORE
// than that: at exactly 20 the Pagination component renders nothing, and
// "does paging still work" is one of the things this exists to answer.
const CARDS = 26;

// A few people flagged twice, so the "N flagged" badge and the grouped
// count on a card are visible too rather than every card reading 1.
const REPEATS = 6;

// Gap between one sample flag and the next. 32 flags at 30 hours reaches
// back about five and a half weeks, which straddles the first of the month
// whenever the script is run.
const SPREAD_HOURS = 30;

async function seed() {
  // Real handlers, so a card shows a name rather than a raw id and the
  // Chat link on the modal goes somewhere.
  const { rows: people } = await pool.query(
    `SELECT DISTINCT person_id, group_name FROM tb_mastersheet
     WHERE person_id IS NOT NULL AND person_id <> ''
     ORDER BY person_id LIMIT $1`,
    [CARDS],
  );

  if (people.length === 0) {
    console.error('No handlers on the master sheet to attach a flag to. Upload a sheet first.');
    process.exit(1);
  }

  let inserted = 0;
  async function flag(who, i) {
    await pool.query(
      `INSERT INTO tb_concerns (person_id, group_name, category, message, status, created_at)
       VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval)`,
      [
        who.person_id,
        who.group_name,
        CATEGORIES[i % CATEGORIES.length],
        MESSAGES[i % MESSAGES.length],
        STATUSES[i % STATUSES.length],
        // Spread back roughly five weeks, so about half land BEFORE the
        // first of this month. At seven hours apart they all sat inside the
        // current month, which left "This month" returning every row: the
        // filter worked and there was no way to see that it did.
        i * SPREAD_HOURS,
      ],
    );
    inserted += 1;
  }

  for (let i = 0; i < people.length; i += 1) await flag(people[i], i);
  for (let i = 0; i < Math.min(REPEATS, people.length); i += 1) {
    await flag(people[i], i + MESSAGES.length);
  }

  console.log(`Inserted ${inserted} sample flags across ${people.length} people.`);
  console.log(`That is ${people.length} cards, so page 2 exists at 20 to a page.`);
  console.log('Remove them again with: npm run seed-concerns -- --clear');
}

(async () => {
  if (process.argv.includes('--clear')) await clear();
  else await seed();
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
