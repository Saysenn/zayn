import { AssignmentSchema } from "../employee/types.js";

/**
 * Master sheet columns -> our fields. Case, spaces, punctuation and the
 * trailing colons HR types don't matter.
 * rename column? edit also here
 * added column? add also here first
 */
const COLUMN_MAP = {
  role: "roleLabel",
  group: "group",
  // the stable identity, once payroll adds it. Several spellings because
  // whoever adds the column will not ask which one we expected.
  id: "personRef",
  employeeid: "personRef",
  staffid: "personRef",
  payrollid: "personRef",
  personid: "personRef",
  personalid: "personRef",
  nameofindividual: "personName",
  name: "personName",
  companyinquestion: "company",
  company: "company",
  appointmentdate: "assignedOn",
  paymentstartdate: "paymentStartOn",
  presetdate: "presetOn",
  enddate: "endOn",
  // the newer "tech" template's own name for the same column
  provisionalpaymentenddate: "endOn",
  payabledaysthismonth: "payableDays",
  payabledays: "payableDays",
  methodofpayment: "paymentMethod",
  paymentmethod: "paymentMethod",
  monthlyamount: "monthlyAmount",
  payableamount: "payableAmount",
  currency: "currency",
  location: "location",
  phone: "phone",
  whatsapp: "phone",
  phonenumber: "phone",
  postcode: "postcode",
  label: "label",
  // the sheet's own header has a typo ("shoukd") — matched as typed, plus
  // the correctly-spelled form in case the boss's sheet fixes it
  shoukdbepaidornot: "shouldBePaid",
  shouldbepaidornot: "shouldBePaid",
  paid: "paid",
  notes: "notes",
  bankdetailsofindividual: "bankDetails",
};

/** the sheet's own working columns — present, always blank, never ours */
const IGNORED = new Set([
  "activecompanylist",
  "director",
  "mid",
  "status",
  "oldgroup",
]);

const normalizeHeader = (h) => h.toLowerCase().replace(/[\s_:.-]/g, "");

/**
 * "Mid 2" -> mid + seat 2. "Director" -> director + no seat.
 *
 * Typos are mapped rather than rejected. `Supprt` and `Closure` are somebody
 * typing quickly, not a new kind of job, and a rejected row is money missing
 * from a total.
 */
export function parseRole(raw) {
  const cleaned = raw.trim().toLowerCase();
  const seatMatch = cleaned.match(/\s(\d+)\s*$/);
  const seat = seatMatch?.[1] ? Number(seatMatch[1]) : null;
  const base = cleaned.replace(/\s\d+\s*$/, "").trim();

  const ALIASES = {
    director: "director",
    mid: "mid",
    admin: "admin",
    "admin source": "admin",
    tech: "tech",
    techy: "tech",
    closer: "closer",
    closure: "closer",
    visa: "visa",
    "visa co d": "visa",
    "visa co mid": "visa",
    kp: "kp",
    sales: "sales",
    support: "support",
    supprt: "support",
    holding: "holding",
    "loss lead": "loss_lead",
    graphics: "graphics",
    accounts: "accounts",
    maid: "maid",
  };

  // an unknown role is still a real payment — `other` keeps it in the totals
  return { role: ALIASES[base] ?? "other", seat };
}

/** `Bank Transfer`, `Bank`, and the single stray `C` all resolve here. */
function parsePaymentMethod(raw) {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("bank")) return "bank";
  if (v.startsWith("crypto")) return "crypto";
  if (v.startsWith("c")) return "cash"; // covers `Cash` and the truncated `C`
  return null;
}

/** `EURO`, `Euro` and `euro` are one currency. Anything unrecognised stays unrecognised. */
function parseCurrency(raw) {
  const v = raw.trim().toUpperCase();
  if (v === "EURO" || v === "€") return "EUR";
  return v || "GBP";
}

/** "£2,500.00" -> 2500. Blank -> null, which is different from zero. */
function parseMoney(raw) {
  const cleaned = raw.replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A date at or around the Unix epoch is not a date somebody typed.
 *
 * It is what a spreadsheet formula produces when it has never been
 * calculated: `=E61+90` saved with no cached result comes back as
 * 1969-12-31 or 1970-01-01, depending on the timezone the file was written
 * in. ExcelJS never evaluates formulas, it only reads the result Excel last
 * stored, so a sheet saved by anything other than Excel arrives full of
 * these.
 *
 * Left alone, that is silent and severe: an end date of 1969 makes every
 * such row `ended`, which drops those people from the payday check AND from
 * the phone index, so they cannot use the bot at all and nothing anywhere
 * says why. Treating it as "no date recorded" is both truer and safer — the
 * same answer a blank cell gets.
 *
 * 1971 rather than exactly the epoch, so a timezone shift either side of it
 * cannot slip through. No real payroll date predates it.
 */
const EPOCH_CUTOFF = "1971-01-01";

/**
 * Excel hands dates over in several shapes depending on how the cell was typed.
 * Everything becomes "YYYY-MM-DD" or null — no Date objects, because these get
 * JSON'd into Redis and come back as strings anyway.
 */
function parseDate(raw) {
  const v = raw.trim();
  if (!v) return null;

  const out = toIsoDay(v);
  return out && out >= EPOCH_CUTOFF ? out : null;
}

function toIsoDay(v) {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy)
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

/** "07911 123456" / "447911123456" -> "+447911123456" */
export function normalizePhone(raw, defaultCountry = "44") {
  const e164 = /^\+[1-9]\d{7,14}$/;
  let d = raw.replace(/[^\d+]/g, "");

  // written properly: any country, spaces and brackets already stripped
  if (d.startsWith("+")) return e164.test(d) ? d : null;

  d = d.replace(/\D/g, "");
  if (!d) return null;

  // 00 is the international prefix, so what follows is a country code
  if (d.startsWith("00")) {
    const intl = `+${d.slice(2)}`;
    return e164.test(intl) ? intl : null;
  }

  /**
   * No plus, no 00. Only a UK number can be assumed from here.
   *
   * Gluing the default country onto anything unrecognised turned a real UAE
   * number, 971501234567, into +44971501234567 — a number we do not own,
   * belonging to somebody who has never heard of us. The payday check SENDS to
   * numbers off this sheet, so that is a message about a stranger's wages
   * going to a stranger, and it is how these accounts get reported.
   *
   * A missing phone is safe: that person cannot use the bot until somebody
   * fixes the row. A confidently wrong one is not.
   */
  const ukLocal = /^0\d{9,10}$/.test(d); // 07353839670
  const ukMobile = /^7\d{9}$/.test(d); //   7353839670, the 0 dropped by Excel
  const ukFull = new RegExp(`^${defaultCountry}\\d{9,10}$`).test(d); // 447353839670

  if (ukLocal) d = defaultCountry + d.slice(1);
  else if (ukMobile) d = defaultCountry + d;
  else if (!ukFull) return null; // ambiguous — refuse rather than guess a country

  const out = `+${d}`;
  return e164.test(out) ? out : null;
}

/**
 * "Nathan" -> "nathan". The sheet has no employee IDs, so the name is the
 * identity — which is exactly why two different people must never share one.
 */
export const personIdOf = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/ /g, "-");

/**
 * The sheet's own ID, normalised. "EMP 001", "emp-001" and "EMP001" are one
 * person — trailing spaces and casing are typing, not identity.
 */
export const refIdOf = (ref) =>
  ref
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** the sheet's own `Location` column carries "Bank Transfer" on director rows */
const PAYMENT_WORDS = /^(bank transfer|bank|cash|crypto)$/i;

/** we need to see at least these before a row is worth reading */
const REQUIRED = ["role", "nameofindividual", "name"];

/** one table found on a sheet: its header row, and the columns it spans */

/**
 * A blank column INSIDE a table is normal — the master sheet has one between
 * `Location:` and the working columns. Two together is somebody separating one
 * table from the next.
 */
const GAP = 2;

/** runs of non-blank cells in a row, split on GAP or more blank columns */
function segments(cells) {
  const runs = [];
  let from = -1;
  let blanks = 0;

  for (let c = 0; c < cells.length; c++) {
    if (cells[c]) {
      if (from === -1) from = c;
      blanks = 0;
    } else if (from !== -1) {
      blanks++;
      if (blanks >= GAP) {
        runs.push([from, c - blanks]);
        from = -1;
        blanks = 0;
      }
    }
  }
  if (from !== -1) runs.push([from, cells.length - 1 - blanks]);
  return runs;
}

/** enough recognised columns, and something to identify a person by */
function looksLikeHeader(cells) {
  const known = cells.filter((c) => c in COLUMN_MAP).length;
  return known >= 3 && cells.some((c) => REQUIRED.includes(c));
}

const overlap = (a, b) => a.firstCol <= b.lastCol && b.firstCol <= a.lastCol;

/**
 * Every table on the sheet, wherever it sits.
 *
 * Scans EVERY row, not the first ten, and splits each candidate into column
 * runs — so tables stacked down the page and tables sat side by side are both
 * found. A table runs until the next header sharing any of its columns, which
 * is what stops the one above swallowing the one below.
 *
 * This replaces `findHeaderRow`: first ten rows, one header, everything after
 * it parsed with those columns. A table starting at row 15 was read as nothing
 * at all, and nothing said so.
 */
export function findTables(rows) {
  const found = [];

  for (let r = 0; r < rows.length; r++) {
    const cells = (rows[r] ?? []).map(normalizeHeader);
    for (const [firstCol, lastCol] of segments(cells)) {
      if (looksLikeHeader(cells.slice(firstCol, lastCol + 1))) {
        found.push({
          headerRow: r,
          firstCol,
          lastCol,
          lastRow: rows.length - 1,
        });
      }
    }
  }

  // a table stops where the next one sharing its columns begins
  for (const t of found) {
    const next = found
      .filter((o) => o.headerRow > t.headerRow && overlap(o, t))
      .map((o) => o.headerRow)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) t.lastRow = next - 1;
  }

  return found;
}

/** kept for callers that only want where the first table starts */
export function findHeaderRow(rows) {
  return findTables(rows)[0]?.headerRow ?? 0;
}

/**
 * What a field becomes in lenient mode when the schema refuses its real
 * value. Every one of these is a "we could not read this" marker, not a
 * guess at what was meant — an unreadable phone becomes no phone, never a
 * nearby number; an unknown currency becomes the default, flagged, for a
 * human to correct in the CRM rather than silently paid in the wrong one.
 */
const LENIENT_FALLBACKS = {
  phone: "",
  currency: "GBP",
  paymentMethod: "cash",
  role: "other",
  group: "UNKNOWN",
  payableDays: 0,
  monthlyAmount: 0,
  payableAmount: 0,
  status: "active",
  location: "",
  postcode: "",
  label: "",
  shouldBePaid: "",
  paid: "",
  notes: "",
  bankDetails: "",
};

/**
 * Blanks out only the fields the schema actually complained about, then
 * re-checks. Anything still failing after that genuinely cannot be made
 * into an assignment and is rejected as before.
 */
function coerceForReview(raw, issues) {
  const fixed = { ...raw };
  for (const issue of issues) {
    const key = issue.path[0];
    if (key in LENIENT_FALLBACKS) fixed[key] = LENIENT_FALLBACKS[key];
  }
  return AssignmentSchema.safeParse(fixed);
}

/**
 * Rows in, checked assignments out.
 *
 * Bad rows are rejected and reported, never quietly repaired into something
 * that looks about right — that is how a wrong number reaches somebody's
 * WhatsApp. The exceptions are spelling and formatting (`Supprt`, `EURO`,
 * trailing spaces), which are typing, not data.
 *
 * `lenient` flips that for ONE caller: the CRM master-sheet push
 * (sheet/syncMasterSheet.js). There, the human sheet has to arrive AS-IS —
 * duplicates, half-filled rows, unreadable currencies and all — because the
 * CRM's Master Sheet page is exactly where a person cleans it up, and a row
 * silently dropped here is a person who never gets cleaned up because
 * nobody knows they're missing. Those rows come back carrying
 * `needsReview` and `reviewReason` so the CRM can ask about them.
 *
 * The strict default stays the default on purpose. Redis feeds real answers
 * to real people over WhatsApp; the CRM feeds a human reviewing a table.
 * Same parse, two destinations, two standards — never lenient for Redis.
 */
export function parseRows(rows, defaultGroup, { lenient = false } = {}) {
  const assignments = [];
  const rejected = [];
  const mismatched = [];

  const tables = findTables(rows);

  /**
   * Nothing recognisable on the sheet.
   *
   * Said out loud, because the old behaviour fell back to row 0, read a title
   * as a header, produced no assignments and reported success. A whole tab
   * going missing should never be quiet.
   */
  if (tables.length === 0) {
    return {
      assignments,
      rejected: [
        {
          row: 0,
          reason:
            "no table found on this sheet — a header row needs at least 3 recognised columns and a name column",
        },
      ],
      mismatched,
    };
  }

  for (const table of tables) {
    const headers = (rows[table.headerRow] ?? [])
      .slice(table.firstCol, table.lastCol + 1)
      .map(normalizeHeader);

    for (let i = table.headerRow + 1; i <= table.lastRow; i++) {
      const full = rows[i];
      if (!full) continue;
      const row = full.slice(table.firstCol, table.lastCol + 1);
      if (row.every((c) => !c?.trim())) continue; // blank/spacer row

      const raw = {};

      headers.forEach((header, col) => {
        if (IGNORED.has(header)) return;
        const field = COLUMN_MAP[header];
        if (!field) return;
        const value = (row[col] ?? "").trim();

        switch (field) {
          case "payableDays":
            raw.payableDays = Math.max(
              0,
              Math.min(31, Math.round(parseMoney(value) ?? 0)),
            );
            break;
          case "monthlyAmount":
          case "payableAmount":
            raw[field] = parseMoney(value) ?? 0;
            break;
          case "assignedOn":
          case "paymentStartOn":
          case "presetOn":
          case "endOn":
            raw[field] = parseDate(value);
            break;
          case "paymentMethod":
            raw.paymentMethod = parsePaymentMethod(value) ?? "cash";
            break;
          case "currency":
            raw.currency = parseCurrency(value);
            break;
          case "phone":
            raw.phone = normalizePhone(value) ?? "";
            break;
          case "company":
            raw.company = value || null;
            break;
          case "location":
            // the payment method leaked one column across on every director row.
            // keeping it would print "Location: Bank Transfer" on a real message.
            raw.location = PAYMENT_WORDS.test(value) ? "" : value;
            break;
          default:
            raw[field] = value;
        }
      });

      // HR repeats the header row halfway down. it parses as a payment to
      // somebody called "Name of individual".
      if (normalizeHeader(String(raw.personName ?? "")) === "nameofindividual")
        continue;

      const personName = String(raw.personName ?? "").trim();
      const roleLabel = String(raw.roleLabel ?? "").trim();
      if (!personName || !roleLabel) continue; // spacer or subtotal line

      if (!raw.group && defaultGroup) raw.group = defaultGroup;

      /**
       * The group, upper-cased, because a group name is an identifier here and
       * not prose.
       *
       * WHATSAPP_NUMBERS is keyed "MILKMAN" and the sheet writes "Milkman", and
       * every group comparison in this codebase is an exact string match:
       * numberForGroup(), access.readable()'s scoping, crmClient's assignment
       * filter, the payday check. So the sheet's own capitalisation silently
       * excluded a whole group from all of them — "groups with no WhatsApp
       * number" for a group whose number is right there in the config.
       *
       * Upper rather than lower because that is what the rest of the system
       * already agreed on: the env keys, the CRM's group_name, and this repo's
       * own tests all say MILKMAN. Display capitalisation is groupName()'s job
       * in tools/format, applied when a person reads it, not when it is stored.
       */
      raw.group = String(raw.group ?? "").trim().toUpperCase();

      const { role, seat } = parseRole(roleLabel);
      raw.role = role;
      raw.seat = seat;
      raw.personName = personName;
      raw.roleLabel = roleLabel;
      /**
       * The identity, and the single most important field on the row.
       *
       * Prefer the sheet's own ID. Falling back to the name is what we had, and
       * it silently merges two different humans who happen to share one — which
       * means one of them reads the other's wages. Once every row carries an ID
       * that stops being possible.
       */
      const personRef = String(raw.personRef ?? "").trim();
      raw.personId = personRef ? refIdOf(personRef) : personIdOf(personName);
      delete raw.personRef;
      raw.status =
        raw.endOn && String(raw.endOn) < new Date().toISOString().slice(0, 10)
          ? "ended"
          : "active";

      // the row number is part of the ID on purpose: one person legitimately
      // holds the same role on the same company twice, with different payable
      // days. Dedupe those and somebody loses a month's pay.
      // the COLUMN is in there too, or two tables side by side would give
      // their matching rows one id and the second would overwrite the first.
      raw.assignmentId = [
        raw.group,
        raw.company ?? "-",
        role,
        seat ?? "-",
        raw.personId,
        `${i + 1}c${table.firstCol}`,
      ]
        .join("|")
        .toLowerCase();

      // The sheet states both the monthly rate and what is payable, and they can
      // disagree — a rate changed mid-month, or somebody typed over a formula.
      //
      // We keep the row and use the stated PAYABLE, because that column is what
      // payroll actually pays; the monthly figure is the rate behind it. Dropping
      // the row instead would silently delete a real payment from every total,
      // and a missing payment is far harder to notice than a surprising one.
      //
      // It is reported so somebody fixes the sheet.
      const monthly = Number(raw.monthlyAmount ?? 0);
      const payable = Number(raw.payableAmount ?? 0);
      const days = Number(raw.payableDays ?? 0);
      if (monthly > 0 && days > 0) {
        const expected = (monthly * days) / 31;
        if (Math.abs(expected - payable) > 0.02) {
          mismatched.push({
            row: i + 1,
            reason: `payable ${payable} does not match ${monthly} x ${days}/31 = ${expected.toFixed(2)} — using the stated payable`,
          });
        }
      }

      const parsed = AssignmentSchema.safeParse(raw);
      if (parsed.success) {
        assignments.push(parsed.data);
        continue;
      }

      const reason = parsed.error.issues
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; ");

      // Strict: the row is missing from every total, loudly.
      if (!lenient) {
        rejected.push({ row: i + 1, reason });
        continue;
      }

      // Lenient: keep the person, mark what could not be read. Still
      // rejected if even the blanked-out version cannot be an assignment —
      // at that point there is no row to hand anybody.
      const repaired = coerceForReview(raw, parsed.error.issues);
      if (!repaired.success) {
        rejected.push({ row: i + 1, reason });
        continue;
      }
      assignments.push({
        ...repaired.data,
        needsReview: true,
        reviewReason: `row ${i + 1} — ${reason}`,
      });
    }
  }

  /**
   * Two humans sharing one name.
   *
   * Until every row carries an ID, the name IS the identity, so two different
   * people called the same thing become one person who can read both their pay
   * packets. That is a privacy incident, not a tidiness problem, and nothing
   * else in the system can see it happening.
   *
   * Different phone numbers under one name is the strongest signal we have.
   */
  const phonesByName = new Map();
  for (const a of assignments) {
    if (!a.phone) continue;
    phonesByName.set(
      a.personId,
      (phonesByName.get(a.personId) ?? new Set()).add(a.phone),
    );
  }
  for (const [personId, phones] of phonesByName) {
    if (phones.size > 1) {
      rejected.push({
        row: 0,
        reason: `"${personId}" has ${phones.size} different phone numbers — two people may share one name. Give them separate IDs before anybody messages in.`,
      });
    }
  }

  return { assignments, rejected, mismatched };
}
