import { Route, Routes } from 'react-router';
import { ErrorView } from './components/room';
import { Layout } from './components/ui';
import { ApiError } from './api/client';
import { AdminPage } from './pages/AdminPage';
import { GroupPage } from './pages/GroupPage';
import { InvitePage } from './pages/InvitePage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';
import { MemberPage } from './pages/MemberPage';
import { TopPage } from './pages/TopPage';

export function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TopPage />} />
        <Route path="/r/:roomId/admin" element={<AdminPage />} />
        <Route path="/r/:roomId/i" element={<InvitePage />} />
        <Route path="/r/:roomId/m" element={<MemberPage />} />
        <Route path="/r/:roomId/g" element={<GroupPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<ErrorView error={new ApiError(404, 'not_found', '')} />} />
      </Routes>
    </Layout>
  );
}
