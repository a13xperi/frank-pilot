import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { Apply } from '@/pages/Apply';
import { AuthCallback } from '@/pages/AuthCallback';
import { VerifyPending } from '@/pages/VerifyPending';
import { Dashboard } from '@/pages/Dashboard';
import { Pay } from '@/pages/Pay';
import { Ledger } from '@/pages/Ledger';
import { Maintenance } from '@/pages/Maintenance';
import { Status } from '@/pages/Status';
import { Application } from '@/pages/Application';
import { WelcomeShell } from '@/pages/welcome/WelcomeShell';
import { PropertyList } from '@/pages/discover/PropertyList';
import { PropertyDetail } from '@/pages/discover/PropertyDetail';
import { WaitlistPosition } from '@/pages/waitlist/Position';
import { WaitlistFasterList } from '@/pages/waitlist/FasterList';
import { MagicLinkSent } from '@/pages/apply/MagicLinkSent';
import { getToken } from '@/api/client';

function RootRedirect() {
  return <Navigate to={getToken() ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<WelcomeShell />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/apply/magic-link-sent" element={<MagicLinkSent />} />
      <Route path="/discover" element={<PropertyList />} />
      <Route path="/property/:slug" element={<PropertyDetail />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-pending" element={<VerifyPending />} />

      {/* BP-03b — waitlist screens (public; carrot pulls applicant back into flow) */}
      <Route path="/waitlist/position" element={<WaitlistPosition />} />
      <Route path="/waitlist/position/:slug" element={<WaitlistPosition />} />
      <Route path="/waitlist/faster-list" element={<WaitlistFasterList />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/application" element={<Application />} />
          <Route path="/pay" element={<Pay />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/status" element={<Status />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
