import Modal from './Modal';
import Button from '../buttons/Button';

/**
 * Yes or no, on one small screen, naming what is about to happen to what.
 *
 * The Master Sheet's row Delete used to open the FULL 25-field editor with
 * a confirm buried at the bottom of it, which reads as "edit this" and
 * makes you scroll to find out you were deleting. A confirmation should be
 * the smallest thing on screen that still says whose data it is.
 *
 * `subject` is the answer to "delete WHAT" and is always shown in bold.
 * `detail` is the consequence, and it should say what survives rather than
 * "this cannot be undone", which is true of everything and tells nobody
 * anything.
 *
 * `detail` TAKES AN ARRAY for more than one paragraph. Deleting a company
 * needs three: what goes, what survives and where it now needs attention,
 * and where the reversible option is. They cannot be one string because
 * they are separate thoughts, and they cannot be nested <p> inside one.
 *
 * `busyLabel` because "Removing…" and "Clearing…" say more than a generic
 * "Working…", and a confirm is the last screen before something is gone.
 */
export default function ConfirmDialog({
  title,
  subject,
  detail,
  confirmLabel = 'Delete',
  busyLabel = 'Working…',
  busy = false,
  onConfirm,
  onCancel,
  /**
   * A SECOND WAY TO SAY YES, when the question has two answers and neither
   * is destructive. The recompute warning is the first: "let it recompute"
   * and "keep the figure I typed" are both real choices, and forcing one
   * of them into Cancel would make cancelling mean two different things.
   *
   * Still one prop, not a list: two choices plus Cancel is a question, and
   * three would be a form.
   */
  altLabel,
  onAlt,
  /** The ordinary confirm is `danger`; a choice between two edits is not. */
  confirmVariant = 'danger',
  icon,
  // Anything that is not words: the log clear puts its progress bar here.
  // Deliberately narrow — a confirm that grows a form is the 25-field
  // editor with a button at the bottom, which is what this replaced.
  children,
}) {
  const paragraphs = detail == null ? [] : (Array.isArray(detail) ? detail : [detail]);
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel}>
      <div className="space-y-4">
        {subject && <p className="text-sm font-semibold">{subject}</p>}
        {paragraphs.map((para, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <p key={i} className="text-sm text-text-muted">{para}</p>
        ))}
        {children}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {/* Cancel first, and it is the plain button. The destructive one
              is never the thing your hand is already resting on. */}
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          {altLabel && onAlt && (
            <Button onClick={onAlt} disabled={busy}>{altLabel}</Button>
          )}
          <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {icon}
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
