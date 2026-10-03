import Breakdown from './Breakdown';
import PeopleCards from './PeopleCards';
import Summary from './Summary';
import MonthlySheet from './MonthlySheet';

/**
 * The PDF templates an admin can pick in the Export modal.
 *
 * Same contract as the xlsx registry (v1/templates/xlsx/index.js): a
 * template is a LAYOUT, never a filter. Which rows are in the export is
 * already decided before one of these is asked to render.
 *
 * WHY THESE LIVE IN crm/web AND THE XLSX ONES LIVE IN crm/api.
 * The PDF is print-styled HTML the browser turns into a PDF, so its
 * templates are React and can only run here; the xlsx is built with
 * ExcelJS and can only run there. api and web are separately deployed and
 * share no filesystem, so each template sits with the code that renders
 * it. One shared folder would couple the two deploys for no gain.
 *
 * Adding one:
 *   1. a component here taking { people } and returning sections
 *   2. add it to TEMPLATES below
 * The print CSS on ExportPrintPage governs the SHEET (margins, page
 * breaks); a template only decides what goes on it. Reuse the existing
 * class names — `person`, `entry`, `line`, `workings`, `total` — and the
 * page styles it for you.
 *
 * A template whose layout those classes cannot express carries its own
 * <style> and its own class names (PeopleCards does). Widening the page's
 * rules instead would change every other template with them, and the
 * breakdown is what a person's own Export button prints.
 *
 * `id` crosses the wire as ?template=. Never rename one in place: a saved
 * link would silently switch layout.
 */
const TEMPLATES = [
  {
    id: 'breakdown',
    label: 'Breakdown',
    description: 'One section per person: every company they handle, the workings, and how to pay them.',
    Component: Breakdown,
  },
  {
    id: 'people-cards',
    label: 'Cards',
    description: 'The same as Breakdown, two people to a row as bordered cards. What the People page exports.',
    Component: PeopleCards,
  },
  {
    id: 'summary',
    label: 'Summary',
    description: 'One block per group, one line per person, totals only. No bank details. For sign-off.',
    Component: Summary,
  },
  {
    id: 'monthly-sheet',
    label: 'Sheet for a month',
    description: 'One block per group, one line per deal, with the arithmetic and group totals. The run, checked line by line.',
    Component: MonthlySheet,
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** The default: the layout the print page has always produced. */
export const DEFAULT_ID = 'breakdown';

/** What the Export modal lists. Metadata only, never the component. */
export function listTemplates() {
  return TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
}

/**
 * Resolve an id, falling back rather than rendering nothing. An unknown id
 * means an old link or a typo, and a blank page is a worse answer than the
 * usual layout.
 */
export function templateFor(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ID);
}
