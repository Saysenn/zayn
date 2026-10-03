import { appendTurn, setPendingOffer } from "./memory.js";
import { choicesBlock, FIRST_NUMERAL } from "../tools/format/index.js";

/**
 * Saying a reply: remember the turn, and decide whether the menu goes under it.
 *
 * Pulled out of handleMessage because every branch there needed the same three
 * lines, and the orchestrator was carrying five closures before it got to any
 * actual decisions.
 */

export function replier(phone, incoming, history) {
  const lastReply =
    [...history].reverse().find((t) => t.role === "assistant")?.content ?? "";

  /**
   * The same three options under every single reply is what makes this feel
   * like a machine.
   *
   * So a menu is never shown twice in a row. The pending choices are still
   * stored either way, which means "yes" and "1" keep working — they just are
   * not being asked for again.
   */
  const menuJustShown = lastReply.includes(FIRST_NUMERAL);

  /**
   * ...but only when they are the SAME options.
   *
   * The rule above hid a menu whose third choice was "Have a person look at
   * it", because the reply before it happened to end in the general menu.
   * Somebody disputing their pay was shown two options they had already seen
   * and not the one they needed, and the choices were only stored, not
   * offered — so the way to reach a person was invisible unless you guessed
   * that "3" still worked.
   *
   * Repetition was always the thing worth avoiding, not menus. Different
   * options are new information and get shown.
   */
  const alreadyOffered = (offer) =>
    menuJustShown && offer.choices.every((c) => lastReply.includes(c.label));

  const say = async (reply) => {
    await appendTurn(phone, { role: "user", content: incoming });
    await appendTurn(phone, { role: "assistant", content: reply });
    return reply;
  };

  const withMenu = async (reply, offer) => {
    if (!offer || offer.choices.length === 0) return say(reply);
    // stored even when hidden, or "yes" and "1" stop working
    await setPendingOffer(phone, offer.choices);
    if (alreadyOffered(offer)) return say(reply);
    return say(
      `${reply}\n\n${choicesBlock(
        offer.prompt,
        offer.choices.map((c) => c.label),
      )}`,
    );
  };

  return { say, withMenu, lastReply, menuJustShown };
}
