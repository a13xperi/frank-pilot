import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Applications } from '@/pages/Applications';
import { Screening } from '@/pages/Screening';
import { Approvals } from '@/pages/Approvals';
import { Properties } from '@/pages/Properties';
import { UsersPage } from '@/pages/Users';
import { Compliance } from '@/pages/Compliance';
import { AuditLog } from '@/pages/AuditLog';
import { QaBundles } from '@/pages/QaBundles';
import { QaBundleDetail } from '@/pages/QaBundleDetail';
import { DemoSessionDetail } from '@/pages/DemoSessionDetail';
import { Recertifications } from '@/pages/Recertifications';
import { LedgerOverview, LedgerDetail } from '@/pages/Ledger';
import { TheLedger } from '@/pages/TheLedger';
import { Evictions } from '@/pages/Evictions';
import { Renewals } from '@/pages/Renewals';
import { MoveOuts } from '@/pages/MoveOuts';
import { InspectionsPage } from '@/pages/Inspections';
import { MaintenancePage } from '@/pages/Maintenance';
import { ApplicationForm } from '@/pages/ApplicationForm';
import { ApplicationDetail } from '@/pages/ApplicationDetail';
import { DemoOverlay } from '@/components/DemoOverlay';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <DemoOverlay />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="applications" element={<Applications />} />
              <Route path="applications/new" element={<ApplicationForm />} />
              <Route path="applications/:id" element={<ApplicationDetail />} />
              <Route path="screening" element={<Screening />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="the-ledger" element={<TheLedger />} />
              <Route path="ledger" element={<LedgerOverview />} />
              <Route path="ledger/:applicationId" element={<LedgerDetail />} />
              <Route path="inspections" element={<InspectionsPage />} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route path="evictions" element={<Evictions />} />
              <Route path="renewals" element={<Renewals />} />
              <Route path="moveouts" element={<MoveOuts />} />
              <Route path="properties" element={<Properties />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="recertifications" element={<Recertifications />} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="audit-log" element={<AuditLog />} />
              <Route path="qa-bundles" element={<QaBundles />} />
              <Route path="qa-bundles/demo/:runId" element={<DemoSessionDetail />} />
              <Route path="qa-bundles/:stem" element={<QaBundleDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
