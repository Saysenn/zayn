import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('person and company details give their record tables the full page width', () => {
  const layout = read('../components/layout/DetailLayout.jsx');
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');

  assert.match(layout, /xl:grid-cols-4/);
  assert.match(layout, /xl:col-span-4/);
  assert.match(person, /overview=\{/);
  assert.match(person, /records=\{/);
  assert.match(person, /supporting=\{/);
  assert.match(company, /overview=\{/);
  assert.match(company, /records=\{/);
});

test('detail tables use the denser type and width', () => {
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');

  assert.match(person, /min-w-\[900px\] text-xs/);
  assert.match(company, /min-w-\[900px\] text-xs/);
});

test('detail inputs and dropdowns share the Name field type size', () => {
  const select = read('../components/forms/Select.jsx');
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');

  assert.match(select, /size === 'detail'[\s\S]*?text-xs/);
  // Status is not a Select any more: it is CompanyStatusPicker, a row of
  // five. The two below are still dropdowns and still carry the size.
  assert.match(company, /label="Tier"[\s\S]*?size="detail"/);
  assert.match(company, /label="Old group"[\s\S]*?size="detail"/);
  assert.match(person, /label=\{label\}[\s\S]*?size="detail"/);
});

test('editable detail controls use floating labels', () => {
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');
  const percent = read('../components/forms/PercentField.jsx');

  assert.doesNotMatch(company, /<Field label=/);
  assert.match(company, /<NameField label="Name"/);
  /**
   * STATUS IS THE ONE EXEMPTION, and it is a shape exemption, not a style
   * one. A floating label needs a box to float into; a row of five radios
   * has none, so the picker carries its own small caption. Everything that
   * IS a box on this page still floats.
   */
  assert.match(company, /<CompanyStatusPicker/);
  assert.match(
    read('../components/modals/CompanyStatusPicker.jsx'),
    /text-xs font-semibold text-text-muted">Status</,
  );
  assert.match(person, /<FloatingField[\s\S]*?label=\{label\}/);
  assert.match(percent, /<FloatingField[\s\S]*?label=\{label\}/);
});

test('people supporting details come before the full width companies table', () => {
  const layout = read('../components/layout/DetailLayout.jsx');

  assert.ok(layout.indexOf('{supporting &&') < layout.indexOf('{records &&'));
});

test('breakdown cards use the shared highlighted surface', () => {
  const layout = read('../components/layout/DetailLayout.jsx');
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');

  assert.match(layout, /highlighted/);
  // UI pass, 2026-10: a thin card at most shadow-sm, and `highlighted` is a
  // TINTED header with accent ink, never a solid accent fill.
  assert.match(layout, /border border-border bg-surface shadow-sm/);
  assert.match(layout, /highlighted \? 'border-border bg-accent-tint\/50'/);
  assert.match(layout, /highlighted \? 'text-accent-strong'/);
  assert.doesNotMatch(layout, /bg-accent['\s]/, 'no solid accent header');
  assert.match(person, /<DetailCard title="Breakdown" highlighted>/);
  assert.match(company, /<DetailCard title="Breakdown" highlighted>/);
});

test('percentage labels stay on one line and fields use the available width', () => {
  const percent = read('../components/forms/PercentField.jsx');

  assert.match(percent, /className="min-w-0 flex-1"/);
  assert.match(percent, /labelClassName="whitespace-nowrap"/);
});

test('percentage fields block negative typed and pasted values', () => {
  const percent = read('../components/forms/PercentField.jsx');

  assert.match(percent, /Number\(next\) >= 0/);
  assert.match(percent, /e\.key === '-'/);
});

test('company details do not show a close company button', () => {
  const company = read('./CompanyDetailPage.jsx');

  assert.doesNotMatch(company, /<ArchiveIcon/);
  assert.doesNotMatch(company, /action=\{\(/);
});

test('person history follows that person and their deals only', () => {
  const person = read('./PersonDetailPage.jsx');
  const company = read('./CompanyDetailPage.jsx');
  // The list is its own component now: the modal is one frame around it and
  // the History page is the other. The scope has to survive both hops.
  const modal = read('../components/modals/HistoryModal.jsx');
  const list = read('../components/history/HistoryList.jsx');

  assert.match(person, /<HistoryModal[\s\S]*?personId=\{personId\}/);
  assert.match(company, /<HistoryModal[\s\S]*?company=\{company\.name\}/);
  assert.match(modal, /<HistoryList[\s\S]*?personId=\{personId\}[\s\S]*?company=\{company\}/);
  assert.match(list, /apiService\.history\.list\(\{[\s\S]*?personId,[\s\S]*?company,/);
});

test('and the unscoped page passes no scope at all', () => {
  // The whole point of it: every edit in the CRM, narrowed by nothing.
  // A stray prop here is a page quietly showing one person's history.
  const page = read('./HistoryPage.jsx');
  assert.match(page, /<HistoryList \/>/);
});

test('person details hide the export action', () => {
  const person = read('./PersonDetailPage.jsx');

  assert.doesNotMatch(person, /openPrint/);
  assert.doesNotMatch(person, /BREAKDOWN_PRESET/);
  assert.doesNotMatch(person, />\s*Export\s*</);
});

test('floating labels stay inside their field layer below the command center', () => {
  const styles = read('../index.css');
  const commandCenter = read('../components/agentOrb/AgentOverlay.jsx');

  assert.match(styles, /\.floating-field-label[\s\S]*?z-\[1\]/);
  assert.doesNotMatch(styles, /\.floating-field-label[\s\S]*?z-\[41\]/);
  assert.match(commandCenter, /fixed inset-0 z-30/);
});
