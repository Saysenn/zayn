const { Router } = require('express');
const peopleRepo = require('./repos/people.repo');
const rowsRepo = require('./repos/masterSheetRows.repo');
const settingsRepo = require('./repos/settings.repo');
const { parsePagination } = require('./shared/pagination.helper');
const { detailMonthlyTotals } = require('./shared/detailMonthlyTotals.helper');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');
const { broadcast } = require('./sockets/index');
const { MAX_PERCENT } = require('./shared/rates.helper');
const { PAY_STATES, RECEIVED_STATES } = require('./shared/personPayState.helper');

/**
 * The People page — the CRM's operations surface.
 *
 * Every route here reads or writes tb_mastersheet. There is no people
 * table holding deals and no second copy of anything: a person's roles,
 * companies and money are aggregations of their deals, computed on read
 * (people.repo.js). tb_people holds only the handful of facts a deal has
 * no column for.
 *
 * That is what makes the two directions the user asked for automatic —
 * "changes in master sheet reflect to people page and cruds in people
 * page reflect to master sheet" — there is nothing to reflect, because
 * both pages are looking at the same rows.
 *
 * This file replaced a much smaller one that served whatbot's chatbox
 * navigation over the old `assignments` table. That table is gone
 * (migration 022); the two endpoints it exposed now live under
 * /api/v1/people/lookup/* below so the chatbox keeps working.
 */

const router = Router();

// Query params are always strings — 'true'/'false' in, real booleans out.
// Anything else (missing, blank) stays undefined so the repo leaves the
// filter off entirely rather than filtering on `false`.
function parseBool(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function filtersFrom(query) {
  return {
    q: query.q || undefined,
    role: query.role || undefined,
    group: query.group || undefined,
    company: query.company || undefined,
    method: query.method || undefined,
    currency: query.currency || undefined,
    status: query.status || undefined,
    needsReview: parseBool(query.needsReview),
    // The person's switch state across their live deals: yes, no or mixed.
    // Anything else is no filter, not an error.
    shouldBePaid: PAY_STATES.includes(query.shouldBePaid) ? query.shouldBePaid : undefined,
    paid: PAY_STATES.includes(query.paid) ? query.paid : undefined,
    paymentReceived: RECEIVED_STATES.includes(query.paymentReceived) ? query.paymentReceived : undefined,
  };
}

// The filter dropdowns, built from what the uploaded document actually
// contains. Served before the list so a filter can never offer a value
// that matches nothing, or omit one the sheet introduced this month.
router.get('/filters', async (req, res, next) => {
  try {
    res.json(await peopleRepo.filterOptions());
  } catch (err) {
    next(err);
  }
});

// Shown as a banner, never acted on — the user's rule is no merging.
router.get('/duplicates', async (req, res, next) => {
  try {
    res.json({ duplicates: await peopleRepo.possibleDuplicates() });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const cryptoPercent = await settingsRepo.cryptoPercent();
    const { rows, total } = await peopleRepo.findAll({
      ...filtersFrom(req.query), page, pageSize, cryptoPercent,
    });
    res.json({ people: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/:personId', async (req, res, next) => {
  try {
    const [person, settings] = await Promise.all([
      peopleRepo.findById(req.params.personId),
      settingsRepo.get(),
    ]);
    if (!person) return next(new AppError(404, messages.notFound.person));
    res.json({
      person: {
        ...person,
        monthly_totals: detailMonthlyTotals(person.deals, {
          useEndDate: Boolean(settings?.color_uses_end_date),
          cryptoPercent: Number(settings?.crypto_percent ?? 0),
        }),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Profile-level fields only (display name, email, notes, fee percentage).
// Anything that belongs to a deal (role, company, money, dates) is edited
// through the deal routes below, because it varies per deal and there is no
// single value to set on the person.
//
// THE PERSON'S STANDING RATES. An add on is income on top, a fee comes off
// the total. Both stack with the same two columns on a deal.
const PERCENT_FIELDS = { addonPercent: 'Add on percentage', feePercent: 'Fee percentage' };

router.patch('/:personId', async (req, res, next) => {
  try {
    const { displayName, email, notes, feePercent, addonPercent } = req.body || {};

    // Undefined is "not mentioned" and leaves it alone; a sent value has to
    // be a real number in range, or a typo writes into the export's money.
    for (const [field, label] of Object.entries(PERCENT_FIELDS)) {
      const sent = { feePercent, addonPercent }[field];
      if (sent === undefined) continue;
      const n = Number(sent);
      if (!Number.isFinite(n) || n < 0 || n > MAX_PERCENT) {
        return next(new AppError(400, `${label} must be between 0 and ${MAX_PERCENT}.`));
      }
    }

    const person = await peopleRepo.upsert({
      personId: req.params.personId,
      displayName,
      email,
      notes,
      feePercent,
      addonPercent,
    });
    broadcast(null, 'people:changed', { action: 'updated', personId: req.params.personId });
    // A WRITE THAT CHANGES ANOTHER PAGE MUST BROADCAST FOR THAT PAGE TOO.
    // Both rates ride on every deal row so the master sheet cell can warn
    // that person and deal stack, so a rate set here goes stale over there
    // until somebody reloads.
    if (feePercent !== undefined || addonPercent !== undefined) {
      broadcast(null, 'master-sheet:changed', { action: 'rate-changed', personId: req.params.personId });
    }
    res.json({ person });
  } catch (err) {
    next(err);
  }
});

/**
 * The chatbox's own navigation, kept working after `assignments` was
 * dropped. Namespaced under /lookup so it can't be confused with the
 * People page's own listing, which is a different shape entirely.
 */
router.get('/lookup/groups', async (req, res, next) => {
  try {
    const { groups } = await peopleRepo.filterOptions();
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

router.get('/lookup/search', async (req, res, next) => {
  try {
    const { group, q } = req.query;
    if (!group && !q) return next(new AppError(400, 'group or q query param is required'));
    const { rows } = await peopleRepo.findAll({ group, q, page: 1, pageSize: 100 });
    res.json({
      people: rows.map((r) => ({
        person_id: r.person_id,
        person_name: r.display_name,
        group_name: r.groups?.[0] ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Assigning a person to a company IS creating a deal. Same act from the
 * Companies page, same row, same table — which is why this lives on the
 * shared rows repo rather than being duplicated on both sides.
 */
router.post('/:personId/deals', async (req, res, next) => {
  try {
    const { personIdOf } = require('./masterSheet/identity');
    const { dealKey } = require('./masterSheet/dealKey');
    const personId = req.params.personId;
    const body = req.body || {};
    if (!body.company) return next(new AppError(400, 'A company is required'));
    if (!body.groupName) return next(new AppError(400, 'A group is required'));

    // Same identity the importer builds, so assigning someone here and
    // then uploading a sheet that already has them reconciles to one row
    // instead of paying them twice.
    const identity = {
      groupName: body.groupName,
      company: body.company,
      role: body.role || 'other',
      seat: body.seat ?? null,
      personId,
    };
    const existing = await rowsRepo.findMatchingDeals(identity);
    if (existing.length > 0 && body.allowDuplicate !== true) {
      const err = new AppError(409, `${body.personName || personId} is already on ${body.company}.`);
      err.matches = existing;
      return next(err);
    }

    const row = await rowsRepo.create({
      syncKey: dealKey(identity, existing.length),
      personId,
      personName: body.personName || personId,
      roleLabel: body.roleLabel || 'Other',
      role: body.role || 'other',
      seat: body.seat ?? null,
      groupName: body.groupName,
      company: body.company,
      monthlyAmount: body.monthlyAmount ?? 0,
      currency: body.currency || 'GBP',
      paymentMethod: body.paymentMethod || 'cash',
      ...body,
    });
    broadcast(null, 'master-sheet:changed', { action: 'created' });
    broadcast(null, 'people:changed', { action: 'deal-created', personId });
    res.status(201).json({ deal: row });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
