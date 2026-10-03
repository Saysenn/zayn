import Button from '../buttons/Button';
import CellInfo from '../display/CellInfo';
import { SparkleIcon } from '../icons';
// The rule itself, in a plain module so its test can import it rather than
// restate it. It lived in here and the test mirrored it, which left the
// mirror green while the component was broken.
import { fillableFrom } from '../../helpers/personFill';

/**
 * ***************************************************
 * * FILL A DEAL'S BLANKS FROM ONE THIS PERSON ALREADY HOLDS
 * ***************************************************
 *
 * His call 2026-09-23. A handler's phone, address and bank details are
 * facts about the PERSON, so every deal they hold carries the same eight
 * columns and one of them is usually the most complete. Typing them again
 * is how a postcode ends up on one row and not the other.
 *
 * TWO OFFERS, AND THEY ANSWER DIFFERENT QUESTIONS. A live deal is what the
 * person looks like now. An archived one is the last thing anybody knew,
 * which is the only answer left for somebody whose other deals have all
 * ended, and it says so on the button rather than being quietly mixed in.
 *
 * ===============================
 * * PERSON FACTS ONLY, AND BLANKS ONLY
 * ===============================
 * Not the monthly amount, not the method, not the dates: 20 of the 28
 * multi-handler companies pay their handlers different negotiated amounts,
 * so a copied wage is silently wrong on the row nobody re-reads. Which
 * columns count is the SERVER's list, `PERSON_FILL_COLUMNS`; this offers
 * back whatever it was handed.
 *
 * Nothing already filled is touched, so accepting is never something to
 * undo. An offer that could overwrite would have to be read before it was
 * accepted, and then it saves nobody anything.
 *
 * IT OFFERS NOTHING WHEN IT WOULD FILL NOTHING. A button that does not
 * move the form is a button somebody presses twice wondering why.
 */

function Offer({ said, candidate, form, onFill, busy }) {
  const fills = fillableFrom(candidate, form);
  const keys = Object.keys(fills);
  if (keys.length === 0) return null;

  const where = [candidate.company, candidate.groupName].filter(Boolean).join(', ');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface-sunken px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>
          {said}
          {where ? <span className="text-text-faint"> · {where}</span> : null}
        </span>
        {/* WHICH FIELDS, behind the icon rather than on the line. The
            count is what decides whether to press it; the names are what
            you check afterwards, and they are already visible in the form
            the moment it fills. */}
        <CellInfo
          label="What this would fill"
          body={[
            `${keys.length} empty ${keys.length === 1 ? 'field' : 'fields'} would be filled, and nothing you have already typed is touched.`,
            keys.map((k) => `**${k}**: ${fills[k]}`).join('\n'),
          ]}
        />
      </p>
      {/* ===============================
          * IT IS HER OFFER, AND IT LOOKS LIKE ONE
          ===============================
          Her sparkle, her colour turning the border, and it breathes. The
          class is `diane-offer` in index.css; motion comes off entirely
          under prefers-reduced-motion and the border stays hers.

          `xs`, because it sits inside a dialog beside the real Save. An
          offer that competes with the button that commits the form is an
          offer somebody presses by mistake. */}
      <Button
        size="xs"
        // `diane-skin` carries her four colours, the same ones Ask Diane
        // reads; `diane-offer` is the glow over them. Two classes because
        // they are two decisions: what she looks like, and that this one
        // is an offer rather than a control.
        // 12px and 8px, his call 2026-09-23. `!` and `h-auto` because the
        // size token sets a fixed h-6 with its own px/py, and two
        // conflicting utilities in one layer resolve by whichever Tailwind
        // emitted last rather than by the order they are written here.
        className="diane-skin diane-offer gap-1.5 font-semibold !h-auto !py-3 !px-2"
        disabled={busy}
        onClick={() => onFill(fills)}
      >
        <SparkleIcon width={12} height={12} />
        Fill {keys.length} {keys.length === 1 ? 'blank' : 'blanks'}
      </Button>
    </div>
  );
}

/**
 * @param {object} data      `{ live, archive }` from usePersonFill
 * @param {object} form      the form as it stands, so only blanks are offered
 * @param {Function} onFill  handed the fields to merge, never the whole row
 */
/**
 * ===============================
 * * SHE SAYS IT, SO IT IS WRITTEN AS SPEECH
 * ===============================
 * His call 2026-09-23. "Diane suggested these" reads as somebody offering
 * something; "Copy their details from another deal" reads as a control the
 * form happens to have. The two sentences differ because the sources do:
 * a live deal is what the person looks like NOW, the archive is the last
 * thing anybody knew, and "found" is the right word for the second.
 *
 * HER NAME, NOT "THE ASSISTANT". She is a name in this building and the
 * rest of the CRM already uses it.
 */
const SAID = {
  live: 'Diane suggested these infos from this person\'s other deal',
  archive: 'Diane found your missing infos in the archive',
};

export default function CopyPersonDetails({ data, form, onFill, busy = false }) {
  if (!data) return null;
  return (
    <div className="mb-4 space-y-2">
      <Offer
        said={SAID.live}
        candidate={data.live}
        form={form}
        onFill={onFill}
        busy={busy}
      />
      {/* SECOND, ALWAYS. A live deal is the better answer whenever there is
          one, and both showing at once is the case where the live one had
          nothing left to give. */}
      <Offer
        said={SAID.archive}
        candidate={data.archive}
        form={form}
        onFill={onFill}
        busy={busy}
      />
    </div>
  );
}
