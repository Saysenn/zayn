import { templateFor } from '../templates/pdf';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../configs/api.config';
import Button from '../components/buttons/Button';

/**
 * The PDF, as a printable page.
 *
 * No PDF library anywhere in this codebase, deliberately. The browser
 * already renders and exports PDFs perfectly well, and a server-side
 * renderer would mean a new dependency, a headless browser or a template
 * language, and a second layout to keep in step with the one on screen.
 *
 * It reads the same /export/rows the xlsx is built from, which is what
 * stops the printed figures and the spreadsheet figures from ever
 * disagreeing.
 *
 * WHAT IT SHOWS, grouped by person: how to pay them (method, bank,
 * account, sort code) and what they earn this month from each company
 * they handle, with the arithmetic beside it. That is the question the
 * whole system exists to answer, and it falls straight out of the shape
 * the data has — a company has many handlers, a person handles many
 * companies, and each pairing pays a monthly amount.
 *
 * Deliberately outside the app shell: no sidebar, no nav, nothing that
 * would end up in the printout.
 */


/**
 * "August 2026 master sheet" from a `YYYY-MM`.
 *
 * A rolled sheet is named for the month it is FOR, never the day it was
 * printed: two August sheets run a week apart are the same document, and
 * dating them by today files them as two.
 */
function monthTitle(month) {
  const [y, m] = String(month ?? '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const label = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${label} master sheet`;
}

const PRESET_LABELS = {
  breakdown: 'Earnings breakdown',
  expensing: 'Expensing',
  cash: 'Cash',
  bank: 'Bank transfer',
  admin: 'Admin',
};

export default function ExportPrintPage() {
  const [search] = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['export-rows', params],
    queryFn: () => apiService.exports.rows(params),
  });

  const rows = data?.rows ?? [];

  // Print once the rows are actually on the page. Firing earlier prints a
  // spinner, which is the kind of thing nobody notices until the blank
  // sheet comes out of the printer.
  useEffect(() => {
    if (isLoading || error || rows.length === 0) return undefined;

    // The browser takes the PDF's suggested filename from document.title,
    // and it is the only hook a browser-printed PDF gives you. Without
    // this every export saved as "Intake CRM" or, worse, the URL.
    const previous = document.title;
    const rolled = monthTitle(rows[0]?.rolled_to);
    const who = params.personId
      ? (rows[0]?.person_name || params.personId)
      : (rolled || PRESET_LABELS[params.preset] || 'Earnings breakdown');
    // A rolled sheet is already named for its month; stamping today's date
    // on it as well would file two runs of the same month separately.
    const stamp = rolled ? '' : ` ${new Date().toISOString().slice(0, 10)}`;
    document.title = `${who}${stamp}`.replace(/[\/:*?"<>|]/g, ' ');

    const t = setTimeout(() => window.print(), 250);
    return () => {
      clearTimeout(t);
      document.title = previous;
    };
  }, [isLoading, error, rows.length, params.personId, params.preset]);

  // Grouped by person, each person's companies kept together.
  const people = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.person_id)) map.set(r.person_id, []);
      map.get(r.person_id).push(r);
    }
    return [...map.values()].sort((a, b) =>
      String(a[0].person_name).localeCompare(String(b[0].person_name)),
    );
  }, [rows]);

  // A rolled month names the document, ahead of the preset: "August 2026
  // master sheet" is what it is, where "Expensing" is only how it was
  // filtered. `rolled_to` comes off the rows themselves, so the heading
  // cannot disagree with the figures under it.
  const title = params.personId
    ? rows[0]?.person_name || params.personId
    : monthTitle(rows[0]?.rolled_to) || PRESET_LABELS[params.preset] || 'Earnings breakdown';

  // WHICH LAYOUT. A person export is always the breakdown — a summary of
  // one person is a single line, which answers nothing — so ?template= is
  // only honoured for the whole-list exports. Unknown ids fall back inside
  // the registry rather than rendering a blank page.
  const { Component: Template } = templateFor(params.personId ? 'breakdown' : params.template);

  if (isLoading) return <p className="p-8 text-sm">Preparing…</p>;
  if (error) return <p className="p-8 text-sm">{error.message}</p>;
  if (rows.length === 0) return <p className="p-8 text-sm">Nothing matches this selection.</p>;

  return (
    <div className="print-page">
      <style>{`
        /* NOT A TABLE, and not label:value for everything either.

           Eight columns in A4 portrait leaves ~23mm each, so a company
           like "SG, CKA, CKU, Umbrella co" truncated and the figures
           wrapped into each other. Pure label:value would have been eight
           lines per company across 96 rows, repeating the same eight
           labels for each of one person's seven companies.

           So it splits by what each part is. The person header is a
           handful of unrelated facts read once, which is exactly what a
           definition list is for. Each company is a repeating record, so
           those stay aligned — but as two lines rather than eight
           columns: name and money on one, the arithmetic small
           underneath. The name gets the full page width and nothing
           truncates. */
        .print-page { background:#fff; color:#111; max-width:820px; margin:0 auto; padding:32px;
                      font:12px/1.55 ui-sans-serif, system-ui, sans-serif; }
        .print-page h1 { font-size:19px; font-weight:700; margin:0 0 2px; letter-spacing:-.01em; }
        .print-page .meta { color:#666; font-size:11px; margin:0 0 26px; }

        .person { margin:0 0 22px; padding:0 0 4px; }
        .person h2 { font-size:14px; font-weight:700; margin:0 0 8px; padding:0 0 5px;
                     border-bottom:1.5px solid #111; letter-spacing:.01em; }

        /* THREE LEVELS: group, person, deal. Each is a step quieter than
           the one above rather than a different decoration, so the
           hierarchy reads without anything being boxed, striped or
           indented.

           The group is the only all-caps heading on the page and the only
           one with a rule under it; the person is the only bold line; the
           companies are plain. That is enough to tell them apart, and it
           leaves every row starting at the same left edge — which is what
           keeps a long company name from being squeezed. */
        .group { margin:0 0 34px; break-inside:auto; }
        .group > h2 { font-size:13px; font-weight:700; text-transform:uppercase;
                      letter-spacing:.08em; margin:0 0 14px; padding:0 0 6px;
                      border-bottom:1.5px solid #111; }
        /* NO INDENTATION ANYWHERE. Every row starts at the same left edge.
           The hierarchy is carried by type and spacing alone — the group is
           the only uppercase rule, the person the only bold line, the
           companies plain — which is enough to read and gives the company
           names the full column width instead of stepping them in twice. */
        .group .person { margin:0 0 20px; padding:0; }
        .group .person:last-of-type { margin-bottom:14px; }
        .group .person h3 { font-size:12px; font-weight:700; margin:0 0 6px;
                            padding:0; border:0; letter-spacing:0; }
        .group .pay { margin:0 0 10px; }

        /* The person's own total: a hairline, not the heavy rule a group
           total gets. Same information at two depths needs two weights or
           neither reads as a level. */
        .subtotal { display:flex; align-items:baseline; gap:10px; margin:7px 0 0;
                    padding-top:5px; border-top:1px solid #ddd; font-size:11px;
                    font-weight:700; break-before:avoid; }
        .subtotal .name { flex:1; color:#555; }
        .subtotal .amt { font-variant-numeric:tabular-nums; white-space:nowrap; }
        /* "nothing this month, ended 06 Jul 2026" is a sentence, not a
           figure. Set as one so it does not sit in the money column
           pretending to be an amount. */
        .subtotal .amt.none, .group-total .amt.none {
          font-weight:400; font-style:italic; color:#777; font-variant-numeric:normal; }

        /* The group's total. The "proper line" — full width, heavy, and
           the only place a group's name repeats. */
        .group-total { display:flex; align-items:baseline; gap:10px; margin-top:12px;
                       padding-top:8px; border-top:1.5px solid #111;
                       font-weight:700; break-before:avoid; }
        .group-total .name { flex:1; text-transform:uppercase; font-size:11px;
                             letter-spacing:.05em; }
        .group-total .amt { font-variant-numeric:tabular-nums; white-space:nowrap; }

        /* What the total left out. Quiet: it is a reconciliation note, not
           a warning, and the rows it refers to are already marked. */
        .excluded { margin:5px 0 0; color:#777; font-size:10px; font-style:italic;
                    break-before:avoid; }

        /* HOW TO PAY THEM, IN ITS OWN BOX.

           It sat as loose label/value rows directly under the name, so it
           ran into the companies below it and read as the first entry
           rather than as the header for all of them. A box says these five
           facts are one thing and the list beneath is another.

           A FULL HAIRLINE BORDER, never a stripe down one edge: the house
           style's one hard no, and on a printed page a single heavy edge
           reads as damage rather than emphasis. Grey enough to sit under
           the name without competing with it.

           Two columns, so every value starts at the same x. A flex row of
           label/value pairs put them wherever the previous one ended,
           which is what made the header look like a jumble. The widest
           label sets the gutter and the value takes the rest of the width,
           so a long bank name does not wrap. */
        .pay { display:grid; grid-template-columns:auto 1fr; gap:5px 16px;
               margin:0 0 16px; padding:11px 14px; font-size:11px;
               border:1px solid #ddd; background:#fafafa;
               /* Never split across a page: five lines that mean nothing
                  without their labels, and the labels are on the left. */
               break-inside:avoid; }
        .pay dt { color:#777; white-space:nowrap; }
        .pay dd { margin:0; color:#111; }
        /* "not held" is set quiet, so a fact we do not have reads as an
           answer rather than as a value somebody forgot to type. PayBox
           writes the words; this only makes them look like an absence. */
        .pay dd.none { color:#aaa; font-style:italic; }

        /* NO TINT AND NO EDGE RULE ON A FLAGGED ROW.

           Both were attempts to make an ended deal stand out, and both made
           the document harder to read rather than easier: on a page where
           whole groups have finished, a yellow wash turns most of the sheet
           into a highlighted block and the eye stops distinguishing
           anything. The 3px rule was worse — the house style's one hard no.

           The workings line already SAYS "ended 06 Jul 2026, not counted",
           in words, which is the only signal that survives a photocopy, a
           black-and-white printer or a fax. Nothing is lost by dropping the
           colour; the page just reads as a document again. */
        .entry.flagged .workings { color:#8a6d3b; }

        .line { display:flex; align-items:baseline; gap:10px; padding:5px 0 4px;
                break-inside:avoid; }
        .entry:not(:last-of-type) .workings { border-bottom:1px solid #eee; }
        /* The name takes what it needs and the leader takes the rest, not
           the other way around — a name given flex:1 pushed the dots down
           to their min-width and the leader never appeared. */
        .line .name { flex:0 1 auto; font-weight:600; }
        /* Leaders, so the eye tracks from a short company name to a
           right-aligned figure without a ruler. */
        .line .dots { flex:1 1 auto; min-width:12px; border-bottom:1px dotted #ccc;
                      transform:translateY(-3px); }
        .line .amt { font-variant-numeric:tabular-nums; white-space:nowrap; font-weight:600; }

        .workings { margin:0 0 2px; padding:0 0 3px; color:#777; font-size:10px; }
        .workings .sep { color:#bbb; padding:0 4px; }

        .total { display:flex; align-items:baseline; gap:10px; margin-top:8px;
                 padding-top:7px; border-top:1.5px solid #111; font-weight:700; }
        .total .name { flex:1; text-transform:uppercase; font-size:11px; letter-spacing:.05em; }
        .total .amt { font-variant-numeric:tabular-nums; white-space:nowrap; }


        @media print {
          /* Portrait. Landscape suited the master-sheet shape, which has
             thirty columns; this document has two and read as a thin
             strip of text across a wide empty page. */
          @page { size:A4 portrait; margin:15mm 14mm; }
          .print-page { padding:0; max-width:none; font-size:10.5px; }
          .no-print { display:none; }
          /* A person is kept whole where they fit, but not by forbidding a
             break outright —
             somebody with thirty companies has to be allowed to break, or
             they would push a mostly blank page ahead of themselves. */
          .person { break-inside:auto; }
          .person h2 { break-after:avoid; }
          .pay { break-after:avoid; }
          .line, .workings { break-inside:avoid; }
          .total { break-before:avoid; }
          /* A heading must never be the last thing on a page. Both of
             these were landing at the foot with their content overleaf. */
          .group > h2, .group .person h3 { break-after:avoid; }
          .subtotal, .group-total { break-before:avoid; }
        }
      `}</style>

      <Button variant="secondary" size="sm" className="no-print mb-4" onClick={() => window.print()}>
        Print again
      </Button>

      <h1>{title}</h1>
      <p className="meta">
        {people.length} {people.length === 1 ? 'person' : 'people'} · {rows.length}{' '}
        {rows.length === 1 ? 'company' : 'companies handled'} ·{' '}
        {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>

      {/* The shape switches come back with the rows rather than being read
          off the URL here, so this page and the spreadsheet are drawing
          from one reader (layoutOptions in v1/export.js) instead of two
          that can disagree. Templates that have no shape to choose ignore
          the prop. */}
      <Template people={people} layout={data?.layout} />

      {/* NO GRAND TOTAL. The last group's own total is the end of the
          document, which is the figure somebody signs.

          It was also wrong. This summed every row, ended ones included,
          while each group total excluded them — so MILKMAN printed
          £14,782.25 and the line beneath it said £19,282.25, the
          difference being exactly the £4,500 of finished deals the group
          had just declared as not counted. Two totals for one page, one of
          them contradicting the note right above it. */}
    </div>
  );
}
