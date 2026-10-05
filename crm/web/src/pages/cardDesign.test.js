import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('company cards expose identity, money, tier and handler action in scan order', () => {
  const page = read('./CompaniesPage.jsx');
  const card = read('../components/display/RecordCard.jsx');

  assert.match(page, /icon=\{BuildingIcon\}/);
  assert.match(page, /leadLabel="Monthly"/);
  assert.match(card, /body/);
  assert.match(card, /bg-surface-sunken/);
  // ===============================
  // * NO PER-ROW MANAGE ANY MORE: THE BULK BAR COVERS IT
  // ===============================
  // Set tier / status live on the bulk bar, and a person's companies are
  // edited on their own page. The rows and cards keep no Manage button.
  const people = read('./PeoplePage.jsx');
  assert.doesNotMatch(page, />\s*Manage\s*</);
  assert.doesNotMatch(page, /Manage handlers/);
  assert.doesNotMatch(people, />\s*Manage\s*</);
  assert.doesNotMatch(people, />\s*Assign\s*</);
  // The tier is plain text (Set tier is on the bar), a faint dash when unset.
  assert.doesNotMatch(page, /<Select[\s\S]*?label="Tier"/);
  assert.match(page, /label="Set tier"/);
  assert.match(page, /company\.tier \|\| <span className="text-text-faint">—<\/span>/);
  assert.match(card, /text-sm font-semibold leading-5/);
  assert.match(card, /text-xs text-text/);
  assert.doesNotMatch(page, /function CardActionField/);
  // ANY status that is not active, not just closed. There are four now
  // (migration 058), and the rule this pins is that a card badges a company
  // that is not trading normally; hardcoding 'closed' made liquidation and
  // dissolved render as Active, which is the column saying the opposite of
  // the truth. See configs/companyStatus.js.
  assert.match(page, /company\.status !== COMPANY_STATUS\.ACTIVE &&/);
  assert.match(page, /<StatusBadge status=\{company\.status\} \/>/);
  assert.doesNotMatch(page, /status=\{company\.status === 'closed' \? 'closed' : 'active'\}/);
});

test('flagged cards lead with the message instead of burying it as a fact', () => {
  const page = read('./FlaggedPage.jsx');

  assert.match(page, /icon=\{FlagIcon\}/);
  assert.match(page, /body=\{/);
  assert.doesNotMatch(page, /label: 'Latest message'/);
  assert.match(page, /<ClampedText[^>]*lines=\{2\}/);
  assert.doesNotMatch(page, /MESSAGE_PREVIEW_LIMIT/);
});

test('clamped card text reveals its full value only when two lines overflow', () => {
  const card = read('../components/display/RecordCard.jsx');

  assert.match(card, /export function ClampedText/);
  assert.match(card, /scrollHeight > node\.clientHeight/);
  assert.match(card, /clipped && <CellInfo/);
});

test('interactive cards lift and scale without changing border colour', () => {
  const card = read('../components/display/RecordCard.jsx');

  assert.match(card, /hover:shadow-lg/);
  assert.match(card, /hover:scale-\[1\.01\]/);
  assert.doesNotMatch(card, /hover:border-accent/);
});

// The tint with green ink, matching the reference design. Active and hover
// are separated by HUE now (green against a grey wash), not by weight.
test('both sidebars use the same tinted active state', () => {
  const layout = read('../components/layout/Layout.jsx');
  const settings = read('./SettingsPage.jsx');
  const styles = read('../configs/navigationStyles.js');

  assert.match(layout, /ACTIVE_NAV_CLASS/);
  assert.match(settings, /ACTIVE_NAV_CLASS/);
  assert.match(styles, /ACTIVE_NAV_CLASS =\s*\n?\s*'bg-accent-tint text-accent-strong/);
  assert.doesNotMatch(styles, /INACTIVE_NAV_CLASS =[\s\S]*?accent/);
  // The phone's bottom bar is the same nav, so it reads the same two states.
  assert.match(layout, /isActive \? ACTIVE_NAV_CLASS : INACTIVE_NAV_CLASS/);
});

test('settings actions use the shared button size and meaningful icons', () => {
  const page = read('./SettingsPage.jsx');

  // `sm`, the toolbar size: `md` is kept for a modal's main actions.
  assert.match(page, /<LinkButton[^>]*size="sm"[^>]*>[\s\S]*?<LogsIcon/);
  assert.match(page, /icon=\{TrashIcon\}/);
  assert.match(page, /<Button variant="danger" size="sm"/);
});

test('pagination uses visible secondary buttons instead of transparent quiet actions', () => {
  const pagination = read('../components/layout/Pagination.jsx');
  const button = read('../components/buttons/Button.jsx');

  assert.match(pagination, /<Button variant="secondary"/);
  assert.doesNotMatch(pagination, /<Button variant="quiet"/);
  // Still visibly a button (a surface and a border), just a thin one now.
  assert.match(button, /secondary:\s*'bg-surface[^']*border-border[ '][^']*'/);
  assert.match(button, /secondary:\s*'(?![^']*bg-transparent)/);
});

test('companies show sixteen cards or twenty five rows and pagination exposes the current destination', () => {
  const companies = read('./CompaniesPage.jsx');
  const pagination = read('../components/layout/Pagination.jsx');

  assert.match(companies, /const GRID_PAGE_SIZE = 16;/);
  assert.match(companies, /const ROW_PAGE_SIZE = 25;/);
  assert.match(companies, /const pageSize = view === 'grid' \? GRID_PAGE_SIZE : ROW_PAGE_SIZE;/);
  assert.match(companies, /onChange=\{changeView\}/);
  assert.match(companies, /setPage\(1\)/);
  assert.match(companies, /pageSize=\{pageSize\}/);
  assert.match(pagination, /paginationPages\(page, pageCount\)/);
  assert.match(pagination, /onPageChange\(item\)/);
  assert.match(pagination, /aria-current=\{item === page \? 'page' : undefined\}/);
});

test('people and companies ALWAYS OPEN AS THE LIST, with the grid a toggle away', () => {
  const people = read('./PeoplePage.jsx');
  const companies = read('./CompaniesPage.jsx');
  const toggle = read('../components/layout/ViewToggle.jsx');

  // His call 2026-09-30: list every time, not whichever view was used last.
  assert.match(people, /const \[view, setView\] = useState\('rows'\)/);
  assert.match(companies, /const \[view, setView\] = useState\('rows'\)/);
  assert.doesNotMatch(people, /views\.people/);
  assert.doesNotMatch(companies, /views\.companies/);
  assert.match(people, /<ViewToggle\s+value=\{view\}/);
  assert.match(companies, /<ViewToggle value=\{view\}/);
  assert.match(people, /view === 'grid'[\s\S]*?<CardList columns>/);
  assert.match(companies, /view === 'rows'[\s\S]*?table-wrap/);
  assert.match(toggle, /GridViewIcon/);
  assert.match(toggle, /RowsViewIcon/);
  assert.match(toggle, /aria-pressed/);
});

test('people grid is capped at sixteen cards without shrinking row view', () => {
  const people = read('./PeoplePage.jsx');

  assert.match(people, /const GRID_PAGE_SIZE = 16;/);
  assert.match(people, /const ROW_PAGE_SIZE = 25;/);
  assert.match(people, /const pageSize = view === 'grid' \? GRID_PAGE_SIZE : ROW_PAGE_SIZE;/);
  assert.match(people, /pageSize, page, filters, query/);
});

test('flagged ALWAYS OPENS AS THE LIST, sixteen cards and twenty rows', () => {
  const flagged = read('./FlaggedPage.jsx');

  assert.match(flagged, /const GRID_PAGE_SIZE = 16;/);
  assert.match(flagged, /const ROW_PAGE_SIZE = 20;/);
  assert.match(flagged, /const \[view, setView\] = useState\('rows'\)/);
  assert.doesNotMatch(flagged, /views\.flagged/);
  assert.match(flagged, /const pageSize = view === 'grid' \? GRID_PAGE_SIZE : ROW_PAGE_SIZE;/);
  assert.match(flagged, /<ViewToggle\s+value=\{view\}/);
  assert.match(flagged, /view === 'grid'[\s\S]*?<CardList columns>/);
  assert.match(flagged, /view === 'rows'[\s\S]*?table-wrap/);
  assert.match(flagged, /pageSize=\{pageSize\}/);
});
