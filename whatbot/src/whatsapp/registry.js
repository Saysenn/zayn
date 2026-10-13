import {
  allGroups,
  crmConfig,
  linkWithFor,
  numberForGroup,
  numbersConfig,
  setNumbers,
} from "../config/index.js";
import { crmConfigured } from "../system/crmClient.js";
import { logger } from "../system/logger.js";
import {
  connectGroup,
  disconnectGroup,
  linkStates,
  relinkGroup,
  whenLinkChanges,
} from "./connection.js";
import { readNumbers, saveNumbers } from "./numberCache.js";

/**
 * WHICH NUMBERS WE RUN, FROM THE CRM (Settings → Whatbot, migration 083).
 *
 * Every 10 seconds the worker tells the CRM how each number is doing (with
 * the QR or code while one waits for a scan) and gets the list back. A new
 * number connects, one switched off or removed disconnects, a Relink starts
 * a fresh link. No restart.
 *
 * THE CRM BEING DOWN CHANGES NOTHING: the last list stays, and linked
 * numbers keep their own link to WhatsApp. First start with no CRM: the
 * list saved in Redis, else .env's WHATSAPP_NUMBERS.
 */
const EVERY_MS = 10_000;

/** Relinks carried out, until the CRM has been told. group → relinkAt */
const relinksDone = new Map();
/** The relink each group last carried out, so one request is one relink. */
const relinksHandled = new Map();

const envEntries = () =>
  [...numbersConfig.fromEnv].map(([phone, group]) => ({ group, phone }));

const current = () =>
  allGroups().map((group) => ({
    group,
    phone: numberForGroup(group),
    linkWith: linkWithFor(group),
  }));

async function askCrm() {
  if (!crmConfigured()) return null;
  const groups = new Set(allGroups());
  const statuses = [...linkStates()]
    .filter(([group]) => groups.has(group))
    .map(([group, s]) => ({ group, ...s }));
  const done = [...relinksDone].map(([group, relinkAt]) => ({ group, relinkAt }));
  try {
    const res = await fetch(`${crmConfig.apiUrl}/api/v1/agent/whatbot-numbers/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": crmConfig.apiKey },
      body: JSON.stringify({ statuses, done, seed: envEntries() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "CRM number list not available, keeping ours");
      return null;
    }
    const body = await res.json();
    for (const d of done) relinksDone.delete(d.group);
    return Array.isArray(body?.numbers) ? body.numbers : null;
  } catch (err) {
    logger.debug({ err: err.message }, "CRM unreachable, keeping our number list");
    return null;
  }
}

const usable = (numbers) =>
  numbers
    .filter((n) => n.active && n.group && /^\+\d{7,15}$/.test(n.phone))
    .map(({ group, phone, linkWith }) => ({ group, phone, linkWith }));

/**
 * BEFORE THE FIRST CONNECT. The CRM's list, else the saved one, else .env's
 * (already loaded). Relinks wait for the loop, once the sockets exist.
 */
export async function loadNumbers() {
  const fromCrm = await askCrm();
  if (fromCrm) {
    const list = usable(fromCrm);
    setNumbers(list);
    await saveNumbers(list);
    logger.info({ groups: allGroups() }, "numbers from the CRM");
    return "crm";
  }
  const saved = await readNumbers();
  if (saved) {
    setNumbers(saved);
    logger.warn({ groups: allGroups() }, "CRM unreachable: numbers from the last list it gave");
    return "saved";
  }
  logger.warn({ groups: allGroups() }, "CRM unreachable and no saved list: numbers from .env");
  return "env";
}

/** One round: report, fetch, and make the running numbers match. */
export async function syncNumbers() {
  const fromCrm = await askCrm();
  if (!fromCrm) return;

  const before = new Map(current().map((n) => [n.group, n]));
  const wanted = usable(fromCrm);
  const after = new Map(wanted.map((n) => [n.group, n]));

  for (const group of before.keys()) {
    if (!after.has(group)) {
      logger.info({ group }, "number switched off or removed in the CRM: disconnecting");
      await disconnectGroup(group);
    }
  }

  setNumbers(wanted);
  await saveNumbers(wanted);

  for (const n of wanted) {
    const was = before.get(n.group);
    const relinkAt = fromCrm.find((x) => x.group === n.group)?.relinkAt;
    const asked = relinkAt && relinksHandled.get(n.group) !== relinkAt;

    if (asked || (was && was.phone !== n.phone)) {
      // A new number for the group is a new account: its old link is the old phone's.
      logger.warn({ group: n.group, phone: n.phone }, asked ? "relink asked in the CRM" : "group's number changed: relinking");
      await relinkGroup(n.group);
      if (asked) {
        relinksHandled.set(n.group, relinkAt);
        relinksDone.set(n.group, relinkAt);
      }
    } else if (!was) {
      logger.info({ group: n.group, phone: n.phone }, "new number in the CRM: connecting");
      await connectGroup(n.group);
    } else if (was.linkWith !== (n.linkWith ?? numbersConfig.linkWith)
      && linkStates().get(n.group)?.state !== "connected") {
      // QR ↔ code only matters while unlinked. A clean start: a half-done
      // pairing's credentials are refused by WhatsApp as "logged out".
      await relinkGroup(n.group);
    }
  }
}

let timer;
let running = false;
let soon;

async function tick() {
  if (running) return;
  running = true;
  try {
    await syncNumbers();
  } catch (err) {
    logger.error({ err }, "number sync failed");
  } finally {
    running = false;
  }
}

/** After the first connect: every 10 seconds, and within a second of a new QR. */
export function startNumberSync() {
  whenLinkChanges(() => {
    clearTimeout(soon);
    soon = setTimeout(() => void tick(), 1000);
    soon.unref();
  });
  timer = setInterval(() => void tick(), EVERY_MS);
  timer.unref();
}

export function stopNumberSync() {
  clearInterval(timer);
  clearTimeout(soon);
}
