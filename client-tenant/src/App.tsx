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
import { PropertyList } from '@/pages/discover/PropertyList';
import { PropertyDetail } from '@/pages/discover/PropertyDetail';
import { getToken } from '@/api/client';

function RootRedirect() {
  return <Navigate to={getToken() ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/discover" element={<PropertyList />} />
      <Route path="/property/:slug" element={<PropertyDetail />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-pending" element={<VerifyPending />} />

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
