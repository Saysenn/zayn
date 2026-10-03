/**
 * ***************************************************
 * * ONE QUESTION, IN ITS OWN BUBBLE, ANSWERED BY PRESSING
 * ***************************************************
 *
 * Two of these exist and they are the same shape, so they are one
 * component:
 *
 *   autoConfirm  "Want me to stop asking before changes like that one?"
 *                after a confirmation he actually gave.
 *   specialCase  "Should this one be paid this month anyway?" after a new
 *                deal, because that is the one thing about a new row that
 *                cannot be read off the row.
 *
 * TWO BUTTONS, NEVER A SENTENCE SHE HEARS. Answered by typing "yes", her
 * next turn would have to tell that yes apart from a yes to a write
 * waiting for one, which is the ambiguity `confirmReplay` exists to keep
 * out of writes. A button cannot be misheard, and it writes the answer
 * itself with no model in the way.
 *
 * IT SAYS WHAT IT WILL NOT DO. Both of these sound broader than they are,
 * and somebody agreeing has to know which half they are agreeing to.
 */
const OFFERS = {
  autoConfirm: {
    ask: 'Want me to stop asking before changes like that one?',
    why: 'One named deal or one person, and every change still shows in History. I will always '
      + 'ask before anything that deletes, stops or closes.',
    yes: 'Yes, stop asking',
    no: 'Keep asking',
    done: 'On. Change it whenever you like in Settings.',
    left: 'Left as it was. I will keep asking.',
  },
  specialCase: {
    ask: (o) => `Should ${o.who ?? 'this deal'} be paid this month anyway?`,
    why: 'A special case pays the whole month whatever the dates say. A deal added mid month '
      + 'very often owes nothing without it.',
    yes: 'Yes, pay this month',
    no: 'No, leave the dates',
    done: 'Done. It is a special case and will be paid this month.',
    left: 'Left alone. The dates decide it.',
  },
};

export default function TurnOffer({ offer, answered, onAnswer, disabled }) {
  const copy = OFFERS[offer?.kind];
  // A kind the web does not know is a bubble with no question in it, which
  // reads as a broken answer. Better to draw nothing.
  if (!copy) return null;
  const ask = typeof copy.ask === 'function' ? copy.ask(offer) : copy.ask;

  return (
    // FLAT like every card in the conversation, his call 2026-09-30. The two
    // buttons stay buttons: they are what you press.
    <div className="px-0.5">
      <p className="m-0 text-[12px] leading-snug text-white/85">{ask}</p>
      <p className="m-0 mt-1 text-[10px] leading-snug text-white/40">{copy.why}</p>

      {answered ? (
        <p className="m-0 mt-2 text-[11px] text-diane-signal">
          {answered === 'yes' ? copy.done : copy.left}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer?.('yes')}
            className="min-h-0 rounded-full border border-diane-signal/60 bg-diane-signal/15 px-3 py-1 text-[11px] font-semibold text-diane-signal hover:bg-diane-signal/25"
          >
            {copy.yes}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer?.('no')}
            className="min-h-0 rounded-full border border-diane-line/40 bg-transparent px-3 py-1 text-[11px] text-diane-dim hover:border-diane-line hover:text-white/80"
          >
            {copy.no}
          </button>
        </div>
      )}
    </div>
  );
}
