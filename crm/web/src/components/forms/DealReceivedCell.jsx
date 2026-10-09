import EditableCell from './EditableCell';
import ReviewFlag from '../badges/ReviewFlag';
import PaymentReceived, { dealReceived, DEAL_RECEIVED_OPTIONS } from '../badges/PaymentReceived';
import { flaggedColumns } from '../../helpers/reviewFields';

/**
 * One deal's Payment received on a person's or a company's page: Paid or
 * Unpaid, editable, with the payday review flag beside it. The master sheet
 * draws the same thing through its own Cell. Setting it is the review and
 * clears the flag (API clearPaydayFlag).
 */
export default function DealReceivedCell({ deal, onSave }) {
  const flag = deal.needs_review ? flaggedColumns(deal.review_reason).payment_outcome : undefined;
  return (
    <EditableCell
      value={deal.payment_outcome}
      type="select"
      options={DEAL_RECEIVED_OPTIONS}
      title="Click to set payment received"
      display={(
        <span className="flex items-center gap-1.5">
          <PaymentReceived value={dealReceived(deal.payment_outcome)} />
          {/* title="" keeps the cell's own tooltip off the flag's popup. */}
          {flag && <span title=""><ReviewFlag reason={flag} /></span>}
        </span>
      )}
      onSave={onSave}
    />
  );
}
