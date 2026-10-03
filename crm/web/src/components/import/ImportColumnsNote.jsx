import CellInfo from '../display/CellInfo';
import { popup } from '../../configs/popups.config';

/**
 * What the importer did and did not read, in the upload result banner.
 *
 * Sits inside whichever of the three upload surfaces is on screen, so they
 * all say the same thing in the same words. It answers two questions, and
 * they are opposite:
 *
 *   not read        the sheet has a column the CRM has nowhere to put.
 *                   Door number, accepting postals, account number and
 *                   sort code were on the sheet from the beginning, mapped
 *                   by nothing, and dropped on every upload for months
 *                   without a word. Account number and sort code are how a
 *                   person actually gets paid.
 *
 *   left alone      the CRM holds a column this FILE never mentioned, so
 *                   the upload did not touch it. This used to be the
 *                   opposite and unannounced: a sheet with no end date
 *                   column, or one whose header had been renamed, wiped
 *                   every end date in the database.
 *
 * Warning tone on the first, because somebody has to decide whether the
 * column matters. Plain on the second, because nothing is wrong: it is the
 * guard reporting that it did its job. Both render nothing in the normal
 * case, which is a file carrying exactly the columns the CRM knows.
 */
const SENTINEL_LABELS = {
  acceptingPostals: 'Accepting postals',
  phone: 'Phone',
  bankDetails: 'Bank details',
  accountNumber: 'Account number',
  sortCode: 'Sort code',
};

export default function ImportColumnsNote({
  columns, untouched, groupFromName, ungrouped, sentinelWarnings = [],
}) {
  const hasUnknown = columns?.length > 0;
  const hasUntouched = untouched?.length > 0;
  if (!hasUnknown && !hasUntouched && !groupFromName && sentinelWarnings.length === 0) return null;

  const missingGroup = ungrouped ?? groupFromName?.rows ?? 0;

  return (
    <>
      {/* WHERE THE GROUP CAME FROM, when the sheet did not say.
          Never silent, because the group is part of a deal's identity: a
          row that lands on UNKNOWN cannot match the same deal stored under
          its real group, so the import inserts a duplicate of it. */}
      {groupFromName?.group && (
        <p className="flex flex-wrap items-center gap-1 text-text-muted">
          <span>
            Group taken from the file name: <span className="font-semibold">{groupFromName.group}</span>
          </span>
          <CellInfo {...popup.groupFromFilename(groupFromName)} />
        </p>
      )}

      {groupFromName && !groupFromName.group && (
        <p className="flex flex-wrap items-center gap-1 text-warning">
          <span className="font-semibold">
            {missingGroup} {missingGroup === 1 ? 'row has' : 'rows have'} no group
          </span>
          <CellInfo {...popup.noGroupAtAll(groupFromName.reason)} />
        </p>
      )}

      {/* The lists live behind the icons. Spelled out, a sheet with six
          unread columns and a dozen untouched ones was four lines of prose
          above a diff that is the actual point of the screen. */}
      {hasUnknown && (
        <p className="flex flex-wrap items-center gap-1 text-warning">
          <span className="font-semibold">
            {columns.length} column{columns.length === 1 ? '' : 's'} not read
          </span>
          <CellInfo {...popup.columnsNotRead(columns)} />
        </p>
      )}

      {sentinelWarnings.map((warning) => (
        <p key={`${warning.field}:${warning.value}`} className="text-warning">
          <span className="font-semibold">
            {warning.rows} {SENTINEL_LABELS[warning.field] ?? warning.field} cells repeat
            {' '}&ldquo;{warning.value}&rdquo;.
          </span>{' '}
          Check whether that phrase means the value is not held before confirming.
        </p>
      ))}

      {hasUntouched && (
        <p className="flex flex-wrap items-center gap-1 text-text-muted">
          <span>
            {untouched.length} column{untouched.length === 1 ? '' : 's'} not in this file, left alone
          </span>
          <CellInfo {...popup.columnsLeftAlone(untouched)} />
        </p>
      )}
    </>
  );
}
