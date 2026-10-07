// ***************************************************
// * One icon set for the whole app: 20x20, LINE
// ***************************************************
//
// STROKED, NOT FILLED. The set was converted to solid on 2026-09-08 and
// reverted the same day: solid carried the colour better at 13px but read
// as heavy and blunt everywhere else, which is most of the app.
//
// THE STROKE IS 2.1, NOT 1.75. That is the half of the solid experiment
// worth keeping. At 20px in a 24 viewBox, 1.75 renders as 1.46 real pixels
// and the cell markers were being missed; 2.1 renders as 1.75 and holds its
// colour without changing the drawing. Every icon shares it, so weight
// never varies by who wrote the icon.
//
// Kept as plain inline SVG rather than a dependency, so the whole set shares
// one weight and one corner style by construction.
const BASE = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const BuildingIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
    <path d="M10 21v-4h4v4" />
  </svg>
);

export const DashboardIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="4" rx="1.5" />
    <rect x="14" y="11" width="7" height="10" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

// The payday-check indicator, beside the Paid toggle on People and the
// master sheet. Two states only: the person got their money with nothing
// to look into, or a human needs to look. Anything else (never asked, no
// reply yet) shows no icon at all, because "we don't know" is not a
// finding.
export const CheckCircleIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </svg>
);

export const WarningIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3.5L21 19H3z" />
    <path d="M12 9.5v4.5" />
    <path d="M12 16.75v.5" />
  </svg>
);

export const ChevronIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const FlagIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M5 3v18" />
    <path d="M5 4h13l-3 4 3 4H5" />
  </svg>
);

export const ChatIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 4h16v12H8l-4 4z" />
  </svg>
);

export const LogOutIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M9 4H5v16h4" />
    <path d="M13 8l4 4-4 4" />
    <path d="M21 12H9" />
  </svg>
);

export const LogsIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M5 3h14v18H5z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);

export const SearchIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const SendIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </svg>
);

export const PaperclipIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export const ImageIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

export const SpreadsheetIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

export const UsersIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 4.5a3.25 3.25 0 0 1 0 6.3" />
    <path d="M15 13.3A5.5 5.5 0 0 1 20.5 19" />
  </svg>
);

export const FilterIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 5h16M7 12h10M10.5 19h3" />
  </svg>
);

export const GearIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="3.25" />
    <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7L16 16M8 8 6.3 6.3" />
  </svg>
);

// Distinct from SpreadsheetIcon (the calculator's generated files): this is
// the one authoritative sheet, so it reads as a document with a list on it
// rather than a grid.
export const MasterSheetIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M5 3h9l5 5v13H5z" />
    <path d="M14 3v5h5" />
    <path d="M8.5 13h7M8.5 17h7" />
  </svg>
);

// The polishing agent's trigger — a small radiating spark, distinct from
// GearIcon (settings) and every other outline icon, so it reads as "alive"
// even before the orb overlay opens.
export const SparkleIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
  </svg>
);

// Diane switched off: no AI key, or no credit on it.
export const LockIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const MicIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const SpeakerIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6" />
  </svg>
);

export const SpeakerMuteIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16 9l5 5M21 9l-5 5" />
  </svg>
);

export const ToolsIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.65 2.65-2-2z" />
  </svg>
);

// Arrow INTO a tray — deliberately the mirror of DownloadIcon below, so
// the pair reads as opposites at a glance rather than two unrelated marks.
export const ImportIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 15V3M8 7l4-4 4 4" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

export const DownloadIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3v12M8 11l4 4 4-4" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

// An arrow curving back to where it started — "begin again". Not the bin,
// which means the pile is destroyed, and not the two chasing arrows, which
// mean "run it again and get a new result".
export const ResetIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8" />
    <path d="M20 4v4h-4" />
  </svg>
);

// A ring with a quarter missing, drawn to be SPUN. Not ResetIcon: that one
// carries an arrowhead and reads as "try again" the moment it turns.
export const SpinnerIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

// A bin. Used for destructive clears, never for a plain "remove one item"
// (that's an ✕ inline) — this one means "everything in this pile goes".
export const TrashIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 7h16M10 4h4M9 7v12M15 7v12" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
);

/**
 * A RAISED PALM. "Stop this", on a deal that is over.
 *
 * NOT an octagon and not a circle-slash: both read as "forbidden" or
 * "blocked", and stopping a deal is neither. It is somebody saying the
 * arrangement has ended, and it is reversible from the Archive.
 *
 * It sits beside TrashIcon and must not be mistaken for it at 15px, which
 * is why it is a hand and not another lid-and-body shape.
 */
export const StopHandIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M9 11V9.5a1.5 1.5 0 0 0-3 0V14c0 3.3 2.7 6 6 6h1a5 5 0 0 0 5-5v-2" />
  </svg>
);

// Two arrows chasing each other — "run this and produce a new result",
// distinct from a plain play triangle, which reads as "start a video".
export const GenerateIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </svg>
);

export const PlusIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// --- Diane's workspace panel. One per context, so the four are
// distinguishable at a glance rather than four identical rows of text.

// Expensing: a receipt with a torn bottom edge.
export const ReceiptIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
    <path d="M9.5 8h5M9.5 12h5" />
  </svg>
);

// Bank: the classic columned facade. Reads as "bank" at 18px in a way a
// generic building outline doesn't.
export const BankIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3 10l9-6 9 6" />
    <path d="M5 10v8M10 10v8M14 10v8M19 10v8" />
    <path d="M3 21h18" />
  </svg>
);

// Cash: a note with a value in the middle.
export const CashIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="2" y="6" width="20" height="12" rx="1" />
    <path d="M12 9.5v5M10.8 10.2h2.4M10.8 13.8h2.4" />
  </svg>
);

// Crypto: a hexagon with a link through it. Completes the payment method
// set beside CashIcon and BankIcon, which already existed.
export const CryptoIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3l7.5 4.3v8.4L12 21l-7.5-5.3V7.3z" />
    <path d="M10.4 13.6a2 2 0 0 1 0-2.8l1-1a2 2 0 0 1 2.8 2.8" />
    <path d="M13.6 10.4a2 2 0 0 1 0 2.8l-1 1a2 2 0 0 1-2.8-2.8" />
  </svg>
);

// Diane's own mark — a compact audio waveform, used in the overlay header
// beside her name and on the mute control.
export const WaveformIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3 12h2M8 7v10M12 4v16M16 8v8M20 11h1" />
  </svg>
);

// Four corner marks pointing outward — "expand", distinct from a plain
// arrow, matching the HUD framing around the orb.
export const ExpandIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
  </svg>
);

// ---- rich text toolbar ----------------------------------------------
// Drawn as letterforms rather than as abstract marks, the way every text
// editor does it — a "B" is unambiguous in a way a generic glyph isn't.
// `strokeWidth` is left to BASE so they sit at the same weight as
// everything else in the toolbar.

export const BoldIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />
  </svg>
);

export const ItalicIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M15 4h-5M14 20H9M14 4l-4 16" />
  </svg>
);

export const UnderlineIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />
  </svg>
);

export const BulletListIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const NumberListIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M10 6h11M10 12h11M10 18h11" />
    {/* The numerals stay LIGHTER than the bars. At the set's own weight a
        "2" closes up into a blob at 20px. */}
    <path d="M3 5.2l1.4-.7V8M3 11h2.6L3 14h2.6M3 16.4h2.4v1.7H3.6v.6h1.8v1.7H3" strokeWidth="1.45" />
  </svg>
);

export const GridViewIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const RowsViewIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="10" width="18" height="4" rx="1" />
    <rect x="3" y="16" width="18" height="4" rx="1" />
  </svg>
);

export const ClearFormatIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M6 5h13M10 5l-2.5 9M14 19h6M4 19l3-3" />
    {/* The strike stays lighter, for the same reason as the numerals: two
        crossing strokes at full weight fuse into a diamond. */}
    <path d="M15 12l6 6M21 12l-6 6" strokeWidth="1.7" />
  </svg>
);

// A panel opening from the right edge — for expanding the conversation
// into its drawer. Deliberately NOT ExpandIcon: that one means "leave for
// the CRM" in this UI, and two different actions must not share a glyph.
export const ExpandConvoIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14 4v16M17 10l3 2-3 2" />
  </svg>
);

// The same panel with the arrow pointing back out — collapse.
export const CollapseIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14 4v16M20 10l-3 2 3 2" />
  </svg>
);

// A box with a lid and a line across it — "put this away", not "delete
// it". Deliberately not a bin: archiving a person keeps every deal they
// were ever paid under, and a bin icon would promise the opposite.
export const ArchiveIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3 7h18v3H3z" />
    <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    <path d="M10 14h4" />
  </svg>
);

// The same box with an arrow coming back out of it — the exact inverse of
// ArchiveIcon, so the pair reads as one toggle rather than two unrelated
// actions.
export const RestoreIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3 7h18v3H3z" />
    <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    <path d="M12 18v-5" />
    <path d="M9.5 15.5 12 13l2.5 2.5" />
  </svg>
);

// A pencil — "change what this says". Used for the row action that opens
// the full edit modal, beside cells that are already editable in place.
export const EditIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

// TWO CHEVRONS: go without stopping. The mark on Diane's auto mode, and
// the same shape every terminal uses for "skip the prompt". One `ChevronIcon`
// means "there is more that way"; two mean "do not pause at it".
export const FastForwardIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M5 6l6 6-6 6M13 6l6 6-6 6" />
  </svg>
);

// TIME RUNNING OUT, for "final month": this one is paid in full and then
// stops. A calendar would say "a date", which is the opposite of what the
// answer means, and there is no date to show.
export const HourglassIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M7 3h10M7 21h10M17 3v3l-5 6 5 6v3M7 3v3l5 6-5 6v3" />
  </svg>
);

// ONE person, head and shoulders. `UsersIcon` is the People page: a crowd.
// This is the account, which is one admin, and the two must not be the same
// drawing or the avatar reads as a link to a list.
export const UserIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="8.2" r="3.7" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);

// A plain ✕. Used for "clear this" and "close this" — never for delete,
// which is TrashIcon. The distinction matters: one takes a filter off, the
// other destroys a row.
export const CloseIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// A bare tick, no circle around it. CheckCircleIcon is the payday
// indicator and carries its own meaning; this is just "ticked".
export const CheckIcon = (props) => (
  <svg {...BASE} strokeWidth={2.4} aria-hidden="true" {...props}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

// A shield. Used wherever the app says what it protects: the login card's
// trust line and the command center's footer. One glyph, both places.
export const ShieldIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
  </svg>
);

// A lowercase i in a circle. Explains a cell that needs explaining, and
// is deliberately not WarningIcon: warning means "somebody has to act",
// info means "here is what this is". See components/CellInfo.jsx.
export const InfoIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.75v.5" />
  </svg>
);

// An exclamation in a CIRCLE. The third marker, between the other two: the
// triangle says something is wrong, the i-circle says here is context, this
// says SOMETHING IS MISSING AND YOU CAN FILL IT. Gold like the triangle,
// round like the info mark, because it is an offer and not a fault. Note
// the glyph is the INVERSE of InfoIcon's: bar above dot, not below. Used by
// forms/CellSuggestion on the three date columns.
export const AlertCircleIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.5" />
    <path d="M12 16.25v.5" />
  </svg>
);

// The KPI row's own four, matching the reference dashboard: a deal is a
// briefcase, money is a wallet. ReceiptIcon and MasterSheetIcon stay where
// they are, on the master sheet and in the change list.
export const BriefcaseIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </svg>
);

export const WalletIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" />
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M16 13h3" />
  </svg>
);

// The dashboard's amount toggle. A STACK for raw, because the point of raw
// is that there are SEVERAL amounts and a pile says plural at 15px where
// three tiny currency symbols would be mush. A single dollar for converted,
// because the point of converted is that there is only one.
export const CoinsIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </svg>
);

export const DollarIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3v18" />
    <path d="M16.5 7.5c0-1.7-2-3-4.5-3S7.5 5.8 7.5 7.5s2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" />
  </svg>
);

// Appearance: a painter's palette, for the theme setting.
export const PaletteIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.9 1.4-1.8l-.3-.9c-.4-1.1.4-2.3 1.6-2.3h1.8a4 4 0 0 0 4-4c0-4.4-3.8-8-8.5-8z" />
    <circle cx="7.8" cy="11" r="1" />
    <circle cx="10.5" cy="7.5" r="1" />
    <circle cx="14.8" cy="7.8" r="1" />
  </svg>
);

// Special case deal: the Actions column switch on the Master sheet.
export const StarIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
  </svg>
);

// ***************************************************
// * Bulk bar actions
// ***************************************************

// Undo: an arrow curling back. The toast's action and History's bulk undo.
export const UndoIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

// Paid: a coin with a tick. The money has gone out.
export const PaidIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.25l2.4 2.4 4.6-4.9" />
  </svg>
);

// Should be paid: a calendar with a tick. Owed for this period.
export const ShouldBePaidIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="M9 14.75l2 2 4-4" />
  </svg>
);

// Resume: play. A stopped deal running again.
export const ResumeIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M7.5 5.5v13l11-6.5z" />
  </svg>
);

// Mark read: an open envelope.
export const MailOpenIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M3.5 10l8.5-6 8.5 6v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" />
    <path d="M3.5 10l8.5 5.5 8.5-5.5" />
  </svg>
);

// Map controls: zoom out, and fit the whole map back in view.
export const MinusIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M5 12h14" />
  </svg>
);

export const FitIcon = (props) => (
  <svg {...BASE} aria-hidden="true" {...props}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
