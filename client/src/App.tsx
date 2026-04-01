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
import { ApplicationForm } from '@/pages/ApplicationForm';
import { ApplicationDetail } from '@/pages/ApplicationDetail';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
              <Route path="properties" element={<Properties />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="compliance" element={<Compliance />} />
              <Route path="audit-log" element={<AuditLog />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
