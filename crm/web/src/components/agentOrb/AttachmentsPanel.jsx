import ExpenseImage from './forms/ExpenseImage';

/**
 * EVERYTHING SENT IN THIS CONVERSATION, in one place: the pictures Diane
 * sent (open them again) and the files you attached (names only: a file is
 * read once and kept for an hour, not stored). Newest first.
 *
 * Built from the transcript, so it is exactly what the conversation holds
 * and clears with it.
 */
export function attachmentsOf(history) {
  const out = [];
  history.forEach((m, i) => {
    if (m.image?.id) out.push({ kind: 'image', at: i, image: m.image });
    const files = m.role === 'user' && m.attachment
      ? (m.attachment.files?.length ? m.attachment.files : [m.attachment]).map((f) => f.filename).filter(Boolean)
      : [];
    if (files.length) out.push({ kind: 'files', at: i, files });
  });
  return out.reverse();
}

export default function AttachmentsPanel({ history, onOpenImage, onClose }) {
  const items = attachmentsOf(history);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-white/60">
        <span>{items.length ? `${items.filter((x) => x.kind === 'image').length} pictures · ${items.filter((x) => x.kind === 'files').reduce((n, x) => n + x.files.length, 0)} files` : 'Nothing sent yet'}</span>
        <button type="button" onClick={onClose} className="btn-quiet min-h-0 border-0 bg-transparent px-2 py-1 text-[11px] text-diane-signal hover:text-white">
          Back to the conversation
        </button>
      </div>
      <div className="agent-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {items.length === 0 ? (
          <p className="mt-6 text-center text-[11px] text-white/40">Pictures Diane sends and files you attach will be listed here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((x) => (
              <li key={`${x.kind}-${x.at}`}>
                {x.kind === 'image' ? (
                  <ExpenseImage image={x.image} onOpen={onOpenImage} />
                ) : (
                  <div className="rounded-lg border border-diane-line/30 bg-diane-sunken/50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/40">You attached</p>
                    <ul className="mt-1 text-[11px] text-white/80">
                      {x.files.map((f) => <li key={f} className="truncate">📎 {f}</li>)}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
