import { distinct, METHOD_LABELS, NOT_HELD } from './shared';

/**
 * ***************************************************
 * * How to pay this person, in its own box.
 * ***************************************************
 *
 * ONE DEFINITION, TWO TEMPLATES. The Breakdown and the Monthly Sheet
 * carried the same five rows written out twice, which is two places for a
 * column to move and one of them to be missed.
 *
 * IT IS A BOX because it is the HEADER for the companies below it, not the
 * first of them. Set as loose label/value rows it ran straight into the
 * list and read as another entry. The border is a full hairline, never a
 * stripe down one edge: the house style's one hard no, and on paper a
 * single heavy edge reads as damage rather than emphasis.
 *
 * ONCE PER PERSON, never once per company: repeating a sort code under
 * each of somebody's four companies is four chances to read the wrong one.
 */

/**
 * A value we do not hold is set quiet, so an absence reads as an answer
 * rather than as something somebody forgot to type. `distinct` writes the
 * words; this only decides how they look.
 */
function Fact({ label, value }) {
  const held = value && value !== NOT_HELD;
  return (
    <>
      <dt>{label}</dt>
      <dd className={held ? undefined : 'none'}>{held ? value : NOT_HELD}</dd>
    </>
  );
}

export default function PayBox({ deals }) {
  const methods = [...new Set(
    deals.map((d) => METHOD_LABELS[d.payment_method] ?? d.payment_method).filter(Boolean),
  )].join(' · ');

  return (
    <dl className="pay">
      <Fact label="Phone" value={distinct(deals, 'phone')} />
      <Fact label="Method" value={methods} />
      <Fact label="Bank" value={distinct(deals, 'bank_details')} />
      <Fact label="Account" value={distinct(deals, 'account_number')} />
      <Fact label="Sort code" value={distinct(deals, 'sort_code')} />
    </dl>
  );
}
