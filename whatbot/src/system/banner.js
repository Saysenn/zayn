/**
 * The thing you see when you start a process.
 *
 * Purely cosmetic: a name to look at, and the two or three facts you actually
 * want confirmed before you trust the terminal you're staring at (which
 * process is this, what mode, what is it reading).
 *
 * Not logging, so not the logger — this writes straight to stdout, and only
 * when stdout is a terminal. In production the logs are JSON that gets shipped
 * somewhere, and ASCII art in that stream is garbage; the real
 * "process started" log line covers it there.
 */

const ART = [
  "██╗    ██╗██╗  ██╗ █████╗ ████████╗██████╗  ██████╗ ████████╗",
  "██║    ██║██║  ██║██╔══██╗╚══██╔══╝██╔══██╗██╔═══██╗╚══██╔══╝",
  "██║ █╗ ██║███████║███████║   ██║   ██████╔╝██║   ██║   ██║   ",
  "██║███╗██║██╔══██║██╔══██║   ██║   ██╔══██╗██║   ██║   ██║   ",
  "╚███╔███╔╝██║  ██║██║  ██║   ██║   ██████╔╝╚██████╔╝   ██║   ",
  " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═════╝  ╚═════╝    ╚═╝   ",
];

/**
 * Water: bright at the surface, deeper blue further down. One colour per row of
 * ART, top to bottom, so the two arrays have to stay the same length.
 *
 * 256-colour codes rather than truecolor — macOS Terminal.app doesn't do
 * truecolor, and a banner that renders as garbage in the default terminal
 * defeats the point.
 */
const WATER = [123, 87, 81, 75, 33, 26];

const blue = (n) => `\x1b[38;5;${n}m`;
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Facts worth reading at a glance. Values are printed as-is, so keep them short. */

/**
 * @param scope which process this is — 'web' or 'worker'. This is the line
 *   that stops you sending SIGINT to the wrong terminal.
 */
export function printBanner(scope, facts = {}) {
  // NO_COLOR and a piped stdout both mean "nobody is looking at this prettily"
  if (!process.stdout.isTTY || process.env.NO_COLOR) return;

  const lines = [
    "",
    ...ART.map(
      (line, row) => `${blue(WATER[row] ?? WATER.at(-1))}${line}${RESET}`,
    ),
    "",
    `  ${BOLD}${scope}${RESET}${DIM}${Object.entries(facts)
      .map(([key, value]) => ` · ${key} ${value}`)
      .join("")}${RESET}`,
    "",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}
