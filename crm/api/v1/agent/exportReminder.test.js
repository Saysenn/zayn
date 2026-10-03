const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withExportReminder, turnsSinceReminder, REMINDER_GAP, wantsPanelAct, asksWrongExportStep,
  explicitExportRequest, exportContinuation, exportToolAllowed, coalesceBreakdownCalls,
} = require('./runAgent');

/**
 * ***************************************************
 * * A nudge, not a nag
 * ***************************************************
 *
 * The reminder was appended to EVERY unrelated turn for as long as a card
 * was open, word for word. Two replies in a row carried it identically in
 * a live run.
 *
 * That is the fault removed twice already, from "Awww" and from the pet
 * names: a true thing said every single time stops being information and
 * becomes a tic. It is also the least necessary place for one, because the
 * card is on screen and the floating pill already shows the count.
 */

const CARD = {
  role: 'assistant',
  content: '[export card]',
  exportSession: {
    draft: {
      template: 'bank', groups: ['NEXUS'], month: '2026-09',
      answered: ['sheet', 'groups'], hiddenColumns: [],
    },
  },
};

const said = (content) => ({ role: 'assistant', content });
const asked = (content) => ({ role: 'user', content });

test('THE FIRST interruption gets the reminder', () => {
  const out = withExportReminder('Gloria is owed 2,000.', [CARD, asked('what is gloria owed')], false);
  assert.match(out, /Gloria is owed 2,000\./, 'the answer must survive intact');
  assert.match(out, /NEXUS/);
  assert.match(out, /carry on|forget it/i, 'a reminder with no way out is a dead end');
});

test('AND THEN IT GOES QUIET for a few turns', () => {
  const history = [CARD, said('Reminded you. Your export is parked, by the way: the NEXUS sheet.')];

  // The next couple of unrelated turns say nothing about it.
  for (let n = 0; n < REMINDER_GAP; n += 1) {
    const out = withExportReminder('Nathan is owed 3,000.', [...history, asked('x')], false);
    assert.equal(out, 'Nathan is owed 3,000.', `it nagged again after ${n} turns`);
    history.push(said('Nathan is owed 3,000.'));
  }
});

test('it comes back once the gap has passed', () => {
  const history = [CARD, said('Your export is parked, by the way: the NEXUS sheet.')];
  for (let n = 0; n < REMINDER_GAP; n += 1) history.push(said('An unrelated answer.'));

  const out = withExportReminder('And another.', [...history, asked('x')], false);
  assert.notEqual(out, 'And another.', 'a parked sheet must not be forgotten entirely');
});

test('EVERY VARIANT CARRIES THE WAY OUT, and none repeats another', () => {
  // The wording rotates on how far in they are, so this walks every step
  // count. One variant shipped with no "carry on or forget it" at all: a
  // reminder that cannot be acted on is a dead end wearing a nudge's
  // clothes, and only the rotation decided which one you got.
  const seen = new Set();

  for (let done = 0; done < 6; done += 1) {
    const answered = ['sheet', 'groups', 'breakdown', 'colour', 'delivery', 'columns'].slice(0, done);
    const card = { ...CARD, exportSession: { draft: { ...CARD.exportSession.draft, answered } } };
    const out = withExportReminder('An answer.', [card, asked('x')], false);

    // Every step but the last has something outstanding to remind about.
    if (out === 'An answer.') continue;
    const line = out.replace('An answer.\n\n', '');

    assert.match(line, /carry on|forget it/i, `no way out at ${done} settled: ${line}`);
    assert.ok(turnsSinceReminder([said(line)]) === 0, `unrecognisable at ${done}: ${line}`);
    seen.add(line);
  }

  assert.ok(seen.size >= 3, `only ${seen.size} distinct wordings, so it still repeats`);
});

test('EVERY WORDING IS RECOGNISABLE, or the gap never applies', () => {
  // The variants exist so it is not the same line twice. If one of them
  // cannot be detected in history, it counts as "never mentioned" and the
  // nagging comes straight back.
  for (const line of [
    'Your export is parked, by the way: the NEXUS sheet, 2 of 5 settled.',
    'The NEXUS sheet is still waiting on you, 2 of 5 done, just the breakdown left.',
    'Still holding the NEXUS sheet for you: 2 of 5, and the breakdown to go.',
    'Still holding your sheet for you: 1 of 6, and the sheet to go.',
  ]) {
    assert.equal(turnsSinceReminder([said(line)]), 0, line.slice(0, 40));
  }
});

test('CARDS AND LISTS ARE NOT TURNS, so they cannot burn the gap', () => {
  // Live run: she reminded, then showed four Gloria cards, then reminded
  // again on the very next reply. Four renderings looked like four
  // replies, so the gap was spent without a word being said.
  const rendering = (c) => ({ role: 'assistant', content: c, card: {} });
  const history = [
    CARD,
    said('Yes, eight people. Your export is parked, by the way: the NEXUS sheet.'),
    rendering("[showed Gloria's deal, row #3]"),
    rendering("[showed Gloria's deal, row #39]"),
    rendering("[showed Gloria's deal, row #74]"),
    rendering("[showed Gloria's deal, row #80]"),
  ];

  assert.equal(turnsSinceReminder(history), 0, 'renderings counted as turns');
  assert.equal(
    withExportReminder('Gloria has four deals.', [...history, asked('x')], false),
    'Gloria has four deals.',
    'it nagged again straight after showing cards',
  );
});

test('a turn that TOUCHED the export never gets one', () => {
  // Saying it right after they answered an export question is repeating
  // them back to themselves.
  const out = withExportReminder('Breakdown set.', [CARD, asked('no breakdown')], true);
  assert.equal(out, 'Breakdown set.');
});

test('"ALL OF THEM" MUST UPDATE THE GROUP STEP before Diane asks the next question', () => {
  const waitingForGroups = {
    ...CARD,
    exportSession: {
      ...CARD.exportSession,
      draft: { ...CARD.exportSession.draft, groups: [], answered: ['sheet'] },
    },
  };
  const history = [waitingForGroups, asked('all of them')];

  assert.equal(
    wantsPanelAct(history, 'What colour palette would you like?'),
    true,
    'Diane could skip the export tool and jump from Groups to Colour',
  );
});

test('DIANE CANNOT ASK FOR COLOUR WHILE BREAKDOWN IS THE CURRENT STEP', () => {
  const session = {
    draft: {
      template: 'monthly-sheet', groups: [], answered: ['sheet', 'groups'],
    },
  };

  assert.equal(asksWrongExportStep('What colour palette would you like?', session), true);
  assert.equal(asksWrongExportStep('Which breakdown would you like?', session), false);
});

test('no card, no reminder', () => {
  assert.equal(withExportReminder('All done.', [asked('hi')], false), 'All done.');
});

test('a reporting breakdown cannot open an export card', () => {
  assert.equal(explicitExportRequest('give me the MANBAT August breakdown'), false);
  assert.equal(exportToolAllowed([asked('give me the MANBAT August breakdown')]), false);
  assert.equal(exportToolAllowed([asked('the breakdown?')]), false);
});

test('an explicit file request may open the export card', () => {
  assert.equal(explicitExportRequest('lets export'), true);
  assert.equal(explicitExportRequest('build a month sheet for me'), true);
  assert.equal(exportToolAllowed([asked('download the cash sheet')]), true);
});

test('short answers may continue a visible export without repeating export', () => {
  const colourCard = {
    ...CARD,
    exportSession: {
      draft: {
        ...CARD.exportSession.draft,
        answered: ['sheet', 'groups', 'breakdown'],
      },
    },
  };
  assert.equal(exportContinuation([colourCard, asked('green')]), true);
  assert.equal(exportToolAllowed([colourCard, asked('green')]), true);
});

test('several model breakdown calls are consolidated into one plural call', () => {
  const calls = ['MANBAT', 'MILKMAN', 'NEXUS'].map((group, index) => ({
    id: `call-${index}`,
    type: 'function',
    function: {
      name: 'breakdown_master_sheet',
      arguments: JSON.stringify({ month: '2023-08', group }),
    },
  }));
  const out = coalesceBreakdownCalls(calls);
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0].function.arguments), {
    months: ['2023-08'], groups: ['MANBAT', 'MILKMAN', 'NEXUS'], paymentMethods: [],
  });
  assert.deepEqual(out[0].combinedToolCallIds, ['call-1', 'call-2']);
});

// ***************************************************
// * THE WRONG FILE, HANDED OVER AS THE RIGHT ONE
// ***************************************************
//
// Live transcript 2026-09-06, export.txt. A BANK panel was open and waiting
// for a group. The admin said "Give me the bank sheet for Nexus, please."
// REPORTING_BREAKDOWN carries the bare word `bank`, so the continuation was
// refused, the panel never rescoped, and two turns later she built and
// handed over every group's 21 bank rows describing them as NEXUS's 2.
const groupStep = (draft = {}) => ({
  role: 'assistant',
  content: '[export card]',
  exportSession: {
    draft: {
      template: 'bank', groups: [], month: '2026-09', answered: ['sheet'], hiddenColumns: [], ...draft,
    },
  },
});

test('the sheet they already chose does not read as a reporting question', () => {
  assert.equal(exportToolAllowed([groupStep(), asked('Give me the bank sheet for Nexus, please.')]), true);
  assert.equal(exportToolAllowed([groupStep(), asked('milkman and indigo')]), true);
  assert.equal(exportToolAllowed([groupStep(), asked('all of them')]), true);
});

test('and a real reporting question still cannot open a card from that step', () => {
  // `how much` survives the removal of `bank`, so this stays refused.
  assert.equal(exportToolAllowed([groupStep(), asked('how much bank do we have')]), false);
  assert.equal(exportToolAllowed([groupStep(), asked('the cash breakdown for MANBAT')]), false);
  // A cash panel must not wave `bank` through: only the chosen type goes.
  assert.equal(
    exportToolAllowed([groupStep({ template: 'cash' }), asked('how much bank do we have')]),
    false,
  );
});

// ***************************************************
// * INTENT THAT EVAPORATED BEFORE SHE USED IT
// ***************************************************
//
// Live transcript 2026-09-06, full-sweep.txt. "lets do an export" is
// explicit intent and granted permission for exactly one turn. She spent it
// asking "which sheet would you like?" in prose without calling the tool,
// so no panel opened. "bank sheet" then had no export word and no panel to
// continue, and was refused. So was every turn after it: six in a row,
// while she narrated a panel that did not exist.
test('intent survives the turn she wasted on prose', () => {
  const history = [
    asked('lets do an export'),
    said('Which sheet would you like to export?'),
    asked('bank sheet'),
  ];
  assert.equal(exportToolAllowed(history), true);
});

test('but pending intent is not a licence to answer a report with a file', () => {
  const after = (question) => [asked('lets do an export'), said('Which sheet?'), asked(question)];

  assert.equal(exportToolAllowed(after('how much bank do we have')), false);
  assert.equal(exportToolAllowed(after('the cash breakdown please')), false);
  // Nothing that does not name a sheet at all.
  assert.equal(exportToolAllowed(after('what is gloria owed')), false);
});

test('and with no recent intent at all, a bare sheet name opens nothing', () => {
  assert.equal(exportToolAllowed([asked('bank sheet')]), false);
  assert.equal(exportToolAllowed([asked('tell me about milkman'), asked('bank sheet')]), false);
});

// ***************************************************
// * CLAIMING THE FILE IS ON ITS WAY
// ***************************************************
//
// Live transcript 2026-09-06. "go export it" got "Building and exporting
// the Nexus bank sheet now, sweetie!" with no tool call, and her own export
// reminder contradicted her two lines later: "3 of 5 settled and I still
// need the breakdown". Everything CLAIMED_PANEL covered was a claim that a
// SETTING moved; a claim that the FILE is coming costs more, because the
// admin stops and waits for a download that never arrives.
test('saying the file is building, without building it, is caught', () => {
  const card = [CARD, asked('go export it')];

  assert.equal(wantsPanelAct(card, 'Building and exporting the Nexus bank sheet now, sweetie!'), true);
  assert.equal(wantsPanelAct(card, 'Your file is downloading.'), true);
  assert.equal(wantsPanelAct(card, 'The export is on its way!'), true);
});

test('explaining or offering a build is not claiming one', () => {
  const card = [CARD, asked('what happens next')];

  assert.equal(wantsPanelAct(card, 'Building the sheet needs a breakdown choice first.'), false);
  assert.equal(wantsPanelAct(card, 'Shall I build it for you?'), false);
  assert.equal(wantsPanelAct(card, 'Would you like me to export that?'), false);
});
