import { useEffect, useState } from 'react';
import Modal from '../../modals/Modal';
import DealCard from './DealCard';
import { MasterSheetIcon } from '../../icons';
import { apiService } from '../../../configs/api.config';

// ***************************************************
// * One deal, opened from a chip in her list
// ***************************************************
//
// The chip carries six fields because that is all a chip can show. The
// card needs the row, so this fetches it: `/master-sheet/:id/card` returns
// the shape her panel already draws, built by her own `dealCard`.
//
// It is NOT a message to Diane. Asking her to look the row up again would
// cost a round trip, put a line in the transcript nobody asked for, and
// depend on her choosing to answer with a card.
//
// `expanded` so nothing is folded away: the whole screen is the card here,
// which is the difference between this and the inline one.
//
// `wide` because the expanded card runs its `label: value` lines TWO UP.
// One column of twenty is a dialog you scroll three times; two of them need
// more than the default md to hold a value each.

export default function DealModal({ row, onClose }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setCard(null);
    setError(null);
    apiService.masterSheet
      .card(row.id)
      .then((r) => { if (live) setCard(r.card); })
      .catch((e) => { if (live) setError(e.message); });
    // Dropped on unmount, so closing mid flight cannot set state on a
    // component that has gone.
    return () => { live = false; };
  }, [row.id]);

  return (
    <Modal
      wide
      tone="diane"
      ariaLabel={row.name ? `${row.name}, row ${row.id}` : `Row ${row.id}`}
      title={(
        <span className="flex items-center gap-2">
          <MasterSheetIcon width={16} height={16} className="shrink-0 text-diane-dim" />
          {row.name ?? `Deal #${row.id}`}
        </span>
      )}
      onClose={onClose}
    >
      {error && (
        <p className="rounded-lg border border-diane-alert/40 bg-diane-alert/10 px-3 py-2 text-[11px] text-diane-alert">
          {error}
        </p>
      )}

      {/* The chip's own facts, so the dialog is never empty while the row
          is in flight. It is the same information, just less of it. */}
      {!card && !error && (
        <div className="animate-pulse rounded-lg border border-diane-line/25 bg-diane-panel p-3">
          <p className="text-xs font-semibold text-diane-signal">{row.name}</p>
          <p className="mt-0.5 text-[9px] text-white/40">
            {[row.where, row.role].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 text-[13px] font-bold tabular-nums text-white/70">{row.amount}</p>
        </div>
      )}

      {card && <DealCard card={card} expanded disabled />}
    </Modal>
  );
}
