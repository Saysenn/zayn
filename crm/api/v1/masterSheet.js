const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const multer = require('multer');
const repo = require('./repos/masterSheetRows.repo');
const { parseMasterSheetImport } = require('./masterSheet/parseImport');
const { buildImportDiff } = require('./masterSheet/diffImport');
const { diffCompanies } = require('./masterSheet/diffCompanies');
const { SEEDED_NOT_ASKED, withCompanions } = require('./masterSheet/importColumns');
// THE EXPORT WRITES RATED FIGURES, so an imported one carries them and
// has to be taken back to the raw wage or every re-import compounds.
const { reverseRates } = require('./masterSheet/reverseRates');
// Which rates the FILE says are already inside its figures. Our own export
// declares them in an "Add ons" block; his own sheet declares nothing.
const { declaredRatesIn } = require('./masterSheet/declaredRates');
const companiesRepo = require('./repos/companies.repo');
const { DEFAULTABLE, parseDefaults, parseOverrides } = require('./masterSheet/importDefaults');
const { personIdOf, parseRole, statusFor } = require('./masterSheet/identity');
const { recomputePayable } = require('./shared/recomputePayable.helper');
// One cap for every rate, shared with people.js so a value the person route
// accepts the deal route cannot refuse.
const { MAX_PERCENT } = require('./shared/rates.helper');
// Deal Status: the three words, and what each writes. One definition.
const { DEAL_STATUS_VALUES } = require('./shared/dealStatus.helper');
const { dealKey } = require('./masterSheet/dealKey');
const { renamedGroups } = require('./masterSheet/renamedGroup');
const { buildMasterSheetWorkbook } = require('./masterSheet/buildWorkbook');
const { runAgent } = require('./agent/runAgent');
const { aiStatus } = require('./agent/aiStatus');
// Only `dealCard`, and only so one row can be served in the shape her
// panel already draws. See the /:id/card route below.
const agentTools = require('./agent/tools/masterSheet');
const { synthesizeSpeech, isConfigured: isTtsConfigured } = require('./agent/speech');
const { transcribeAudio, isConfigured: isTranscribeConfigured } = require('./agent/transcribe');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');
const logger = require('../configs/logger');
const { parsePagination } = require('./shared/pagination.helper');
// The business timezone, never the host's. A stop dated from a UTC clock is
// yesterday for seven hours a day, and the date decides a month's money.
const { currentDay, currentMonth } = require('./shared/presetMonth.helper');
const { broadcast } = require('./sockets/index');

/**
 * NO MESSAGE CAP HERE. There is ONE governor and it lives in runAgent.
 *
 * This used to slice to the last 20 messages, and runAgent then applied a
 * character budget on top. Two caps on one thing, and the message one was
 * the tighter in practice: three long messages could evict twenty short
 * ones that mattered. Whichever bit first decided what Diane remembered,
 * which is exactly the "two definitions" failure the char budget was
 * written to replace and then did not replace.
 *
 * The budget still bounds the token bill and still limits how far back a
 * prompt injection could hide, so nothing is lost by dropping this.
 */

// The CRM's own master sheet — admin CRUD over tb_mastersheet, plus the
// xlsx export. Admin session only (mounted under requireSession in app.js);
// whatbot's own pull/push live on the agent router behind the API key
// instead, never sharing a route with these.
const router = Router();

// In memory, never written to disk — unlike the calculator's own upload
// (which keeps its source files around so "Generate now" can re-read
// them), this file's only job is to be parsed once into tb_mastersheet.
// Keeping a copy would just be a second, staler source of truth.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }, // a real master sheet is a few hundred KB
  fileFilter(req, file, cb) {
    const isXlsx =
      /\.xlsx$/i.test(file.originalname) &&
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // cb(error, acceptFile) — the second argument is required. cb(null)
    // alone silently drops the file with no error at all, a real bug this
    // codebase already hit once on the calculator's own upload.
    if (!isXlsx) return cb(new AppError(400, messages.notXlsx(file.originalname)));
    cb(null, true);
  },
});


/**
 * Builds the identity for a hand-added row, and refuses to create a
 * second copy of something that already exists.
 *
 * Uses the SAME key the importer uses (masterSheet/dealKey.js). That
 * sharing is the fix for a real bug: hand-added rows used to get keys in
 * their own namespace ("manual|nathan|..."), so they could never collide
 * with an uploaded row, so adding someone by hand and then uploading a
 * sheet that also contained them produced two rows for one arrangement —
 * and the upload's delete step skips manual rows, so nothing cleaned it
 * up. Two rows means two payments.
 *
 * Comparison is deliberately loose: trim, lowercase, strip punctuation
 * and spacing. Two people typing the same company disagree about all
 * three constantly.
 *
 * NOT a hard block. One person genuinely holds the same role on the same
 * company twice with different payable days, so `allowDuplicate` lets a
 * caller say "yes, really" — and then the row gets an explicit dedupe
 * suffix so BOTH survive rather than one overwriting the other.
 */
async function resolveSyncKey(identity, { allowDuplicate = false } = {}) {
  const matches = await repo.findMatchingDeals(identity);
  if (matches.length > 0 && !allowDuplicate) {
    const err = new AppError(
      409,
      `${identity.personName || identity.personId} is already on ${identity.company || identity.groupName} as ${identity.roleLabel || identity.role}.`,
    );
    err.matches = matches;
    throw err;
  }
  return dealKey(identity, matches.length);
}

const PAYMENT_METHODS = ['cash', 'bank', 'crypto'];

// Currencies are NOT a closed set, and the whitelist that used to sit here
// was rejecting real rows. The boss's sheet writes "EURO", not the ISO
// "EUR", and 6 live deals carry it — so any write touching currency on one
// of those rows 400'd, including a full-row save that only meant to change
// something else entirely.
//
// The column has no CHECK constraint, deliberately (migration 013: "plain
// text precisely so a messy value survives to be corrected"). The route
// was the only thing enforcing a set the data never agreed to. Now it just
// normalises case, the same as the importer does, so "Euro" and "EURO"
// stay one currency rather than two.
//
// Contrast payment method just above, which IS closed: three values, all
// three drive real routing (cash sheet vs bank sheet), and a fourth needs
// a deliberate change in three places.
// Every outcome a payday check can end in, matching payment_status's own
// CHECK constraint exactly (migrations 004 and 021) — this column is a
// mirror of that one, so a value it can hold has to be a value an admin
// can set here. Listing only the two clear answers meant a mirrored
// 'sent' or 'no_response' rendered fine but couldn't be re-selected once
// you'd changed it. null is the real extra state, "not checked yet".
const PAYMENT_OUTCOMES = ['sent', 'confirmed', 'partial', 'not_received', 'no_response'];

// "" and null both mean "no date" and must stay distinguishable from a bad
// one — a typo'd date is a rejected request, not a silent null that quietly
// blanks a payment start date.
function parseDate(v, field) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    throw new AppError(400, `${field} must be YYYY-MM-DD`);
  }
  return String(v);
}

function parseMoney(v, field) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(400, `${field} must be a number, 0 or more`);
  return n;
}

/**
 * The id list both bulk routes take, validated once.
 *
 * It was six identical lines in each of bulk-update and bulk-delete. What
 * was worth removing is the CHECK, not the two message strings: pulling
 * the strings into a constant would have left the two `if`s free to drift
 * apart on their own.
 *
 * Returns numbers, because both callers wanted `.map(Number)` anyway.
 */
function parseIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'ids must be a non-empty array');
  }
  // `Number(null)` and `Number('')` are both 0, and 0 is an integer, so the
  // bare isInteger check let a null through as id 0. Nothing has id 0 so it
  // deleted nothing, but a guard on a bulk delete should refuse what it
  // cannot read rather than quietly turn it into a row number.
  const blank = (id) => id === null || id === undefined || String(id).trim() === '';
  if (ids.some((id) => blank(id) || !Number.isInteger(Number(id)))) {
    throw new AppError(400, 'every id must be a number');
  }
  return ids.map(Number);
}

function parseDays(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 31) {
    throw new AppError(400, 'payableDays must be a whole number between 0 and 31');
  }
  return n;
}

function text(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * One request body -> the repo's field shape. Shared by create and update
 * so the two can't validate differently — the thing that actually goes
 * wrong otherwise is a field being creatable but silently unsaveable on
 * edit, which only shows up as "my change didn't stick".
 *
 * `partial` is what separates them: on create the required fields must be
 * present, on update only what was sent gets touched.
 */
function toFields(body, { partial }) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  const personName = text(body.personName);
  const roleLabel = text(body.roleLabel);
  const groupName = text(body.groupName).toUpperCase();

  if (!partial || has('personName')) {
    if (!personName) throw new AppError(400, 'personName is required');
    out.personName = personName;
    out.personId = personIdOf(personName);
  }
  if (!partial || has('roleLabel')) {
    if (!roleLabel) throw new AppError(400, 'roleLabel is required');
    const { role, seat } = parseRole(roleLabel);
    out.roleLabel = roleLabel;
    out.role = role;
    out.seat = seat;
  }
  if (!partial || has('groupName')) {
    if (!groupName) throw new AppError(400, 'groupName is required');
    out.groupName = groupName;
  }

  if (!partial || has('company')) out.company = text(body.company) || null;
  if (!partial || has('phone')) out.phone = text(body.phone);
  if (!partial || has('assignedOn')) out.assignedOn = parseDate(body.assignedOn, 'assignedOn');
  if (!partial || has('paymentStartOn')) out.paymentStartOn = parseDate(body.paymentStartOn, 'paymentStartOn');
  if (!partial || has('presetOn')) out.presetOn = parseDate(body.presetOn, 'presetOn');
  if (!partial || has('endOn')) out.endOn = parseDate(body.endOn, 'endOn');
  /**
   * SOMEBODY SAYING THIS MONTH PAYS IT, whatever the start derives.
   * Migration 064. A plain boolean: the column is NOT NULL, so there is no
   * "nobody decided" third state to carry, unlike the two payment
   * overrides. Coerced rather than trusted, because a JSON body can hand
   * over the string "false" and it is truthy.
   */
  if (!partial || has('specialCaseDeal')) out.specialCaseDeal = body.specialCaseDeal === true || body.specialCaseDeal === 'true';
  if (!partial || has('payableDays')) out.payableDays = parseDays(body.payableDays);
  if (!partial || has('monthlyAmount')) out.monthlyAmount = parseMoney(body.monthlyAmount, 'monthlyAmount');
  if (!partial || has('payableAmount')) out.payableAmount = parseMoney(body.payableAmount, 'payableAmount');

  if (!partial || has('currency')) {
    out.currency = text(body.currency).toUpperCase() || 'GBP';
  }
  if (!partial || has('paymentMethod')) {
    const method = text(body.paymentMethod).toLowerCase() || 'cash';
    if (!PAYMENT_METHODS.includes(method)) {
      throw new AppError(400, `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
    }
    out.paymentMethod = method;
  }

  // Every free-text column, including the four the importer used to drop
  // (door number, accepting postals, account number, sort code). All
  // text and never coerced to numbers — the real sheet writes "Will never
  // be bank" as an account number and "In person meet" as a door number.
  for (const key of [
    'location', 'doorNumber', 'postcode', 'acceptingPostals',
    'label', 'shouldBePaid', 'paid', 'notes',
    'bankDetails', 'accountNumber', 'sortCode',
  ]) {
    if (!partial || has(key)) out[key] = text(body[key]);
  }

  /**
   * ===============================
   * * THE DEAL'S OWN TWO RATES, AND THE ROUTE USED TO DROP THEM
   * ===============================
   * The column is editable in the repo and the cell is editable on screen,
   * but nothing here read the body, so a PATCH carrying `addonPercent`
   * saved everything else and silently discarded the rate. The toast said
   * it had worked, the optimistic paint showed the new figure, and the
   * refetch put the old one straight back.
   *
   * It cost nothing while the rates only reached a block at the foot of an
   * export. It costs the MONEY now: the Monthly amount is computed from
   * them.
   *
   * VALIDATED THE SAME WAY people.js validates the person's pair, against
   * the same `MAX_PERCENT`. A typo here writes into the export's figures.
   */
  for (const [key, label] of [['addonPercent', 'Add on percentage'], ['feePercent', 'Fee percentage']]) {
    if (!has(key)) continue;
    const value = body[key];
    // Cleared is zero, not null: the column is NOT NULL and a blank cell
    // means "no rate", which is what zero says.
    if (value === null || value === '') { out[key] = 0; continue; }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PERCENT) {
      throw new AppError(400, `${label} must be between 0 and ${MAX_PERCENT}.`);
    }
    out[key] = n;
  }

  // The admin's structured decision, as booleans — deliberately separate
  // from shouldBePaid/paid just above, which are the sheet's own free text
  // (whatever the boss typed, "yes", "n/a", a sentence). Three states
  // matter here, not two: true, false, and null meaning "no decision made,
  // fall back to what the sheet says". Only ever set on a PATCH, never
  // required on create.
  for (const key of ['overrideShouldBePaid', 'overridePaid']) {
    if (!has(key)) continue;
    const value = body[key];
    if (value === null || value === '') { out[key] = null; continue; }
    if (typeof value !== 'boolean') {
      throw new AppError(400, `${key} must be true, false, or null`);
    }
    out[key] = value;
  }

  // The person's own payday answer, normally written by whatbot's mirror.
  // Editable here so an admin can correct it (they took the call, the reply
  // never arrived, the bot misread a "yes") — but only to a value whatbot
  // itself could have set, never free text, or the column stops meaning one
  // thing. Empty clears it back to "not checked yet".
  if (has('paymentOutcome')) {
    const outcome = text(body.paymentOutcome);
    if (outcome && !PAYMENT_OUTCOMES.includes(outcome)) {
      throw new AppError(400, `paymentOutcome must be one of ${PAYMENT_OUTCOMES.join(', ')}`);
    }
    out.paymentOutcome = outcome || null;
  }

  // Derived, never taken from the request — it's a fact about the end date,
  // and letting a caller set it independently is how a row ends up marked
  // active with a date two years past.
  if (out.endOn !== undefined) out.status = statusFor(out.endOn);

  // Clearing the flag is an explicit admin action ("I looked, it's fine"),
  // so it's accepted from the request — but the reason is cleared with it,
  // never left behind to explain a flag that's no longer set.
  if (body.needsReview !== undefined) {
    out.needsReview = Boolean(body.needsReview);
    if (!out.needsReview) out.reviewReason = '';
  }

  return out;
}

// Query params are always strings — 'true'/'false' in, real booleans out.
// Anything else stays undefined so the repo leaves the filter off entirely
// rather than filtering on "false".
function parseBoolParam(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

router.get('/master-sheet', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 500 });
    const { rows, total } = await repo.findAll({
      group: req.query.group,
      source: req.query.source,
      needsReview: parseBoolParam(req.query.needsReview),
      status: req.query.status,
      shouldBePaid: parseBoolParam(req.query.shouldBePaid),
      paid: parseBoolParam(req.query.paid),
      missingPerson: parseBoolParam(req.query.missingPerson),
      missingCompany: parseBoolParam(req.query.missingCompany),
      // 'current' | 'future' | 'old', against the month we are in now.
      presetWhen: req.query.presetWhen || undefined,
      // A figure between two bounds. The field is checked against an
      // allow-list in the repo, never interpolated as given.
      amountField: req.query.amountField || undefined,
      amountMin: req.query.amountMin,
      amountMax: req.query.amountMax,
      q: req.query.q,
      // Which column the search box is pointed at. Allow-listed in the repo,
      // and an unknown value falls back to searching everything.
      searchField: req.query.searchField || undefined,
      currency: req.query.currency || undefined,
      paymentMethod: req.query.paymentMethod || undefined,
      // THE ARCHIVE IS THIS ROUTE WITH ONE FLAG FLIPPED. Not a second
      // endpoint over a second table: one deal, one row, read two ways.
      stopped: parseBoolParam(req.query.stopped) ?? false,
      stoppedFrom: req.query.stoppedFrom || undefined,
      stoppedTo: req.query.stoppedTo || undefined,
      stoppedReason: req.query.stoppedReason || undefined,
      // The deal's COMPANY status, never the deal's own. See the badge.
      companyStatus: req.query.companyStatus || undefined,
      // AND THE DEAL'S OWN, which is the PAIR end_note/review_monthly read
      // by priority. An unknown value is ignored by the repo, not an error.
      dealStatus: req.query.dealStatus || undefined,
      // A deal paid a month its own dates exclude. THROUGH parseBoolParam,
      // so "false" is a filter and not an absent one: "which are NOT
      // special cases" has to be askable, and `|| undefined` would drop it.
      specialCaseDeal: parseBoolParam(req.query.specialCaseDeal),
      page,
      pageSize,
    });
    res.json({ rows, total, page, pageSize, counts: await repo.counts() });
  } catch (err) {
    next(err);
  }
});

// The export. Built fresh on every request rather than written to disk like
// the calculator's numbered runs — this file has exactly one meaningful
// version (whatever the sheet says right now), so a stored copy would only
// ever be a stale one somebody could download by mistake.
/**
 * The edit history, and the way back out of one.
 *
 * Every cell in the CRM is editable in place now, which makes a mistyped
 * figure one keystroke away. This is the safety net: what changed, who
 * changed it, and a one-click undo per field.
 *
 * `rowId` narrows it to one deal. Person and company scopes cover all of
 * the current deals represented by their detail pages.
 */
// ===============================
// * PAGED, AND IT SAYS HOW MANY THERE ARE
// ===============================
// It returned one capped slice and no total, so History showed the newest
// 200 changes of however many there were with nothing saying it had cut.
// A cap you cannot see is the bug (CLAUDE.md). The repo already counted;
// only the route was throwing the number away. Fixed 2026-09-29.
const CHANGES_PAGE_SIZE = 25;
const CHANGES_MAX_PAGE_SIZE = 200;

router.get('/master-sheet/changes', async (req, res, next) => {
  try {
    const pageSize = Math.min(
      Number(req.query.pageSize) || Number(req.query.limit) || CHANGES_PAGE_SIZE,
      CHANGES_MAX_PAGE_SIZE,
    );
    const page = Math.max(1, Number(req.query.page) || 1);

    const { rows, total } = await repo.findFieldChanges({
      hours: Number(req.query.hours) || 168,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      withTotal: true,
      rowId: req.query.rowId ? Number(req.query.rowId) : null,
      personId: req.query.personId || null,
      company: req.query.company || null,
      includeReverted: req.query.includeReverted === 'true',
      // Bound, never interpolated: an unknown field just matches nothing.
      field: req.query.field || null,
    });
    res.json({ changes: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

/**
 * ONE ROW, AS THE CARD DIANE DRAWS.
 *
 * Her deal list is chips now, and clicking one opens the full card in a
 * modal. The chip carries six fields; the card needs the row.
 *
 * IT REUSES HER OWN BUILDER (`dealCard` from the agent tools) rather than
 * shipping the row and letting the browser assemble a card. Assembling it
 * there would be a second definition of what a deal card is, and the two
 * would disagree the first time either changed.
 *
 * ABOVE `/master-sheet/:id` on purpose, or Express matches `:id` first and
 * `card` never gets here.
 */
router.get('/master-sheet/:id/card', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'That is not a row id.' });

    const row = await repo.findById(id);
    if (!row) return res.status(404).json({ error: 'That row was not found.' });

    return res.json({ card: agentTools.dealCard(row) });
  } catch (err) {
    return next(err);
  }
});

/**
 * ===============================
 * * WHAT THIS PERSON'S OTHER DEALS ALREADY KNOW ABOUT THEM
 * ===============================
 * His call 2026-09-23. Phone, address and bank details are facts about the
 * PERSON, so every deal they hold carries the same eight columns and one is
 * usually the most complete. The edit form offers to fill its blanks from
 * it rather than making somebody type a postcode they already stored.
 *
 * TWO ANSWERS, LIVE AND ARCHIVED, and the caller decides which to offer.
 * An archived deal is the last thing anybody knew, which is the only
 * answer left for somebody whose other deals have all ended.
 *
 * READ ONLY. It returns values; nothing is written until the form is
 * saved like any other edit, through the route that already validates it.
 */
router.get('/master-sheet/person-fill', async (req, res, next) => {
  try {
    const personId = String(req.query.personId ?? '').trim();
    if (!personId) return res.status(400).json({ error: 'personId is required.' });
    // The row being edited cannot fill itself, and on a complete row it
    // would otherwise always be the best donor.
    const raw = Number(req.query.exclude);
    const excludeId = Number.isInteger(raw) ? raw : null;
    return res.json(await repo.personFill(personId, { excludeId }));
  } catch (err) {
    return next(err);
  }
});

router.post('/master-sheet/changes/:id/revert', async (req, res, next) => {
  try {
    const result = await repo.revertFieldChange(Number(req.params.id));
    // A refusal here is a real answer, not a server fault — the change was
    // already undone, or the deal is gone. 409 rather than 500 so the page
    // can show the reason instead of "something went wrong".
    if (!result.ok) return next(new AppError(409, result.reason));
    broadcast(null, 'master-sheet:changed', { action: 'reverted', id: result.row?.id });
    broadcast(null, 'people:changed', { action: 'reverted' });
    broadcast(null, 'companies:changed', { action: 'reverted' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/master-sheet/download', async (req, res, next) => {
  try {
    const rows = await repo.findAllRows();
    const wb = buildMasterSheetWorkbook(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="crm-master-sheet-${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post('/master-sheet', async (req, res, next) => {
  try {
    const fields = toFields(req.body || {}, { partial: false });
    // A BLANK AMOUNT OR DAY COUNT IS NOT A TYPED ZERO. parseMoney/parseDays
    // turn blank into 0, which read as "given" below, so the formula never
    // ran and every deal added without those two cells landed owing 0.
    const blank = (v) => v === undefined || v === null || v === '';
    if (blank(req.body?.payableAmount)) fields.payableAmount = null;
    if (blank(req.body?.payableDays)) fields.payableDays = null;
    // THE APPOINTMENT FILLS THE REST, the way it does on his own sheet.
    // A new deal used to land with four empty cells even when the
    // appointment date was typed. onCreate, because toFields sets every
    // key, so an unfilled one arrives as null rather than absent.
    //
    // No `derived` to pass on: an insert writes no claims, so there is
    // nothing here for a derived value to be wrongly marked as.
    recomputePayable({}, fields, { onCreate: true });
    // Both columns are NOT NULL; nothing to derive from is still 0.
    fields.payableAmount ??= 0;
    fields.payableDays ??= 0;
    const syncKey = await resolveSyncKey(
      { ...fields, groupName: fields.groupName, company: fields.company },
      { allowDuplicate: req.body?.allowDuplicate === true },
    );
    const row = await repo.create({ ...fields, syncKey });
    broadcast(null, 'master-sheet:changed', { action: 'created', id: row.id });
    res.status(201).json({ row });
  } catch (err) {
    next(err);
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.patch('/master-sheet/:id', async (req, res, next) => {
  try {
    const fields = toFields(req.body || {}, { partial: true });

    // Payable amount follows its inputs, the way column L follows K and I
    // in the boss's own sheet. Needs the row as it stands, because a patch
    // carries only what changed and the formula needs all of it.
    const before = await repo.findById(req.params.id);
    if (!before) return next(new AppError(404, messages.notFound.row));
    const derived = recomputePayable(before, fields);

    /**
     * THE MONTH ROLL IS NOT A PERSON. Its PATCHes carry `?roll=<batch>`
     * from the preset-roll check, so History shows one automatic change
     * per month and undo can tell it apart from an admin's edit. Live
     * 2026-10-03: "undo the fee change" reverted the roll instead, because
     * both were unbatched 'admin' rows on the same six deals.
     */
    const rollBatch = UUID.test(String(req.query.roll ?? '')) ? String(req.query.roll) : null;
    let row = await repo.update(req.params.id, fields, rollBatch ? 'scheduled' : 'admin', rollBatch
      ? { derived, batchId: rollBatch, claim: false }
      : { derived });
    if (!row) return next(new AppError(404, messages.notFound.row));

    // FILLING THE MISSING HALF BACK IN IS WHAT CLEARS THE FLAG.
    //
    // Not a "mark as sorted" button: a flag you can dismiss without fixing
    // anything stops meaning anything. So the check runs on any edit that
    // could have supplied the missing side, and clearOrphanFlags only
    // clears the half that is genuinely no longer empty.
    if (row.orphaned_person || row.orphaned_company) {
      // Typing a name into the Name cell fills person_name and nothing
      // else, but person_id is the column that says whether the deal has a
      // handler — it is what People groups by, and what clearOrphanFlags
      // tests. Derive it here, with the same personIdOf the importer and
      // the hand-add path use, or reassigning by editing the cell would
      // leave the row flagged forever with a name sitting in it.
      if (row.orphaned_person && !row.person_id && row.person_name) {
        row = await repo.update(row.id, { personId: personIdOf(row.person_name) }, 'admin') ?? row;
      }
      if ('personName' in fields || 'personId' in fields || 'company' in fields) {
        row = await repo.clearOrphanFlags(row.id) ?? row;
      }
    }

    broadcast(null, 'master-sheet:changed', { action: 'updated', id: row.id });
    // The return leg of the override mirror: a should-be-paid/paid toggle
    // here also writes calculator_overrides (masterSheetRows.repo.js's
    // update), which is what the People page reads. Without this, People
    // stays stale in every tab but the one that made the edit.
    if ('overrideShouldBePaid' in fields || 'overridePaid' in fields) {
      broadcast(null, 'assignments:changed', {
        groupName: row.group_name,
        company: row.company,
        personName: row.person_name,
      });
    }
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

// A synced row deleted here comes straight back on the next month-start
// sync, unless the human sheet dropped it too — that's correct, not a bug:
// the CRM's copy is the polish, not the origin. Deleting a manual row is
// permanent, since nothing else holds it.
router.delete('/master-sheet/:id', async (req, res, next) => {
  try {
    const row = await repo.remove(req.params.id);
    if (!row) return next(new AppError(404, messages.notFound.row));
    broadcast(null, 'master-sheet:changed', { action: 'deleted', id: row.id });
    res.json({ deleted: row.id });
  } catch (err) {
    next(err);
  }
});

/**
 * ===============================
 * * STOP AND RESUME. THE DEAL IS OVER, THE ROW IS NOT.
 * ===============================
 *
 * Delete removes a pairing that should never have existed. Stop records
 * that a real one has ended: the history is payroll, and the months it was
 * paid in are already in the snapshots. So the row stays and moves to the
 * Archive, out of the sheet and out of every total.
 *
 * BOTH BROADCAST master-sheet:changed, because the row leaves one list and
 * joins another and both are open in some tab.
 */
/**
 * ===============================
 * * ONE DEAL'S STATUS, ITS OWN DOOR
 * ===============================
 * Deal Status is a NAME for review_monthly and end_note, and neither is in
 * COLUMN_FOR: they are not cells somebody types into, so they cannot come
 * through the ordinary row PATCH. See shared/dealStatus.helper.
 *
 * IT MOVES THE REVIEW QUEUE, so the broadcast goes out for the pages that
 * count it, not just the one the edit came from.
 */
router.patch('/master-sheet/:id/deal-status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!DEAL_STATUS_VALUES.includes(status)) {
      return next(new AppError(400, messages.notADealStatus(status)));
    }
    const row = await repo.setDealStatus(req.params.id, status);
    if (!row) return next(new AppError(404, messages.notFound.row));

    broadcast(null, 'master-sheet:changed', { action: 'deal-status', id: row.id });
    // The company's own checklist reads these two columns back, so its
    // page is stale the moment this writes.
    broadcast(null, 'companies:changed', { action: 'deal-status', company: row.company });
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

router.post('/master-sheet/:id/stop', async (req, res, next) => {
  try {
    // Today, in the business zone. A hand stop is "as of now", and the
    // caller does not get to name a date: a backdated stop would silently
    // rewrite a month that has already been paid.
    const row = await repo.stop(req.params.id, {
      on: currentDay(),
      reason: repo.STOPPED_REASON.BY_HAND,
    });
    if (!row) return next(new AppError(404, messages.notFound.row));
    broadcast(null, 'master-sheet:changed', { action: 'stopped', id: row.id });
    broadcast(null, 'assignments:changed', {
      groupName: row.group_name, company: row.company, personName: row.person_name,
    });
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

router.post('/master-sheet/:id/resume', async (req, res, next) => {
  try {
    const before = await repo.findById(req.params.id);
    if (!before) return next(new AppError(404, messages.notFound.row));
    // The one resume that is refused, and it is refused for a reason the
    // admin can act on: the company is closed, so reopen the company and
    // every deal it stopped comes back together.
    if (before.stopped_reason === repo.REOPEN_THE_COMPANY) {
      return next(new AppError(409, messages.resumeTheCompany(before.company)));
    }
    const row = await repo.resume(req.params.id);
    if (!row) return next(new AppError(404, messages.notFound.row));
    broadcast(null, 'master-sheet:changed', { action: 'resumed', id: row.id });
    broadcast(null, 'assignments:changed', {
      groupName: row.group_name, company: row.company, personName: row.person_name,
    });
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

// Bulk delete for the page's checkbox-select rows — one round trip and one
// broadcast, not N of each. POST rather than DELETE so a real JSON body
// (the id list) is never in question — a DELETE with a body works in most
// clients but isn't universally reliable through every proxy.
// New month preset roll, checked on sign in: live deals whose preset is
// still behind this month. The boot screen moves each one through the row
// PATCH, and re-checks on the month's first three sign ins — one pass can
// leave rows behind when a PATCH fails, and nothing else notices.
router.get('/master-sheet/preset-roll', async (req, res, next) => {
  try {
    const month = `${currentMonth()}-01`;
    res.json({ month, ids: await repo.stalePresetIds(month), batchId: randomUUID() });
  } catch (err) {
    next(err);
  }
});

/**
 * ONE VALUE ONTO MANY ROWS, from the export modal's warnings panel.
 *
 * "Set to August 2026" on the six rows still marked July. The same act as
 * editing the cell six times, so it goes through the same `toFields`
 * validation and the same `update`, per row: `recomputePayable` needs the
 * row it is patching, and a rate or a date changing has to move the payable
 * figure with it exactly as it does on a single edit.
 *
 * NOT ONE STATEMENT. Eighty-four rows is eighty-four small writes, which is
 * slower and correct, against one clever UPDATE that would skip the
 * recompute, skip the override guard and skip the change log. The log is
 * what makes this undoable, and a bulk write nobody can undo is the one
 * kind this codebase has already regretted.
 */
router.post('/master-sheet/bulk-update', async (req, res, next) => {
  try {
    const { ids: rawIds, fields: body } = req.body || {};
    const ids = parseIds(rawIds);
    const fields = toFields(body || {}, { partial: true });
    if (Object.keys(fields).length === 0) {
      return next(new AppError(400, 'No fields to set.'));
    }

    // ONE ACT IN HISTORY. Every row this writes shares a batch, so History
    // shows "Paid → yes on 3 deals" once and the toast's Undo puts all
    // three back with one press.
    const batchId = randomUUID();
    // The bulk bar sends this for Paid / Should be paid / Special case: a
    // stopped deal is owed nothing, so deciding its pay is meaningless.
    const skipStopped = req.body?.skipStopped === true;
    const updated = [];
    const skipped = { same: 0, stopped: 0, gone: 0 };
    for (const id of ids) {
      // Already numbers: parseIds converted them once, up front.
      const before = await repo.findById(id);
      // A row that has gone since the panel was drawn is skipped, not an
      // error: the count is what gets reported back, so the toast says how
      // many actually moved rather than claiming all of them did.
      if (!before) { skipped.gone += 1; continue; }
      if (skipStopped && before.stopped_on) { skipped.stopped += 1; continue; }
      // ALREADY THERE, SO NOT TOUCHED. Ticking three deals where two are
      // already paid and pressing Paid → Yes writes ONE change, not three,
      // so History and Undo hold only what really moved.
      if (alreadySet(before, fields)) { skipped.same += 1; continue; }
      const patch = { ...fields };
      const derived = recomputePayable(before, patch);
      const row = await repo.update(id, patch, 'admin', { derived, batchId });
      if (row) updated.push(row);
    }

    broadcast(null, 'master-sheet:changed', { action: 'bulk-updated', ids: updated.map((r) => r.id) });
    // The same return leg the single PATCH has: People reads these two
    // columns, and without it stays stale in every other open tab.
    if (updated.length && ('overrideShouldBePaid' in fields || 'overridePaid' in fields)) {
      broadcast(null, 'assignments:changed', { action: 'bulk-updated' });
      broadcast(null, 'people:changed', { action: 'bulk-updated' });
    }
    res.json({ updated: updated.map((r) => r.id), skipped, batchId: updated.length ? batchId : null });
  } catch (err) {
    next(err);
  }
});

/**
 * Is every field in this patch already the row's value? Only for the
 * switch-like fields, where "the same" is unambiguous: a yes is a yes. A
 * date or an amount is compared by its own rules in update, not here.
 */
const SWITCHES = new Set(['overrideShouldBePaid', 'overridePaid', 'needsReview']);
function alreadySet(before, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return false;
  return keys.every((key) => {
    if (SWITCHES.has(key)) {
      const was = before[repo.COLUMN_FOR[key]];
      return (was ?? null) === (fields[key] ?? null);
    }
    // Special case is a date, but the bar only ever turns it on or off.
    if (key === 'specialCaseDeal') {
      return Boolean(before.special_case_deal) === Boolean(fields.specialCaseDeal);
    }
    return false;
  });
}

/**
 * ===============================
 * * STOP AND RESUME, MANY AT ONCE
 * ===============================
 * The same `stop` and `resume` a single row goes through, row by row, so
 * the guards (a closed company refuses resume) cannot be skipped by doing
 * it in bulk. One batch, so it is one act in History and one Undo.
 */
router.post('/master-sheet/bulk-stop', async (req, res, next) => {
  try {
    const ids = parseIds(req.body?.ids);
    const batchId = randomUUID();
    const stopped = [];
    let skipped = 0;
    for (const id of ids) {
      const before = await repo.findById(id);
      // Already stopped keeps its own date: a second stop would move it
      // and rewrite a month that was settled on the first.
      if (!before || before.stopped_on) { skipped += 1; continue; }
      const row = await repo.stop(id, { on: currentDay(), reason: repo.STOPPED_REASON.BY_HAND, batchId });
      if (row) stopped.push(row.id);
    }
    broadcast(null, 'master-sheet:changed', { action: 'bulk-stopped', ids: stopped });
    if (stopped.length) {
      broadcast(null, 'assignments:changed', { action: 'bulk-stopped' });
      broadcast(null, 'people:changed', { action: 'bulk-stopped' });
    }
    res.json({ stopped, skipped, batchId: stopped.length ? batchId : null });
  } catch (err) {
    next(err);
  }
});

router.post('/master-sheet/bulk-resume', async (req, res, next) => {
  try {
    const ids = parseIds(req.body?.ids);
    const batchId = randomUUID();
    const resumed = [];
    const refused = [];
    let skipped = 0;
    for (const id of ids) {
      const before = await repo.findById(id);
      if (!before || !before.stopped_on) { skipped += 1; continue; }
      // Closed with its company: reopening the company is the way back.
      if (before.stopped_reason === repo.REOPEN_THE_COMPANY) { refused.push(before.company); continue; }
      const row = await repo.resume(id, { batchId });
      if (row) resumed.push(row.id);
    }
    broadcast(null, 'master-sheet:changed', { action: 'bulk-resumed', ids: resumed });
    if (resumed.length) {
      broadcast(null, 'assignments:changed', { action: 'bulk-resumed' });
      broadcast(null, 'people:changed', { action: 'bulk-resumed' });
    }
    res.json({ resumed, skipped, refused: [...new Set(refused)], batchId: resumed.length ? batchId : null });
  } catch (err) {
    next(err);
  }
});

/**
 * UNDO MANY. Either one bulk act by its batch (the toast's Undo) or the
 * change ids ticked on History. Through revertChangeBatch, the same path
 * a single undo takes, so the two cannot drift apart.
 */
router.post('/master-sheet/changes/revert-many', async (req, res, next) => {
  try {
    const { batchId } = req.body || {};
    let ids;
    if (batchId) {
      if (!UUID.test(String(batchId))) return next(new AppError(400, 'Not a batch id.'));
      ids = await repo.changeIdsForBatch(batchId);
    } else {
      ids = parseIds(req.body?.ids);
    }
    const { done, failed } = await repo.revertChangeBatch(ids);
    broadcast(null, 'master-sheet:changed', { action: 'reverted' });
    broadcast(null, 'people:changed', { action: 'reverted' });
    broadcast(null, 'companies:changed', { action: 'reverted' });
    broadcast(null, 'assignments:changed', { action: 'reverted' });
    res.json({ reverted: done.length, failed });
  } catch (err) {
    next(err);
  }
});

// Which document the admin was looking at when they decided. Allow-listed
// because it goes into `changed_via`, which has a CHECK on it, and because
// it arrives from the browser.
const DELETE_VIA = new Set(['admin', 'import']);

router.post('/master-sheet/bulk-delete', async (req, res, next) => {
  try {
    const ids = parseIds(req.body?.ids);
    const via = DELETE_VIA.has(req.body?.via) ? req.body.via : 'admin';
    const deleted = await repo.removeMany(ids, { via });
    broadcast(null, 'master-sheet:changed', { action: 'bulk-deleted', ids: deleted });
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

// The polishing agent's one endpoint. Stateless on purpose — the browser
// tab holds the conversation (AgentOrb.jsx's own state) and resends it each
// turn, same reason whatbot's own chat history is per-conversation rather
// than server-pinned: nothing here needs to survive a page refresh, and a
// server-side session is one more thing to leak across admins on a shared
// login (root CLAUDE.md — "1-3 admins, no user management").
//
// `context` is the workspace panel's current selection — it decides which
// tools and which prompt Diane gets for this turn, and the other
// workspace's tools are absent from the request entirely (see
// agent/contexts.js). An unknown or missing value falls back to the
// master sheet rather than erroring, so a stale tab still works.
/**
 * A FILE FOR DIANE: .xlsx, .csv or .txt, turned into text she checks
 * against the sheet (agent/engine/sheetCheck.js). Nothing is written here.
 * Its own upload, because the import's only takes .xlsx.
 */
const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/\.(xlsx|csv|txt|tsv|json|docx|pptx)$/i.test(file.originalname)) {
      return cb(new AppError(400, `Diane can read Excel, CSV, text, JSON, Word or PowerPoint files, not ${file.originalname}.`));
    }
    cb(null, true);
  },
});
router.post('/master-sheet/agent/attach', (req, res, next) => {
  attachUpload.single('file')(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    try {
      if (!req.file) return next(new AppError(400, messages.noFile));
      // ANY FILE: cut into its tables and its free text (agent/engine/intake.js).
      // What the columns mean is worked out when they say what they want.
      // eslint-disable-next-line global-require
      const { intake } = require('./agent/engine/intake');
      const got = await intake({ buffer: req.file.buffer, filename: req.file.originalname });
      const rows = got.tables.reduce((n, t) => n + t.rows.length, 0);
      res.json({
        filename: req.file.originalname,
        tables: got.tables,
        text: got.text,
        lines: rows + got.text.split(/\r?\n/).filter((l) => l.trim()).length,
      });
    } catch (e) {
      // In words they can act on; the reason itself goes to the server log.
      req.log?.warn?.({ err: e.message }, 'diane: an attached file could not be read');
      next(new AppError(400, `I couldn't read ${req.file?.originalname ?? 'that file'}. If it's open in Excel, save it and try again, or send it as a CSV.`));
    }
  });
});

router.post('/master-sheet/agent', async (req, res, next) => {
  try {
    const { history, context } = req.body || {};
    if (!Array.isArray(history) || history.length === 0) {
      return next(new AppError(400, 'history must be a non-empty array'));
    }
    for (const m of history) {
      if (!['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
        return next(new AppError(400, 'each history entry needs role (user/assistant) and content'));
      }
    }
    // LOCKED IS LOCKED HERE TOO, not only a hidden button: a stale tab can still post.
    const ai = await aiStatus();
    if (!ai.available) return next(new AppError(503, messages.agent.locked[ai.reason]));

    // Whole, not sliced. runAgent's character budget is the one governor;
    // see the note above MAX_HISTORY_MESSAGES' removal.
    const trimmed = history;

    /**
     * SERVER-SENT EVENTS, not JSON.
     *
     * The turn takes as long as it takes; what changed is that the admin
     * sees the first words in a few hundred milliseconds instead of an orb
     * spinning until the last token lands. Nothing here is faster, it just
     * stops feeling like nothing is happening.
     *
     * SSE rather than a WebSocket: one direction, one request, and it
     * rides the same cookie auth as every other route. The socket server
     * is for broadcasts to every admin, which this is not.
     *
     * `X-Accel-Buffering` is for nginx, which otherwise buffers the whole
     * response and hands it over in one piece, which is exactly the
     * behaviour being removed.
     */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    /**
     * THE RESPONSE, NOT THE REQUEST.
     *
     * `req.on('close')` looks like "the admin closed the tab" and is not.
     * On Node 16+ the request stream emits `close` as soon as the request
     * is FULLY READ, which for a POST with a JSON body express has already
     * parsed means immediately — before runAgent has done anything.
     *
     * So `open` went false at once, every send() was skipped including the
     * final `done`, and the route returned a 200 text/event-stream with
     * ZERO frames after thinking for ten seconds. The client waits for a
     * `done` that never arrives, throws "The answer ended early", and
     * Diane apologises for a turn that actually succeeded.
     *
     * `res.on('close')` is the one that means what the old comment said:
     * the socket went away before the response finished.
     */
    let open = true;
    res.on('close', () => { open = false; });

    try {
      // ANOTHER WORKSPACE answers its own context (agent/workspaces.js);
      // the master sheet's is runAgent, as it always was.
      // eslint-disable-next-line global-require
      const elsewhere = require('./agent/workspaces').handlerFor(context);
      const result = elsewhere
        ? await elsewhere(trimmed, (e) => { if (open) send(e); })
        : await runAgent(trimmed, context, (e) => { if (open) send(e); });
      // The canonical reply, whole and post-processed. The client replaces
      // whatever it accumulated from tokens with this, so a cleaning pass
      // that shortened the text mid-stream cannot leave it out of step.
      if (open) send({ type: 'done', ...result });
    } catch (err) {
      // Already streaming, so the normal error middleware cannot help: the
      // status line went out with the 200. The failure travels as an event
      // and the client renders it exactly as it renders a thrown one.
      //
      // Same disclosure rule the error middleware applies: a 4xx message is
      // one we wrote (a rate limit, "send it in two halves") and is safe to
      // show; a 5xx is whatever the failing thing said and never reaches
      // the browser. runAgent has already captured the real cause to the
      // Logs page by this point.
      const status = err?.status ?? 500;
      logger.error({ err, status }, 'diane: turn failed mid-stream');
      if (open) {
        send({ type: 'error', status, message: status < 500 ? err.message : null });
      }
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

// The messy human-made sheet, uploaded straight into the CRM — replaces
// whatbot's upload-folder + month-start cron as the way a new sheet
// enters the system (user's own call: immediate visible feedback beats a
// silent scheduled job, and the folder route needed a human to place the
// file anyway, so it was never really automatic).
//
// 'import' semantics: the sheet wins on the columns it CARRIES, says
// nothing about the ones it doesn't, and deletes nothing at all. A zero-row
// parse is still refused outright — a file that reads as empty is a broken
// read, and letting it through would flag or blank real rows for nothing.
router.post('/master-sheet/import', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    try {
      if (!req.file) return next(new AppError(400, messages.noFile));

      // The groups already in the CRM, so a file with no Group column can
      // be matched against one rather than importing as UNKNOWN and
      // duplicating every deal it names. See masterSheet/groupFromFilename.
      const knownGroups = await repo.distinctGroups();
      const {
        rows, columns, stats, companies, hasCompanyTable,
      } = await parseMasterSheetImport(req.file.buffer, {
        filename: req.file.originalname,
        knownGroups,
      });
      if (rows.length === 0) {
        return next(
          new AppError(
            400,
            messages.parsedNothing,
          ),
        );
      }

      /**
       * ===============================
       * * TAKE THE RATES BACK OFF, AND ONLY WHERE THE FILE SAYS SO
       * ===============================
       * Our own export writes Maid's Monthly as 4,935: her 4,700 wage with
       * her 5% already inside it, and it prints "Maid: 5% add on" under an
       * "Add ons" heading to say so. Stored as the wage, the next export
       * would read 5,181.75 and the one after 5,440.84.
       *
       * HIS OWN SHEET DECLARES NOTHING and writes the raw wage, so nothing
       * comes off it. Reversing that was how 4,000 became 3,809.52. See
       * masterSheet/declaredRates.
       */
      const unrated = reverseRates(rows, await declaredRatesIn(req.file.buffer));

      const result = await repo.syncUpsert(unrated, 'import', { columns });
      broadcast(null, 'master-sheet:changed', { action: 'uploaded', ...result });
      res.json({ filename: req.file.originalname, ...stats, ...result });
    } catch (parseErr) {
      next(parseErr);
    }
  });
});

/**
 * WHAT THE FILE WOULD DO, without doing any of it.
 *
 * The first half of the upload. Parses, compares against what is stored,
 * and hands back a diff plus the parsed rows themselves. Writes nothing.
 *
 * The rows come back to the browser and go out again on /commit rather
 * than being cached server-side under a token: a cache is state that dies
 * on a restart and has to be expired, for a payload of about a hundred
 * rows that the client is holding anyway to render the diff.
 */
router.post('/master-sheet/import/preview', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));
    try {
      if (!req.file) return next(new AppError(400, messages.noFile));

      const knownGroups = await repo.distinctGroups();
      // `companies` and `hasCompanyTable` belong here too. Left out, the
      // company-tiers tab below threw "hasCompanyTable is not defined" and
      // took the whole preview down with it: no diff at all, for a fifth
      // tab that is optional.
      const {
        rows, columns, stats, companies, hasCompanyTable,
      } = await parseMasterSheetImport(req.file.buffer, {
        filename: req.file.originalname,
        knownGroups,
        // Typed in the diff and sent back with the same file. The preview
        // is re-run rather than patched, so what the modal shows is always
        // the same parse the commit will write: a default that changed a
        // group changes the row's identity, and half-applying that would
        // show a diff the write disagrees with.
        defaults: parseDefaults(req.body?.defaults),
        // A value typed on ONE card, keyed by the row position in the file.
        overrides: parseOverrides(req.body?.overrides),
      });
      if (rows.length === 0) {
        return next(
          new AppError(
            400,
            messages.parsedNothing,
          ),
        );
      }

      /**
       * ===============================
       * * THE RATES COME BACK OFF HERE, BEFORE THE DIFF IS BUILT
       * ===============================
       * Our export writes 4,935 for a 4,700 wage on 5%, and says so in its
       * own "Add ons" block. Compared raw against a stored 4,700 the diff
       * would show a change on every rated row, the admin would accept it,
       * and the next export would read 5,181.75.
       *
       * HIS SHEET DECLARES NOTHING, so his figures go in as he wrote them.
       * See masterSheet/declaredRates for how the two are told apart.
       *
       * Either way it happens on the way in, once, so the diff, the commit
       * and the change log all see the same figure.
       */
      const declared = await declaredRatesIn(req.file.buffer);
      const unrated = reverseRates(rows, declared);
      rows.splice(0, rows.length, ...unrated);

      const keys = rows.map((r) => r.syncKey);
      // WHICH GROUPS THIS FILE SPEAKS FOR. "Different deals" is scoped to
      // them, because a sheet covering INDIGO says nothing about NEXUS and
      // listing NEXUS's deals as missing invites deleting them.
      //
      // UNKNOWN IS NOT A GROUP. It is the parser saying it could not tell,
      // so scoping to it would answer a question nobody asked and hide the
      // rest. A file we cannot place falls back to no scoping, which is the
      // old behaviour and the conservative one: it shows more, not less.
      const fileGroups = [...new Set(
        rows.map((r) => r.groupName).filter((g) => g && String(g).toUpperCase() !== 'UNKNOWN'),
      )];
      const [existing, notInFile, allStored] = await Promise.all([
        repo.findBySyncKeys(keys, columns),
        repo.findNotInKeys(keys, { groups: fileGroups }),
        // For the rename check below. The whole sheet, because the OLD
        // name is by definition a group this file never mentions, so it is
        // outside every scope the diff already uses.
        repo.findAllRows(),
      ]);

      /**
       * ===============================
       * * IS THIS A RENAME RATHER THAN A NEW GROUP?
       * ===============================
       *
       * The group is inside the identity key, so renaming one makes every
       * row look new AND hides the old ones: "different deals" is scoped
       * to the groups the file speaks for, and the old name is not one of
       * them. Verified on the live sheet: 33 rows would import as new, the
       * 33 stored rows would appear nowhere, and both sets would count.
       *
       * It ASKS rather than deciding. A rename and a genuinely new group
       * cannot be told apart from the data, and both guesses are bad: one
       * doubles the money, the other rewrites a group nobody renamed.
       */
      const renames = renamedGroups(rows, allStored);

      // WHEN each claimed field was last touched by a person, and what it
      // was before. The diff marks those cells; these two facts are what
      // make the mark worth reading.
      const claims = await repo.claimedFieldEdits([...existing.values()].map((r) => r.id));

      const diff = buildImportDiff({
        rows,
        columns,
        existing,
        valuesOf: repo.upsertValuesByColumn,
        fieldFor: repo.FIELD_FOR_COLUMN,
        claims,
      });

      res.json({
        filename: req.file.originalname,
        ...stats,
        columns,
        rows,
        // Which columns can be filled in, so the modal offers exactly the
        // set the parser will honour rather than its own idea of it.
        defaultable: DEFAULTABLE,
        overrides: parseOverrides(req.body?.overrides),
        knownGroups,
        diff: { ...diff, notInFile },
        // ASKED, NEVER ACTED ON. Empty unless a stored group's roster has
        // turned up under a name the CRM has never seen.
        renames,
        // THE FIFTH TAB, only when the file actually carries the block.
        // No table means no tab, the same rule the delete tabs follow.
        companies: hasCompanyTable
          ? diffCompanies(companies, await companiesRepo.findAllPlain(), {
            ambiguous: await repo.companiesInSeveralGroups(),
          })
          : null,
      });
    } catch (parseErr) {
      next(parseErr);
    }
  });
});

/**
 * The second half: write only what was accepted.
 *
 * `accept` is a list of `{ syncKey, columns }`. Omitting `columns` means
 * every column the file may write; naming a subset is what "accept the end
 * dates but not the amounts" means, and it is honoured by grouping rows
 * with the same mask and running one upsert per group. In practice that is
 * one or two groups, so it stays one or two statements.
 *
 * A row not in the list is simply not written. That is the whole meaning
 * of rejecting a change: the CRM keeps what it has.
 */
router.post('/master-sheet/import/commit', async (req, res, next) => {
  try {
    const { rows, columns, accept, companies } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return next(new AppError(400, 'No rows to write.'));
    }
    if (!Array.isArray(accept)) {
      return next(new AppError(400, 'accept must be a list of rows to write.'));
    }

    /**
     * THIS ROUTE DELETES NOTHING. It once took a `deleteIds` list so that
     * cancelling the diff cancelled the deletions too, but that tied two
     * decisions to one button: removing six finished deals also wrote every
     * change the sheet proposed. Deleting from the diff now goes to
     * `/master-sheet/bulk-delete` with `via='import'` at the moment it is
     * confirmed. One act per button.
     *
     * A SECOND DELETE PATH IS NOT KEPT "just in case". Nothing calls it, and
     * a route that can still delete during a commit is exactly the thing the
     * split was meant to remove.
     */

    /**
     * NO EARLY RETURN ON AN EMPTY `accept`. It used to return here, which
     * skipped the company tiers below: rejecting every deal change and
     * accepting only the tiers reported success and wrote nothing at all.
     * The two are separate decisions on one screen, so an empty list of one
     * says nothing about the other.
     *
     * An empty accept is still not an error. Looking at a diff and deciding
     * none of the DEALS should land is a legitimate answer.
     */
    const allowed = Array.isArray(columns) && columns.length > 0 ? columns : null;
    const byKey = new Map(rows.map((r) => [r.syncKey, r]));

    // Grouped by which columns each accepted row allows, so a per-row mask
    // costs one statement per DISTINCT mask rather than one per row.
    const byMask = new Map();
    for (const entry of accept) {
      const row = byKey.get(entry?.syncKey);
      if (!row) continue;
      // The seeded columns ride along with any mask. They are kept out of
      // the diff, so nobody can tick them, and dropping them here would
      // make a display change quietly a storage one.
      // A ticked column brings its companions, so one cell is never half
      // written: the date kept and his note applied would put a pill over
      // a date. Intersected with `allowed`, which is what the FILE carried.
      const mask = Array.isArray(entry.columns) && entry.columns.length > 0
        ? withCompanions([...new Set([
          ...entry.columns.filter((c) => !allowed || allowed.includes(c)),
          ...(allowed ?? []).filter((c) => SEEDED_NOT_ASKED.has(c)),
        ])]).filter((c) => !allowed || allowed.includes(c))
        : allowed;
      const maskKey = mask ? [...mask].sort().join(',') : '*';
      if (!byMask.has(maskKey)) byMask.set(maskKey, { columns: mask, rows: [] });
      byMask.get(maskKey).rows.push(row);
    }

    let written = 0;
    let received = 0;
    for (const group of byMask.values()) {
      // THE GUARD IS OFF HERE, AND ONLY HERE. Every column in this mask was
      // ticked on the diff beside the value it replaces, so a claim that
      // overruled that would make the modal a suggestion box. Nothing
      // reaches this line that a person did not choose.
      const result = await repo.syncUpsert(group.rows, 'import', {
        columns: group.columns,
        respectOverrides: false,
      });
      written += result.written;
      received += result.received;
    }

    /**
     * ===============================
     * * Company tiers, accepted on the fifth tab
     * ===============================
     * Written HERE rather than on the click, unlike the delete tab: a tier
     * overwrites a value, deleting destroys a row, and only the second
     * earns its own act. The list arrives already resolved, so a flagged
     * row is either settled or simply absent.
     */
    let tiersWritten = 0;
    if (Array.isArray(companies) && companies.length > 0) {
      const pairs = companies
        .filter((c) => String(c?.company ?? '').trim())
        .map((c) => ({
          company: String(c.company).trim(),
          tier: String(c.tier ?? '').trim(),
          // Empty means the file never mentioned it, and setTiers keeps
          // whatever is stored rather than clearing it.
          oldGroup: String(c.oldGroup ?? '').trim(),
        }));
      if (pairs.length > 0) {
        await companiesRepo.setTiers(pairs);
        tiersWritten = pairs.length;
        broadcast(null, 'companies:changed', { action: 'tiers', count: tiersWritten });
      }
    }

    // No `notInFile` here on purpose. syncUpsert derives it from the rows
    // it was handed, and this hands it a SUBSET, so the number would be
    // wrong in exactly the case somebody rejected something. The preview
    // already reported it against the whole file.
    broadcast(null, 'master-sheet:changed', { action: 'uploaded', written });
    res.json({
      received, written, skipped: rows.length - received, tiersWritten,
    });
  } catch (err) {
    next(err);
  }
});

// Whether the frontend should even try server-side speech before falling
// back to SpeechSynthesis — one cheap check, not a failed POST every time
// the key just isn't set (the common case until it's actually configured).
// UNAVAILABLE, NEVER AN ERROR. A 500 here breaks the button instead of
// hiding it, and "we could not tell" and "not configured" mean the same
// thing to the caller: fall back to the browser.
// Whether Diane can think: a key, credit, a key the provider accepts. The page
// locks her button, her welcome and her suggestions on it. See agent/aiStatus.js.
router.get('/master-sheet/ai/status', async (req, res, next) => {
  try {
    res.json(await aiStatus());
  } catch (err) {
    next(err);
  }
});

router.get('/master-sheet/speech/status', (req, res) => {
  let available = false;
  try { available = isTtsConfigured(); } catch { available = false; }
  res.json({ available });
});

// Text -> real spoken audio, OpenAI's TTS — see masterSheet/agent/speech.js.
// Returns the raw mp3 bytes directly (not JSON+base64) so the frontend can
// hand the response straight to an <audio> element via a blob URL.
router.post('/master-sheet/speech', async (req, res, next) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return next(new AppError(400, 'text is required'));
    }
    const audio = await synthesizeSpeech(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    next(err.status ? new AppError(err.status, err.message) : err);
  }
});

// Voice INPUT. In memory and thrown away as soon as it's transcribed —
// a recording of someone talking about staff pay is not something to leave
// on disk, and there's nothing to gain by keeping it.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }, // both providers cap at 25MB; a spoken instruction is a few hundred KB
});

// MediaRecorder's mimeType -> a file extension the transcription API will
// accept. It picks its own container per browser (webm/opus on Chrome,
// mp4 on Safari), and the extension is how the decoder gets chosen, so
// guessing "webm" for everyone silently breaks Safari.
const AUDIO_EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  // Audio-only MP4 (Safari's recorder) is an m4a: sent as .mp4 the
  // transcription refused it as "Invalid file format". 2026-10-03.
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function extensionFor(mimetype = '') {
  const base = mimetype.split(';')[0].trim().toLowerCase(); // "audio/webm;codecs=opus"
  return AUDIO_EXTENSIONS[base] ?? 'webm';
}

// Same cheap availability check as speech/status above, so the mic button
// can be hidden when voice input isn't configured rather than failing on
// the first press.
router.get('/master-sheet/transcribe/status', (req, res) => {
  let available = false;
  try { available = isTranscribeConfigured(); } catch { available = false; }
  res.json({ available });
});

router.post('/master-sheet/transcribe', (req, res, next) => {
  audioUpload.single('audio')(req, res, async (uploadErr) => {
    if (uploadErr) return next(new AppError(400, uploadErr.message));
    if (!req.file) return next(new AppError(400, 'audio is required'));

    try {
      const text = await transcribeAudio(req.file.buffer, `speech.${extensionFor(req.file.mimetype)}`);
      // An empty transcript is a normal outcome, not a failure — someone
      // pressed the mic and said nothing, or the room was too quiet. The
      // frontend treats "" as "don't send anything", so this stays a 200.
      res.json({ text });
    } catch (err) {
      next(err.status ? new AppError(err.status, err.message) : err);
    }
  });
});

module.exports = { router };
