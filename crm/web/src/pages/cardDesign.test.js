import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('company cards expose identity, money, tier and handler action in scan order', () => {
  const page = read('./CompaniesPage.jsx');
  const card = read('../components/display/RecordCard.jsx');

  assert.match(page, /icon=\{BuildingIcon\}/);
  assert.match(page, /label="Tier"/);
  assert.match(page, /leadLabel="Monthly"/);
  assert.match(card, /body/);
  assert.match(card, /bg-surface-sunken/);
  assert.match(page, />\s*Manage\s*</);
  assert.doesNotMatch(page, /Manage handlers/);
  // ===============================
  // * A CARD'S ONE ACTION IS GREEN
  // ===============================
  // `quiet` is transparent with muted ink, so on a card that is already a
  // click target the button read as a caption. And the card and the table
  // row are the same action, so they wear the same colour: one button
  // reading two ways depending on the view toggle is worse than either.
  const people = read('./PeoplePage.jsx');
  assert.equal(
    (page.match(/<Button variant="primary"[^>]*onClick=\{\(\) => onOpen\(company\)\}/g) ?? []).length,
    2, 'both Manage buttons are green, the card and the row',
  );
  assert.equal(
    (people.match(/<Button variant="primary" onClick=\{\(\) => onManage\(person\.person_id\)\}/g) ?? []).length,
    2, 'both Manage buttons are green, the card and the row',
  );
  // ===============================
  // * MANAGE, AND THE ICON SAYS WHICH WAY ROUND
  // ===============================
  // It opens ManagePersonModal, and on screen a person has COMPANIES.
  // "Assign" was also the dead word from the dropped assignments table.
  // The company's Manage keeps UsersIcon, because a company has HANDLERS.
  assert.equal((people.match(/<BuildingIcon width=\{15\} height=\{15\} \/>\s*Manage/g) ?? []).length, 2);
  assert.doesNotMatch(people, />\s*Assign\s*</, 'the button is Manage on the card and on the row');
  assert.equal((page.match(/<UsersIcon width=\{14\} height=\{14\} \/>\s*Manage/g) ?? []).length, 2);
  assert.match(card, /text-sm font-semibold leading-5/);
  assert.match(card, /text-xs text-text/);
  assert.match(page, /<Select[\s\S]*?label="Tier"[\s\S]*?size="detail"/);
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

  assert.match(page, /<LinkButton[^>]*size="md"[^>]*>[\s\S]*?<LogsIcon/);
  assert.match(page, /icon=\{TrashIcon\}/);
  assert.match(page, /<Button variant="danger" size="md"/);
});

test('pagination uses visible secondary buttons instead of transparent quiet actions', () => {
  const pagination = read('../components/layout/Pagination.jsx');
  const button = read('../components/buttons/Button.jsx');

  assert.match(pagination, /<Button variant="secondary"/);
  assert.doesNotMatch(pagination, /<Button variant="quiet"/);
  assert.match(button, /secondary:\s*'bg-surface[^']*border-border-strong[^']*shadow-sm/);
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
