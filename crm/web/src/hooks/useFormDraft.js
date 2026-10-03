import { useEffect, useRef, useState } from 'react';

/**
 * WHAT WAS TYPED SURVIVES THE DIALOG CLOSING.
 *
 * Every one of these forms is a modal, and a modal closes on a click
 * outside it. Filling in a person, three companies, a role and an amount
 * and then brushing the backdrop threw all of it away with no warning and
 * no way back. A refresh did the same.
 *
 * So the fields are mirrored into localStorage as they are typed and read
 * back when the dialog next opens. The draft is cleared on a successful
 * save, because then it is not a draft any more, and it can be thrown away
 * by hand from the line the form shows while one is restored.
 *
 * NOT SILENT. A form that quietly comes back full is its own kind of
 * surprise: you meant to start fresh and did not notice it had not. The
 * caller renders `restored` as a visible line with a way to discard it.
 *
 * EVERY READ AND WRITE IS GUARDED. localStorage throws outright in some
 * contexts (a private window, site data blocked), and losing a draft is
 * never worth taking the form down with it.
 */

// One prefix, so everything this writes is findable and clearable in one
// place rather than being loose keys nobody can attribute.
const PREFIX = 'crm.draft.';

function read(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Full, blocked, or unavailable. The form still works; it just will
    // not survive a close.
  }
}

function drop(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // As above.
  }
}

/**
 * @param {string} key what this form is, e.g. `add-deal:${personId}`. Keyed
 *   per subject where there is one, so a half-filled deal for Nathan does
 *   not reappear inside Drew's dialog.
 * @param {object} initial the empty form
 * @returns {[object, Function, { restored: boolean, discard: Function, clear: Function }]}
 */
export function useFormDraft(key, initial) {
  // Read ONCE, on mount. Reading on every render would fight the state it
  // is meant to be seeding.
  const saved = useRef(read(key)).current;
  const [value, setValue] = useState(() => (saved ? { ...initial, ...saved } : initial));
  const [restored, setRestored] = useState(Boolean(saved));
  // A save clears the draft; without this the effect below would write it
  // straight back on the next render.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    write(key, value);
  }, [key, value]);

  return [
    value,
    setValue,
    {
      restored,
      /** The admin says start again. */
      discard: () => {
        done.current = true;
        drop(key);
        setRestored(false);
        setValue(initial);
        // Re-armed, so what they type from here is kept too.
        done.current = false;
      },
      /** Saved for real, so there is nothing left to restore. */
      clear: () => {
        done.current = true;
        drop(key);
        setRestored(false);
      },
    },
  ];
}
