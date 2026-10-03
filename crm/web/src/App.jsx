import { Routes, Route, Navigate } from 'react-router-dom';
import LoginForm from './components/auth/LoginForm';
import RequireAuth from './components/auth/RequireAuth';
import RedirectIfAuthed from './components/auth/RedirectIfAuthed';
import Layout from './components/layout/Layout';
import PeoplePage from './pages/PeoplePage';
import PersonDetailPage from './pages/PersonDetailPage';
import CompaniesPage from './pages/CompaniesPage';
import CompanyDetailPage from './pages/CompanyDetailPage';
import ExportPrintPage from './pages/ExportPrintPage';
import ExpensesPage from './pages/ExpensesPage';
import FlaggedPage from './pages/FlaggedPage';
import ChatPage from './pages/ChatPage';
import MasterSheetPage from './pages/MasterSheetPage';
import ReviewPage from './pages/ReviewPage';
import ArchivePage from './pages/ArchivePage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import LogsPage from './pages/LogsPage';
import DashboardPage from './pages/DashboardPage';
import DeadPersonDetailPage from './pages/DeadPersonDetailPage';
// TEMPORARY, removed once the orb is approved.
import OrbTestPage from './pages/OrbTestPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><LoginForm /></RedirectIfAuthed>} />
      {/* Deliberately outside <Layout> — a sidebar in a printed PDF is
          exactly the kind of thing nobody notices until it prints. */}
      <Route path="/export/print" element={<RequireAuth><ExportPrintPage /></RequireAuth>} />
      <Route path="/orb-test" element={<RequireAuth><OrbTestPage /></RequireAuth>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:personId" element={<PersonDetailPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="companies/:key" element={<CompanyDetailPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="flagged" element={<FlaggedPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="master-sheet" element={<MasterSheetPage />} />
        {/* Is this deal still running? A page, not a modal: see ReviewPage. */}
        <Route path="review" element={<ReviewPage />} />
        {/* The same rows read as history. See ArchivePage. */}
        <Route path="archive" element={<ArchivePage />} />
        <Route path="archive/people/:personId" element={<DeadPersonDetailPage />} />
        {/* Every edit in the CRM, and the Undo for it. */}
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="logs" element={<LogsPage />} />
      </Route>
    </Routes>
  );
}
