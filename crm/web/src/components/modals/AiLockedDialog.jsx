import Modal from './Modal';
import Button from '../buttons/Button';
import { LockIcon } from '../icons';
import { aiLockSaid } from '../../configs/aiLock';

// ***************************************************
// * Why Diane will not open
// ***************************************************
//
// Shown in the middle of the screen when her button is pressed while she is
// locked. Says what is wrong and what brings her back, nothing else.
export default function AiLockedDialog({ reason, onClose }) {
  const { title, body } = aiLockSaid(reason);
  return (
    <Modal
      centered
      ariaLabel={title}
      title={(
        <span className="flex items-center gap-2">
          <LockIcon width={18} height={18} />
          {title}
        </span>
      )}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{body}</p>
        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="primary" onClick={onClose}>OK</Button>
        </div>
      </div>
    </Modal>
  );
}
