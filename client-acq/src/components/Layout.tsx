import { Outlet, NavLink } from 'react-router-dom';
import { LogOut, BarChart3, Building2, FolderKanban, Award, ClipboardList, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatRole } from '@/types';

// Acquisitions nav. Phase 1 ships Demand; Phase 2 adds Projects; Phase 3 adds
// Awards (the compliance bridge from won credits to designated units).
// Phase 3.1 adds Recertifications and the Compliance Queue (AUR/over-income).
const NAV = [
  { to: '/', label: 'Demand Evidence', icon: BarChart3, end: true },
  { to: '/projects', label: 'Candidate Projects', icon: FolderKanban, end: false },
  { to: '/awards', label: 'Awards', icon: Award, end: false },
  { to: '/recertifications', label: 'Recertifications', icon: ClipboardList, end: false },
  { to: '/compliance-queue', label: 'Compliance Queue', icon: ShieldAlert, end: false },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
          <Building2 className="h-6 w-6 text-emerald-600" />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-gray-900">CDPC Acquisitions</p>
            <p className="text-xs text-gray-400">LIHTC · Nevada 2026 QAP</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-end gap-4 border-b border-gray-200 bg-white px-6">
          {user && (
            <>
              <span className="text-sm text-gray-700">
                {user.firstName} {user.lastName}
              </span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                {formatRole(user.role)}
              </span>
            </>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
