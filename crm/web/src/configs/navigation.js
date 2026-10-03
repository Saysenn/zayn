/**
 * ***************************************************
 * * THE SIDEBAR, AND THE ONE PLACE IT IS DECIDED
 * ***************************************************
 *
 * Every nav item, its order, and which group it belongs to. It was a list
 * inside Layout.jsx, which meant the shape of the CRM was a detail of a
 * layout component; two renderers read it (the sidebar and the phone's
 * bottom bar) and a page added to one had to be added to the other.
 *
 * GROUPED BY WHAT THE MONEY IS DOING, his call 2026-09-17. The master
 * sheet, People, Companies and the Archive are four views of ONE flow, so
 * they sit under it rather than beside it: `tb_mastersheet` is the payment
 * record and the other three are readings of that same table.
 *
 * ADDING A PAGE IS ONE ENTRY HERE. Nothing else needs editing.
 *
 * PURE DATA, AND THE ICON IS ITS NAME. Importing the components would
 * make this file unimportable by node:test, which cannot parse JSX, and a
 * config nothing can assert on is a config that drifts. Layout resolves
 * the name against the icon module itself, so there is no second list to
 * keep in step and a name that does not exist is caught by its own test.
 */

/**
 * ===============================
 * * UNGROUPED IS A POSITION, NOT AN OVERSIGHT
 * ===============================
 * Dashboard leads because it is the way in and belongs to no one flow: it
 * reads across all of them. Everything else earns a group.
 */
export const NAV_TOP = [
  { to: '/dashboard', label: 'Dashboard', icon: 'DashboardIcon' },
];

/**
 * ===============================
 * * THREE KINDS OF MONEY, THEN THE OTHER SYSTEM
 * ===============================
 * "Payments, master sheet, expenses, debts" was the ask, and the master
 * sheet turned out to be a PAGE inside Payments rather than a sibling of
 * it: one table, four views. So three money groups, in the order money
 * moves, and Whatbot last because it is not money at all.
 *
 * AN EMPTY GROUP DRAWS NOTHING. Debts is declared because it is a decided
 * shape and a heading over a page that does not exist is a dead link with
 * a title. The day it has a page it is one entry, already in the right
 * place and the right order.
 */
export const NAV_GROUPS = [
  {
    key: 'payments',
    label: 'Payments',
    items: [
      { to: '/master-sheet', label: 'Master sheet', icon: 'MasterSheetIcon' },
      { to: '/people', label: 'People', icon: 'UsersIcon' },
      { to: '/companies', label: 'Companies', icon: 'BuildingIcon' },
      // ===============================
      // * THE ONE PAGE THAT ASKS RATHER THAN SHOWS
      // ===============================
      // His call 2026-09-29. It was a modal behind a button that only
      // appeared while something was waiting, so the screen could not be
      // opened to check it had been answered. Before the Archive because
      // this is what SENDS deals there.
      { to: '/review', label: 'Review', icon: 'AlertCircleIcon' },
      // The same rows as the master sheet, read as history. Last in the
      // group because it is what the first four become.
      { to: '/archive', label: 'Archive', icon: 'ArchiveIcon' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    items: [
      { to: '/expenses', label: 'Expenses', icon: 'ReceiptIcon' },
    ],
  },
  {
    // NO ITEMS AND NO PAGE. What a debt IS has not been decided (money we
    // owe and have not paid, money owed back to us, or a third party), and
    // that decides the schema. See docs/feature.md.
    key: 'debts',
    label: 'Debts',
    items: [],
  },
  {
    /**
     * ===============================
     * * THE OTHER SYSTEM, AND IT IS NOT MONEY
     * ===============================
     * His call 2026-09-17: Flagged is whatbot's. It is what the WhatsApp
     * agent raised with a person, so it belongs to whatbot rather than to
     * any kind of money, and it sits LAST because the three above it are
     * the book and this is what came in over the top of it.
     *
     * NO CHAT ENTRY. It opens on a named person, reached from a flag or a
     * notification, and a top level link would open it on nobody. It was
     * already absent before this file existed.
     */
    key: 'whatbot',
    label: 'Whatbot',
    items: [
      { to: '/flagged', label: 'Flagged', icon: 'FlagIcon' },
    ],
  },
];

/**
 * ===============================
 * * THE ACCOUNT MENU, and it is not a group
 * ===============================
 * Neither of these is a view of the money: History is a control over what
 * has been DONE to it, and Settings is the workspace itself. They belong to
 * the person signed in, so they live behind the avatar in the header
 * (`layout/AdminMenu`) rather than under a heading in the sidebar. His call
 * 2026-09-29.
 *
 * Settings was written into Layout.jsx by hand, twice, which made it the
 * one nav entry this file did not decide and the phone's copy a thing that
 * could drift from the laptop's.
 *
 * SIGN OUT IS NOT HERE. It is an ACT, not a destination, so it has no route
 * and the menu renders it last on its own.
 *
 * NOT IN `NAV_ITEMS`, so neither reaches the phone's bottom bar: the bar is
 * for the pages, and the avatar is on every width.
 */
export const ADMIN_MENU = [
  { to: '/history', label: 'History', icon: 'RestoreIcon' },
  { to: '/settings', label: 'Settings', icon: 'GearIcon' },
];

/**
 * What the chrome calls this place. The sidebar heading and the account
 * menu both say it, so it is said once.
 *
 * The bot's name over "CRM workspace" named the bot rather than the place,
 * and the second line was a caption for a caption.
 */
export const WORKSPACE_NAME = 'Admin workspace';

/** Only the groups that have somewhere to go. */
export const VISIBLE_GROUPS = NAV_GROUPS.filter((g) => g.items.length > 0);

/**
 * EVERY DESTINATION, FLAT AND IN ORDER.
 *
 * The phone's bottom bar has no room for headings, so it draws this. One
 * list behind both, or a page reachable on a laptop goes missing on a
 * phone, which is the bug that made this a config file in the first place.
 */
export const NAV_ITEMS = [
  ...NAV_TOP,
  ...NAV_GROUPS.flatMap((group) => group.items),
];
