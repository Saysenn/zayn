const { buildBreakdownWorkbook } = require('../../masterSheet/buildBreakdown');

// Past this many people, one tab each stops being navigable and the sheet
// is better as one long sectioned page. Same threshold the export route
// has always used; it lives here now so the template owns its own layout
// decision rather than the route guessing on its behalf.
const MAX_TABS = 12;

/**
 * What each person earns this month: their companies listed under them,
 * the arithmetic shown, their bank details, and a total per currency.
 *
 * The shape you hand someone to explain a figure, where the master sheet
 * is the shape you hand someone to work from. A single-person export is
 * always this one — the whole sheet filtered to one name answers nothing.
 *
 * Thin on purpose; the layout lives in buildBreakdown.js.
 */
module.exports = {
  id: 'breakdown',
  label: 'Breakdown',
  fileLabel: 'BREAKDOWN',
  description: 'Grouped by person, each company under them with the workings and a total. What you send to explain a figure.',
  build: (rows) => buildBreakdownWorkbook(rows, {
    splitByPerson: new Set(rows.map((r) => r.person_id)).size <= MAX_TABS,
  }),
};
