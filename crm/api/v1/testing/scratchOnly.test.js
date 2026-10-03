const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../repos/masterSheetRows.repo');
const { masterSheetTools } = require('../agent/tools/masterSheet');
const scratchOnly = require('./scratchOnly');

/**
 * ***************************************************
 * * THE GUARD THAT WOULD HAVE CAUGHT IT
 * ***************************************************
 *
 * A test of the bulk update set three REAL INDIGO rows to a 2023 preset
 * with 0 payable, £2,700 out of September, found hours later by a spread
 * query. The filter was wider than anybody meant, so this checks the ROW at
 * the moment it is written rather than the filter that found it.
 *
 * No database here: the repo is stubbed, so what is proved is that the
 * guard sits between the tool and the write.
 */

const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');

const REAL = { id: 29, person_name: 'Byron', company: 'Acqua resourcing', group_name: 'INDIGO' };
const FAKE = { id: 900, person_name: 'Alpha Tester', company: 'Fake Co', group_name: 'ZZTEST' };

const withRows = (rows, run) => {
  const saved = { findAll: repo.findAll, findById: repo.findById, update: repo.update, create: repo.create, remove: repo.remove, removeMany: repo.removeMany };
  const written = [];
  repo.findAll = async () => ({ rows, total: rows.length });
  repo.findById = async (id) => rows.find((r) => r.id === Number(id)) ?? null;
  repo.update = async (id) => { written.push(id); return { id }; };
  repo.create = async (f) => ({ id: 1, ...f });
  repo.remove = async (id) => { written.push(id); return { id }; };
  repo.removeMany = async (ids) => { written.push(...ids); return ids; };

  scratchOnly.arm();
  return run(written).finally(() => { scratchOnly.disarm(); Object.assign(repo, saved); });
};

test('A REAL ROW IS REFUSED, however it was reached', async () => {
  await withRows([REAL], async (written) => {
    await assert.rejects(
      () => repo.update(REAL.id, { preset_on: '2023-09-01' }),
      /SCRATCH ONLY/,
      'a real row was writable with the guard armed',
    );
    assert.deepEqual(written, [], 'it wrote anyway');
  });
});

test('THE SCRATCH GROUP STILL WRITES, or the guard is useless', async () => {
  await withRows([FAKE], async (written) => {
    await repo.update(FAKE.id, { preset_on: '2026-09-01' });
    assert.deepEqual(written, [FAKE.id]);
  });
});

test('A BULK EDIT THAT MATCHES REAL ROWS CANNOT WRITE ONE', async () => {
  // The actual incident: the filter was wider than anybody meant, and the
  // tool wrote every row it found. The tool catches a failed write per row,
  // so the guard shows up as a NAMED failure rather than a rejection, which
  // is the behaviour that matters: the real row does not move.
  await withRows([FAKE, REAL], async (written) => {
    // NOT a far off preset: that now trips the guessed-year guard before
    // any write is attempted, and this test is about the SCRATCH guard.
    const out = await bulk.handler({ set: { payableDays: 31 }, confirmed: true });

    assert.equal(written.includes(REAL.id), false, 'the real row was written');
    assert.match(out.summary, /DID NOT TAKE/);
    assert.match(out.summary, new RegExp(String(REAL.id)));
  });
});

test('DELETING A REAL ROW IS REFUSED TOO', async () => {
  await withRows([REAL], async (written) => {
    await assert.rejects(() => repo.remove(REAL.id), /SCRATCH ONLY/);
    await assert.rejects(() => repo.removeMany([REAL.id]), /SCRATCH ONLY/);
    assert.deepEqual(written, []);
  });
});

test('CREATING OUTSIDE THE SCRATCH GROUP IS REFUSED', async () => {
  await withRows([], async () => {
    await assert.rejects(() => repo.create({ personName: 'Someone', groupName: 'INDIGO' }), /SCRATCH ONLY/);
    const made = await repo.create({ personName: 'Alpha Tester', groupName: 'ZZTEST' });
    assert.equal(made.groupName, 'ZZTEST');
  });
});

test('A ROW IT CANNOT READ IS REFUSED, never assumed safe', async () => {
  await withRows([], async () => {
    await assert.rejects(() => repo.update(4242, {}), /SCRATCH ONLY/);
  });
});

test('arming twice does not double wrap', async () => {
  await withRows([FAKE], async (written) => {
    scratchOnly.arm();
    await repo.update(FAKE.id, {});
    assert.deepEqual(written, [FAKE.id]);
  });
});

/**
 * ===============================
 * * ENDING A DEAL IS A WRITE, AND THE GUARD HAS TO COVER IT
 * ===============================
 * A stop takes a row's amount out of every month from its date onward,
 * which is the same harm the preset incident did. A company closure stops
 * every deal on it at once, which is the widest write in the CRM.
 */
const reviewRepo = require('../repos/monthlyReview.repo');

// `stopped` is the ARCHIVE half, and it defaults to empty so every call
// written before it stays exactly as it was. The guard reads both halves:
// a resume acts on stopped rows, so a company whose deals are all stopped
// looked like no rows at all.
const withClosureRows = (rows, run, stopped = []) => {
  const saved = {
    findAll: repo.findAll,
    findById: repo.findById,
    stop: repo.stop,
    stopMany: repo.stopMany,
    stopCompany: repo.stopCompany,
    resume: repo.resume,
    resumeCompany: repo.resumeCompany,
    setReviewMonthlyForCompany: repo.setReviewMonthlyForCompany,
  };
  const savedReview = { answerOne: reviewRepo.answerOne };
  const written = [];
  repo.findAll = async (args) => {
    const half = args?.stopped ? stopped : rows;
    return { rows: half, total: half.length };
  };
  repo.setReviewMonthlyForCompany = async (c) => { written.push(`review_monthly:${c}`); return []; };
  repo.findById = async (id) => rows.find((r) => r.id === Number(id)) ?? null;
  repo.stop = async (id) => { written.push(`stop:${id}`); return { id }; };
  repo.stopMany = async (ids) => { written.push(...ids.map((i) => `stop:${i}`)); return ids; };
  repo.stopCompany = async (c) => { written.push(`stopCompany:${c}`); return []; };
  repo.resume = async (id) => { written.push(`resume:${id}`); return { id }; };
  repo.resumeCompany = async (c) => { written.push(`resumeCompany:${c}`); return []; };
  reviewRepo.answerOne = async (id) => { written.push(`review:${id}`); return { stoppedOn: null }; };

  scratchOnly.arm();
  return run(written).finally(() => {
    scratchOnly.disarm();
    Object.assign(repo, saved);
    Object.assign(reviewRepo, savedReview);
  });
};

test('STOPPING A REAL ROW IS REFUSED', () => withClosureRows([REAL, FAKE], async (written) => {
  await assert.rejects(
    () => repo.stop(REAL.id, { on: '2026-08-31', reason: 'stopped_by_hand' }),
    /SCRATCH ONLY/,
  );
  assert.deepEqual(written, [], 'nothing may be written');
}));

test('STOPPING A SCRATCH ROW GOES THROUGH', () => withClosureRows([REAL, FAKE], async (written) => {
  await repo.stop(FAKE.id, { on: '2026-08-31', reason: 'stopped_by_hand' });
  assert.deepEqual(written, [`stop:${FAKE.id}`]);
}));

test('RESUMING A REAL ROW IS REFUSED TOO', () => withClosureRows([REAL, FAKE], async (written) => {
  await assert.rejects(() => repo.resume(REAL.id), /SCRATCH ONLY/);
  assert.deepEqual(written, []);
}));

test('ONE REAL ROW IN A BULK STOP REFUSES THE WHOLE CALL', () => (
  withClosureRows([REAL, FAKE], async (written) => {
    await assert.rejects(
      () => repo.stopMany([FAKE.id, REAL.id], { on: '2026-08-31', reason: 'review_no' }),
      /SCRATCH ONLY/,
    );
    assert.deepEqual(written, [], 'not even the scratch one, since the batch is one act');
  })
));

test('A COMPANY CLOSURE CHECKS EVERY DEAL BEFORE IT TOUCHES ANY', () => (
  withClosureRows([REAL, FAKE], async (written) => {
    // No ids to check up front, so the rows it would reach are read first.
    // A company with one real deal on it refuses the whole cascade.
    await assert.rejects(() => repo.stopCompany('Acqua resourcing', { on: '2026-08-31' }), /SCRATCH ONLY/);
    assert.deepEqual(written, []);
  })
));

test('AND SO DOES REOPENING ONE', () => withClosureRows([REAL, FAKE], async (written) => {
  await assert.rejects(() => repo.resumeCompany('Acqua resourcing'), /SCRATCH ONLY/);
  assert.deepEqual(written, []);
}));

test('A SCRATCH-ONLY COMPANY CASCADES NORMALLY', () => (
  withClosureRows([FAKE], async (written) => {
    await repo.stopCompany('Fake Co', { on: '2026-08-31' });
    assert.deepEqual(written, ['stopCompany:Fake Co']);
  })
));

test('THE REVIEW WRITES tb_mastersheet TOO, and is guarded', () => (
  // It runs its own transaction outside the rows repo, so a guard that only
  // wrapped that repo would wave "mark them all no" straight through.
  withClosureRows([REAL, FAKE], async (written) => {
    await assert.rejects(() => reviewRepo.answerOne(REAL.id, '2026-08', 'no'), /SCRATCH ONLY/);
    assert.deepEqual(written, []);
    await reviewRepo.answerOne(FAKE.id, '2026-08', 'no');
    assert.deepEqual(written, [`review:${FAKE.id}`]);
  })
));

test('EVERY WRITE ON THE ROWS REPO IS WRAPPED, with none forgotten', () => {
  // A new write added to the repo and not to this list is a hole that only
  // shows up as a real row changing. The list is the point of the test.
  // THE REAL LIST, read from the module. Restating it here would be a
  // second copy to forget, which is the fault this is looking for.
  const guarded = scratchOnly.WRITES;
  // `set` and `clear` are here because they were NOT, and that is how
  // `setReviewMonthlyForCompany` stayed invisible to this test while
  // writing tb_mastersheet across a whole company by name. A list of verbs
  // is still a guess at a name; it is only ever widened, never trimmed.
  const writes = Object.keys(repo).filter((k) => (
    /^(create|update|remove|stop|resume|bulk|delete|set|clear)/i.test(k) && typeof repo[k] === 'function'
  ));
  for (const name of writes) {
    assert.ok(guarded.includes(name), `${name} is a write and scratchOnly does not guard it`);
  }
});

test('updateMany WAS THE HOLE. One real row refuses the whole batch', () => {
  // Found 2026-09-16 by the list test above. It is one statement across
  // many rows, Diane reaches it directly, and it was never in WRITES: the
  // guard written after a bulk update hit three real rows did not cover
  // the other bulk update.
  const saved = { findById: repo.findById, updateMany: repo.updateMany };
  const written = [];
  repo.findById = async (id) => [REAL, FAKE].find((r) => r.id === Number(id)) ?? null;
  repo.updateMany = async (changes) => { written.push(...changes.map((c) => c.id)); return changes; };

  scratchOnly.arm();
  return (async () => {
    await assert.rejects(
      () => repo.updateMany([{ id: FAKE.id, fields: { presetOn: '2023-09-01' } },
        { id: REAL.id, fields: { presetOn: '2023-09-01' } }]),
      /SCRATCH ONLY/,
    );
    assert.deepEqual(written, [], 'it commits as one transaction, so a partial pass is worse');
    await repo.updateMany([{ id: FAKE.id, fields: { presetOn: '2023-09-01' } }]);
    assert.deepEqual(written, [FAKE.id]);
  })().finally(() => { scratchOnly.disarm(); Object.assign(repo, saved); });
});

/**
 * ===============================
 * * THE SECOND AND THIRD HOLES, FOUND 2026-09-21
 * ===============================
 * `setReviewMonthlyForCompany` writes tb_mastersheet across a whole
 * company BY NAME, which is the "filter matched more than anybody meant"
 * shape this file exists for, and it was never in WRITES: the completeness
 * test above matched write names by PREFIX, and this one begins with `set`.
 * Widening that regex found `clearOrphanFlags` in the same minute.
 */
test('TICKING THE MONTHLY REVIEW ON A REAL COMPANY IS REFUSED', () => (
  withClosureRows([REAL, FAKE], async (written) => {
    await assert.rejects(
      () => repo.setReviewMonthlyForCompany('Acqua resourcing', [REAL.id]),
      /SCRATCH ONLY/,
    );
    assert.deepEqual(written, []);
  })
));

test('AND ON A SCRATCH COMPANY IT GOES THROUGH', () => (
  withClosureRows([FAKE], async (written) => {
    await repo.setReviewMonthlyForCompany('Fake Co', [FAKE.id]);
    assert.deepEqual(written, ['review_monthly:Fake Co']);
  })
));

/**
 * ===============================
 * * AND THE ARCHIVE COUNTS AS ROWS
 * ===============================
 * The company check read the LIVE rows only, and `resumeCompany` acts on
 * STOPPED ones: a real company whose deals were all stopped came back as
 * an empty list, which is no row outside the scratch group, which is a
 * pass. The guard waved through the one call whose whole target it could
 * not see.
 */
test('A COMPANY WHOSE REAL DEALS ARE ALL STOPPED IS STILL REFUSED', () => (
  withClosureRows(
    [],
    async (written) => {
      await assert.rejects(() => repo.resumeCompany('Acqua resourcing'), /SCRATCH ONLY/);
      assert.deepEqual(written, [], 'the archive is where a resume looks');
    },
    [REAL],
  )
));

/**
 * ===============================
 * * A COMPANY'S OWN DETAILS, FOUND 2026-09-28
 * ===============================
 * Tier, notes, status and name were never guarded: a company test stayed on a
 * ZZ company only because the prompt named one. Same rule as a cascade.
 */
const companiesRepo = require('../repos/companies.repo');

const withCompanyRows = (rows, run) => {
  const saved = { findAll: repo.findAll, findById: repo.findById };
  const savedCompanies = Object.fromEntries(scratchOnly.COMPANY_WRITES.map((k) => [k, companiesRepo[k]]));
  const written = [];
  repo.findAll = async (args) => {
    const mine = args?.stopped ? [] : rows.filter((r) => !args?.company || r.company.toLowerCase() === String(args.company).toLowerCase());
    return { rows: mine, total: mine.length };
  };
  repo.findById = async (id) => rows.find((r) => r.id === Number(id)) ?? null;
  for (const k of scratchOnly.COMPANY_WRITES) companiesRepo[k] = async (key) => { written.push(`${k}:${key?.row_id ?? key?.[0]?.company ?? key}`); return {}; };
  scratchOnly.arm();
  return run(written).finally(() => {
    scratchOnly.disarm();
    Object.assign(repo, saved);
    Object.assign(companiesRepo, savedCompanies);
  });
};

test('A REAL COMPANY\'S DETAILS ARE REFUSED, every write', () => (
  withCompanyRows([REAL, FAKE], async (written) => {
    await assert.rejects(() => companiesRepo.update('acqua resourcing', { tier: 'T3' }), /SCRATCH ONLY/);
    await assert.rejects(() => companiesRepo.rename('acqua resourcing', 'X'), /SCRATCH ONLY/);
    await assert.rejects(() => companiesRepo.setTiers([{ company: 'Fake Co' }, { company: 'Acqua resourcing' }]), /SCRATCH ONLY/);
    await assert.rejects(() => companiesRepo.revertCompanyField({ row_id: REAL.id }), /SCRATCH ONLY/);
    assert.deepEqual(written, []);
  })
));

test('A COMPANY WITH NO DEALS CANNOT BE SHOWN TO BE FAKE, so it is refused', () => (
  withCompanyRows([FAKE], async (written) => {
    await assert.rejects(() => companiesRepo.update('nobody co', { tier: 'T3' }), /holding no readable deals/);
    assert.deepEqual(written, []);
  })
));

test('A SCRATCH COMPANY STILL WRITES', () => (
  withCompanyRows([FAKE], async (written) => {
    await companiesRepo.update('fake co', { tier: 'T3' });
    await companiesRepo.revertCompanyField({ row_id: FAKE.id });
    assert.deepEqual(written, ['update:fake co', `revertCompanyField:${FAKE.id}`]);
  })
));

test('EVERY WRITE ON THE COMPANIES REPO IS WRAPPED, with none forgotten', () => {
  const writes = Object.keys(companiesRepo).filter((k) => (
    /^(create|update|remove|rename|revert|set|clear|delete)/i.test(k) && typeof companiesRepo[k] === 'function'
  ));
  for (const name of writes) {
    assert.ok(scratchOnly.COMPANY_WRITES.includes(name), `${name} is a write and scratchOnly does not guard it`);
  }
});
