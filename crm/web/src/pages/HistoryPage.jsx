import PageHeader from '../components/layout/PageHeader';
import HistoryList from '../components/history/HistoryList';

/**
 * ***************************************************
 * * THE HISTORY, UNSCOPED. Everything that changed, and Undo.
 * ***************************************************
 *
 * His call 2026-09-29. It was a button on Settings and another on the
 * review screen, so the safety net for every edit in the CRM was two clicks
 * deep behind a page about themes. It is reached from ONE place now, the
 * account menu behind the avatar (configs/navigation's ADMIN_MENU), beside
 * Settings, because it is the same kind of thing: not a view of the money,
 * a control over what has been done to it.
 *
 * NO FILTERS HERE ON PURPOSE. Scoping is what the modal is for, and every
 * place that has a scope already opens it: a person, a company, one deal,
 * or the review's own field. This is the list nothing has narrowed.
 */
export default function HistoryPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="History" subtitle="Every change made in the last 7 days" />
      <HistoryList />
    </div>
  );
}
