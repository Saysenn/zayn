import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import * as Icons from '../icons';
import { UserIcon, LogOutIcon, ChevronIcon } from '../icons';
import useDismissable from '../../hooks/useDismissable';
import { useLogout } from '../../hooks/useAuth';
import { ADMIN_MENU, WORKSPACE_NAME } from '../../configs/navigation';
import { ACTIVE_NAV_CLASS, INACTIVE_NAV_CLASS } from '../../configs/navigationStyles';

/**
 * ***************************************************
 * * THE ACCOUNT, BEHIND ONE AVATAR IN THE HEADER
 * ***************************************************
 *
 * His call 2026-09-29. History, Settings and Sign out were spread across
 * three places: two rows at the foot of the sidebar, a red button under
 * them, and a second gear and a second sign out in the header for phones.
 * Four controls for three acts, and the phone's pair could drift from the
 * laptop's because they were written out separately.
 *
 * They are all the same KIND of thing: they belong to whoever is signed in
 * rather than to any page, which is why every app puts them behind the
 * avatar. One control, one list, every width.
 *
 * THE DESTINATIONS COME FROM configs/navigation's ADMIN_MENU. Sign out is
 * not in it: it is an act, not a page, so it has no route and is rendered
 * last, after a rule, in the one colour that says it ends something.
 *
 * LAYER 40, the same one an open `Select` root takes (CLAUDE.md's scale).
 * The header is a stacking context of its own at z-20, so the panel is
 * above every sticky table header in the page below it and under the
 * Toaster at 60, which is where a failure has to stay visible.
 */

// One shape for both kinds of row, so the act at the bottom sits on exactly
// the same grid as the two destinations above it.
const ITEM = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold '
  + 'no-underline transition duration-150';

const itemClass = ({ isActive }) => `${ITEM} ${isActive ? ACTIVE_NAV_CLASS : INACTIVE_NAV_CLASS}`;

// ===============================
// * ARROW KEYS, because `role="menu"` promises them
// ===============================
// Tab alone is what a list of links gives you. A menu is a single stop that
// you then move INSIDE, which is why Up and Down are not a nicety here:
// without them the role is telling a screen reader something untrue.
//
// Read off the DOM rather than from a ref per item: the items are two
// shapes (links and a button) from two sources, and a second list of refs
// kept in step with ADMIN_MENU is the thing that goes stale.
const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

function moveFocus(panel, step) {
  const items = [...(panel?.querySelectorAll(ITEM_SELECTOR) ?? [])];
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement);
  // WRAPS, both ways. Down from the last lands on the first, which is what
  // every menu does and what makes a three item list quick.
  const next = at === -1
    ? (step > 0 ? 0 : items.length - 1)
    : (at + step + items.length) % items.length;
  items[next].focus();
}

export default function AdminMenu() {
  const [open, setOpen] = useState(false);
  const { mutate: logout, isPending } = useLogout();
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  const ref = useDismissable(open, close);

  // Closing from INSIDE the menu puts focus back on the avatar. Closing by
  // clicking elsewhere deliberately does not: that would snatch focus off
  // whatever was just clicked.
  const closeAndReturn = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // OPENING PUTS THE CURSOR ON THE FIRST ITEM. A menu that opens with focus
  // still on the button is one Tab away from leaving the menu entirely.
  useEffect(() => {
    if (open) moveFocus(panelRef.current, 1);
  }, [open]);

  function onKeyDown(event) {
    if (!open) {
      // Down opens it, the way a combobox does.
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { closeAndReturn(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(panelRef.current, 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(panelRef.current, -1); }
    if (event.key === 'Tab') close();
  }

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      {/* ===============================
           * A CIRCLE, AND A CHEVRON OUTSIDE IT
           * ===============================
           * The circle is the only round thing in the header, which is what
           * makes it read as "you" rather than as one more action: every
           * other control up here is a rectangle with a word in it.
           *
           * The chevron sits OUTSIDE the circle rather than in it, so the
           * avatar stays an avatar and the indicator stays an indicator. It
           * turns to point up while the menu is open, which is the one
           * cheap way a closed control says it is now open. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${WORKSPACE_NAME} menu`}
        className="group h-8 min-h-0 shrink-0 gap-1 rounded-full border-none bg-transparent p-0 pr-0.5"
      >
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 items-center justify-center rounded-full border transition duration-150
            ${open
              ? 'border-accent-strong bg-accent-tint text-accent-strong'
              : 'border-border-strong bg-surface-sunken text-text-muted group-hover:border-accent-strong group-hover:text-accent-strong'}`}
        >
          <UserIcon width={17} height={17} />
        </span>
        <ChevronIcon
          aria-hidden="true"
          width={13}
          height={13}
          className={`shrink-0 text-text-faint transition-transform duration-200 motion-reduce:transition-none
            ${open ? '-rotate-90' : 'rotate-90'}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={WORKSPACE_NAME}
          // `menu-pop` grows it out of the avatar rather than fading it in
          // over the page. index.css, with the reduced motion guard.
          className="menu-pop absolute right-0 top-[calc(100%+0.5rem)] z-40 w-56 overflow-hidden rounded-lg border border-border bg-surface p-1.5 shadow-lg"
        >
          {/* WHO THIS IS. One shared credential, so it names the PLACE, and
              a menu with no heading reads as a toolbar that fell over.
              `presentation`, because a `role="menu"` may only hold items
              and separators; the name is already the menu's aria-label. */}
          <p
            role="presentation"
            className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint"
          >
            {WORKSPACE_NAME}
          </p>

          {ADMIN_MENU.map((item) => {
            const Icon = Icons[item.icon];
            return (
              <NavLink
                key={item.to}
                to={item.to}
                role="menuitem"
                className={itemClass}
                onClick={closeAndReturn}
              >
                <Icon width={17} height={17} />
                {item.label}
              </NavLink>
            );
          })}

          {/* A RULE, because what follows is not another page. */}
          <div role="separator" className="my-1.5 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            onClick={() => logout()}
            // `min-h-0` and the resets undo the base `button` rule in
            // index.css, which is sized for a toolbar: without it this row
            // stands 4px taller than the two links above it.
            className={`${ITEM} min-h-0 justify-start border-none bg-transparent text-danger hover:bg-danger-tint`}
          >
            <LogOutIcon width={17} height={17} />
            {isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
