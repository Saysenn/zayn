import { z } from "zod";

/**
 * The unit here is an ASSIGNMENT, not a person.
 *
 * One row of the master sheet says: this person holds this role on this
 * company, in this group, for this much. The same person appears on as many
 * rows as they hold assignments — Nathan is a mid on six companies across two
 * groups, and that is normal, not a duplicate.
 *
 * The same person can even hold the same role on the same company twice, with
 * different payable days. Those are two real payments, so the row's position in
 * the sheet is part of its identity — dedupe on company and role and you delete
 * somebody's wages.
 */

/**
 * Roles, normalised.
 *
 * The sheet writes one role several ways — `Mid`, `Mid 1`, `Mid 2`, and
 * `Director` / `Director 1` / `Director 2` — plus typos (`Supprt`, `Closure`,
 * `Differnce`). The seat number splits off into `seat`, so "the mids on this
 * company" is one filter rather than four.
 *
 * `other` is deliberate. The sheet grows new role names whenever the business
 * does, and a row with an unrecognised role is still a real payment — rejecting
 * it would quietly drop money out of a total.
 */
export const ROLES = [
  "director",
  "mid",
  "admin",
  "tech",
  "closer",
  "visa",
  "kp",
  "sales",
  "support",
  "holding",
  "loss_lead",
  "graphics",
  "accounts",
  "maid",
  "other",
];

/** Who outranks whom on a company, for sorting a breakdown. Directors above mids. */
export const RANK = {
  director: 3,
  mid: 2,
  kp: 2,
  admin: 1,
  accounts: 1,
  tech: 1,
  closer: 1,
  visa: 1,
  sales: 1,
  support: 1,
  holding: 1,
  loss_lead: 1,
  graphics: 1,
  maid: 1,
  other: 0,
};

/** `Bank Transfer` and `Bank` are the same thing. Cash and crypto carry extra reporting duties. */
export const PAYMENT_METHODS = ["cash", "bank", "crypto"];

/** The sheet writes `EURO` and `Euro` for the same currency. Normalised on the way in. */
export const CURRENCIES = ["GBP", "AED", "EUR", "USD"];

/** "2026-07-01", or null where the sheet leaves it blank. Never a Date — these get JSON'd into Redis. */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .nullable()
  .default(null);

/**  add a column? add the colummn value declartion */
export const AssignmentSchema = z.object({
  /**
   * Derived, because the sheet has no IDs: group|company|role|seat|person|row.
   *
   * The row number is in there on purpose. One person legitimately holds the
   * same role on the same company twice with different payable days, and
   * without the row number those two collapse into one.
   */
  assignmentId: z.string().min(1),

  /**
   * Derived from the name, and the reason a person can be messaged once about
   * six companies instead of six times. The sheet has no employee IDs, so the
   * name IS the identity — which is why two different humans must never be
   * given the same name in it.
   */
  personId: z.string().min(1),
  personName: z.string().min(1),

  /**
   * Their WhatsApp number, E.164. Empty until the sheet carries phone numbers.
   *
   * An assignment with no phone still counts in every total — it just cannot
   * be identified from an incoming message, and is never messaged.
   */
  phone: z
    .string()
    .regex(/^(\+[1-9]\d{7,14})?$/, "must be E.164 or empty")
    .default(""),

  role: z.enum(ROLES),
  /** `Mid 2` -> 2. null where the sheet just says `Mid`. */
  seat: z.number().int().positive().nullable().default(null),
  /** exactly as the sheet writes it, for display: "Mid 1", "Visa co D" */
  roleLabel: z.string().min(1),

  /** MILKMAN, INDIGO, NEXUS, MANBAT, ALL BOOKS, TAKEOFF */
  group: z.string().min(1),
  /**
   * The company this assignment is on.
   *
   * null on the ALL BOOKS and TAKEOFF rows, which are paid against the group
   * itself. Those are real payments and must still total.
   */
  company: z.string().nullable().default(null),

  assignedOn: IsoDate,
  paymentStartOn: IsoDate,
  presetOn: IsoDate,
  endOn: IsoDate,

  /** out of the month. 0 means nothing owed this month — not the same as inactive. */
  payableDays: z.number().int().min(0).max(31).default(0),
  /** the full-month rate */
  monthlyAmount: z.number().nonnegative().default(0),
  /** what is actually owed this month: monthlyAmount pro-rated by payableDays */
  payableAmount: z.number().nonnegative().default(0),

  currency: z.enum(CURRENCIES).default("GBP"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  location: z.string().default(""),

  /**
   * The "tech" template's newer columns — carried through as free text,
   * unused by any conversational logic here. Their only job is to survive
   * the sheet -> CRM sync/calculator handoff, not to be parsed the way
   * dates or money are.
   */
  postcode: z.string().default(""),
  label: z.string().default(""),
  shouldBePaid: z.string().default(""),
  paid: z.string().default(""),
  notes: z.string().default(""),
  bankDetails: z.string().default(""),

  /** `ended` once the end date has passed. Ended assignments still appear in history. */
  status: z.enum(["active", "ended"]).default("active"),
});

/**
 * One human, and everything they hold.
 *
 * Built by grouping assignments, never stored separately, so it cannot drift
 * from the sheet.
 */

/**
 * Who is asking, which of our numbers they used, and what they may read.
 *
 * Built once per message from their verified WhatsApp number. Never from
 * anything they typed, and never from anything the LLM says.
 *
 * Passed into every tool. That is why no tool takes a "who am I" argument — if
 * it did, the LLM could pass someone else's.
 */
