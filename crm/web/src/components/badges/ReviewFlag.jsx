import CellInfo from '../display/CellInfo';

/**
 * "This cell needs a human." A CellInfo in its warning tone.
 *
 * Kept as its own name because the reason it exists is specific: the
 * importer flags a ROW, and helpers/reviewFields.js maps that flag back
 * to the column that caused it. See CellInfo for the rule this follows.
 */
export default function ReviewFlag({ reason, size = 14 }) {
  return (
    <CellInfo tone="warning" size={size} label={`Needs a check: ${reason}`}>
      {reason}
    </CellInfo>
  );
}
