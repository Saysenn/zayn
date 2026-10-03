import * as repo from "./storage.js";
import { RANK } from "./types.js";

/**
 * Whose assignments this person may read.
 *
 * Their own, and nobody else's. Worked out here, before the LLM is involved at
 * all — nothing the user types and nothing the LLM says can widen it.
 *
 * It returns a set rather than a string because widening it later (a director
 * seeing everyone on their companies) should change this function and nothing
 * that reads it.
 */
export function resolveScope(me) {
  return new Set([me.personId]);
}

/**
 * Phone number in, identity out.
 *
 * This is where "who is talking to us" gets decided — from their verified
 * WhatsApp number, never from anything they typed.
 *
 * null means the number matches nobody holding an active assignment. Refuse.
 * Never guess.
 */
export async function identify(phone, channelGroup) {
  const me = await repo.findByPhone(phone);
  if (!me) return null;
  if (!me.assignments.some((a) => a.status === "active")) return null;

  return { person: me, channelGroup, scope: resolveScope(me) };
}

/** "Milk Man", "milkman" and "MILK-MAN" all end up the same */
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Match a company name loosely.
 *
 * An exact compare returns nothing, and "nothing" reads to the user as "you
 * have no companies there" — a wrong answer, not an empty one.
 *
 * So: normalise first, then fall back to a substring, so "imperium" finds
 * "Imperium Resourcing PR". Ambiguous matches are refused rather than guessed.
 */
export function matchCompany(available, requested) {
  const want = normalize(requested);
  if (!want) return null;

  const exact = available.find((c) => normalize(c) === want);
  if (exact) return exact;

  const partial = available.filter((c) => normalize(c).includes(want));
  return partial.length === 1 ? partial[0] : null;
}

/**
 * What this caller may read, on this thread.
 *
 * TWO boundaries, and both matter:
 *   scope         — whose rows. Their own.
 *   channelGroup  — which group's rows, decided by the number they messaged.
 *
 * Somebody working across Milkman and Indigo holds two conversations, one per
 * number, and neither may show the other's companies. Drop the group filter and
 * a mid sees companies that have nothing to do with the thread they are in.
 */
export async function readable(ctx, company) {
  const all = await repo.findAll();
  const mine = all.filter(
    (a) =>
      ctx.scope.has(a.personId) &&
      a.group === ctx.channelGroup &&
      a.status === "active",
  );

  if (!company) return sorted(mine);

  const resolved = matchCompany(companiesOf(mine), company);
  if (!resolved) return [];

  return sorted(mine.filter((a) => a.company === resolved));
}

/** which companies this caller has on this thread */
export async function companiesInScope(ctx) {
  return companiesOf(await readable(ctx));
}

/** which groups this person appears in at all — one message goes out per group */
export function groupsOf(assignments) {
  return [...new Set(assignments.map((a) => a.group))].sort();
}

const companiesOf = (rows) =>
  [...new Set(rows.map((a) => a.company).filter((c) => c !== null))].sort();

/** seniority first, then company, so a breakdown reads the way an org chart does */
const sorted = (rows) =>
  [...rows].sort(
    (a, b) =>
      RANK[b.role] - RANK[a.role] ||
      (a.company ?? "").localeCompare(b.company ?? "") ||
      (a.seat ?? 0) - (b.seat ?? 0),
  );
