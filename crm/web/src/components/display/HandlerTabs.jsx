import { useState } from 'react';
import Button from '../buttons/Button';
import Select from '../forms/Select';
import ConfirmDialog from '../modals/ConfirmDialog';
import { confirm } from '../../configs/confirms.config';
import { PlusIcon, CloseIcon } from '../icons';

/**
 * ONE TAB PER PERSON ON THE DEAL.
 *
 * A handler carries about twenty of a row's columns, so a repeating list
 * of four of them is eighty fields on one screen. A tab shows one person's
 * worth at a time and the strip says how many there are, which is the
 * question the preview underneath answers in full.
 *
 * THE TAB IS NAMED AFTER THE PERSON as soon as there is a name, because
 * "Person 2" tells you nothing once you have four of them and are looking
 * for Drew.
 *
 * ONE AXIS OF TABS, NOT TWO. The sections inside a person scroll rather
 * than becoming a second tab strip: two nested strips means every field is
 * two clicks from every other field, and it stops being obvious which
 * strip a click moved.
 *
 * COPY FROM, not "same as". It fills this person's fields from another's
 * and then they are this person's to change, which is what somebody means
 * when four handlers share a postcode and one does not. It never links the
 * two: a copy that kept tracking its source would make editing one person
 * silently edit another.
 */
/**
 * Has anything actually been typed into this person?
 *
 * A tab somebody added and has not touched holds nothing to lose, and
 * asking "are you sure" about an empty form is friction that teaches
 * people to click through the confirm without reading it. The two seeded
 * defaults do not count as typing.
 */
function isEmpty(handler) {
  return Object.entries(handler ?? {}).every(([key, value]) => {
    if (key === 'currency') return value === 'GBP';
    if (key === 'paymentMethod') return value === 'cash';
    return value === '' || value === null || value === undefined;
  });
}

export default function HandlerTabs({
  handlers,
  active,
  onActive,
  onAdd,
  onRemove,
  onCopyFrom,
  children,
}) {
  // Which tab's cross was pressed and is waiting on an answer.
  const [confirming, setConfirming] = useState(null);

  const others = handlers
    .map((h, i) => ({ ...h, i }))
    .filter((h) => h.i !== active && String(h.personName ?? '').trim());

  // An untouched tab goes straight away. One with anything in it asks,
  // because the fields are not saved anywhere and closing the dialog is
  // the only other way to get them back, which is to say there is none.
  function requestRemove(i) {
    if (isEmpty(handlers[i])) onRemove(i);
    else setConfirming(i);
  }

  return (
    <div className="space-y-3">
      {/* REMOVE LIVES ON THE TAB, as a cross.
          It was a row of its own under the strip, holding one button that
          only ever acted on the tab already open: a whole row of the
          dialog spent saying "the thing above". On the tab it names its
          own target by being on it, and every person can be removed
          without first being opened.

          The tab is a SPAN wrapping two buttons rather than a button with
          a button inside it, which is invalid and leaves the inner one
          unclickable. */}
      {/* A SEGMENTED TRACK, not an accent underline. The 2px bar under one
          tab was the heaviest mark on a panel of hairlines, and the active
          tab and a hovered one differed only by where that bar sat. */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-sunken p-1">
        {handlers.map((h, i) => (
          <span
            key={i}
            className={`flex items-center rounded-md transition-colors ${
              i === active ? 'bg-surface shadow-sm' : 'hover:bg-surface'
            }`}
          >
            <button
              type="button"
              onClick={() => onActive(i)}
              className={`min-h-0 border-0 bg-transparent py-2 pl-3 text-sm ${
                handlers.length > 1 ? 'pr-1' : 'pr-3'
              } ${i === active ? 'font-semibold text-text' : 'text-text-muted'}`}
            >
              {h.personName?.trim() || `Person ${i + 1}`}
            </button>
            {handlers.length > 1 && (
              <button
                type="button"
                aria-label={`Remove ${h.personName?.trim() || `person ${i + 1}`}`}
                onClick={() => requestRemove(i)}
                className="min-h-0 border-0 bg-transparent py-2 pl-1 pr-2 text-text-faint hover:text-danger"
              >
                <CloseIcon width={12} height={12} />
              </button>
            )}
          </span>
        ))}
        <Button size="sm" className="ml-1 border-0" onClick={onAdd}>
          <PlusIcon width={14} height={14} />
          Add handler
        </Button>
      </div>

      {/* Only once there is somebody to copy FROM. A picker listing nobody
          is a control that cannot be used.

          RIGHT, and green. It is an action rather than a field: on the
          left it sat where a form's first input goes and read as
          something to fill in, and the CRM's colour for "this does
          something" is the accent. Bordered rather than filled, because a
          solid green dropdown would outrank Add deal. */}
      {others.length > 0 && (
        <div className="flex justify-end">
          <Select
            size="sm"
            className="w-56 [&>button]:border-accent [&>button]:text-accent-strong"
            value=""
            onChange={(v) => v !== '' && onCopyFrom(Number(v))}
            options={others.map((h) => ({ value: String(h.i), label: `Copy from ${h.personName}` }))}
            placeholder="Copy from…"
          />
        </div>
      )}

      {children}

      {/* Names WHO is going and says what survives, rather than "this
          cannot be undone", which is true of everything and tells nobody
          anything. What survives is the rest of the deal: removing a
          handler drops their row from the preview and leaves everyone
          else's exactly as typed. */}
      {confirming !== null && (
        <ConfirmDialog
          {...confirm.removeUnsavedHandler(
            handlers[confirming]?.personName?.trim() || `Person ${confirming + 1}`,
          )}
          icon={<CloseIcon width={14} height={14} />}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onRemove(confirming);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
