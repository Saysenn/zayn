import { env } from "./env.js";

/**
 * Our five WhatsApp numbers, one per group.
 *
 * Each one is a normal WhatsApp account on a SIM in a locked phone. The laptop
 * is linked to all five.
 *
 * Whichever number a message came in on tells us which group it belongs to.
 */
export const numbersConfig = {
  /**
   * E.164 -> groupId. Starts as .env's; whatsapp/registry.js replaces it with
   * the CRM's list (Settings → Whatbot) while running. The SAME Map object
   * throughout, so everything holding it sees the change.
   */
  numberToGroup: new Map(env.WHATSAPP_NUMBERS),

  /** the .env list as written, the fallback when the CRM never answered */
  fromEnv: env.WHATSAPP_NUMBERS,

  /** where the login sessions live. this folder IS the link — back it up. */
  authDir: env.WHATSAPP_AUTH_DIR,

  /** `qr` or `code`: how an unlinked number is linked. */
  linkWith: env.WHATSAPP_LINK_WITH,
};

/** the same map the other way round, kept in step by setNumbers() */
const groupToNumber = new Map(
  [...numbersConfig.numberToGroup].map(([number, groupId]) => [
    groupId,
    number,
  ]),
);

/** per group: `qr` or `code`, from the CRM. Unset = .env's WHATSAPP_LINK_WITH. */
const linkWithByGroup = new Map();

/**
 * THE NUMBERS NOW: [{ group, phone, linkWith? }]. Replaces both maps in place.
 */
export function setNumbers(entries) {
  numbersConfig.numberToGroup.clear();
  groupToNumber.clear();
  linkWithByGroup.clear();
  for (const { group, phone, linkWith } of entries) {
    numbersConfig.numberToGroup.set(phone, group);
    groupToNumber.set(group, phone);
    if (linkWith) linkWithByGroup.set(group, linkWith);
  }
}

export const linkWithFor = (groupId) =>
  linkWithByGroup.get(groupId) ?? numbersConfig.linkWith;

export const allGroups = () => [...groupToNumber.keys()];

/**
 * WhatsApp doesn't use phone numbers internally, it uses "JIDs":
 *   +447700900123  ->  447700900123@s.whatsapp.net
 *
 * Our code uses normal phone numbers everywhere. These two functions are the
 * only place we translate, so nothing else has to think about it.
 */
export const toJid = (e164) => `${e164.replace(/^\+/, "")}@s.whatsapp.net`;

/**
 * JID back to a phone number.
 *
 * Note the ":12" bit — that's a device number WhatsApp adds when someone
 * messages from their laptop rather than their phone. We strip it off,
 * otherwise the same person looks like two different senders and one of them
 * matches no employee at all.
 */
export const fromJid = (jid) => `+${jid.split("@")[0].split(":")[0]}`;

export function groupForNumber(e164) {
  return numbersConfig.numberToGroup.get(e164.trim());
}

export function numberForGroup(groupId) {
  return groupToNumber.get(groupId);
}
