import Modal from './Modal';
import Button from '../buttons/Button';
import HistoryList from '../history/HistoryList';

/**
 * The history, in a dialog, over one person, one company, one deal or one
 * field. The whole list lives in `components/history/HistoryList` and the
 * unscoped reading of it is `pages/HistoryPage`.
 *
 * THE FRAME OWNS THE HEIGHT. A dialog has to keep its table inside itself;
 * a page lets the page scroll. So the cap is passed in rather than built
 * into the list.
 */
const MODAL_MAX_HEIGHT = 'max-h-[26rem]';

export default function HistoryModal({
  rowId, personId, company, field, title = 'Recent changes', onClose,
}) {
  return (
    <Modal wide title={title} onClose={onClose}>
      <HistoryList
        rowId={rowId}
        personId={personId}
        company={company}
        field={field}
        maxHeight={MODAL_MAX_HEIGHT}
      />
      <div className="mt-3 flex justify-end border-t border-border pt-4">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
