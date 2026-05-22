import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  DollarSign,
  Wrench,
  Receipt,
  FileText,
  LogOut,
  Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clearToken } from '@/api/client';
import { HF } from '@/styles/tokens';

const navItems = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/application', label: 'My Application', icon: FileText },
  { to: '/pay', label: 'Pay', icon: DollarSign },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/ledger', label: 'Ledger', icon: Receipt },
];

const mobileNavItems = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/application', label: 'App', icon: FileText },
  { to: '/pay', label: 'Pay', icon: DollarSign },
  { to: '/maintenance', label: 'Repairs', icon: Wrench },
  { to: '/ledger', label: 'Ledger', icon: Receipt },
];

export function Layout() {
  const navigate = useNavigate();
  const { t } = useTranslation('settings');

  function handleLogout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 hidden w-64 flex-col md:flex"
        style={{
          background: HF.paper,
          borderRight: `1px solid ${HF.border}`,
        }}
      >
        <div
          className="flex h-16 items-center px-6"
          style={{ borderBottom: `1px solid ${HF.border}` }}
        >
          <span
            className="text-lg font-semibold"
            style={{ color: HF.accent, fontFamily: HF.display }}
          >
            Frank Pilot
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium transition"
              style={({ isActive }) => ({
                background: isActive ? HF.accentLo : 'transparent',
                color: isActive ? HF.accentInk : HF.ink2,
                borderRadius: HF.r.md,
              })}
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3" style={{ borderTop: `1px solid ${HF.border}` }}>
          <NavLink
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium transition"
            style={({ isActive }) => ({
              background: isActive ? HF.accentLo : 'transparent',
              color: isActive ? HF.accentInk : HF.ink2,
              borderRadius: HF.r.md,
            })}
          >
            <Settings className="h-5 w-5" />
            {t('nav.label')}
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm"
            style={{ color: HF.ink3, borderRadius: HF.r.md, marginTop: 4 }}
          >
            <LogOut className="h-5 w-5" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-h-screen flex-col md:pl-64">
        {/* Mobile top bar with logout */}
        <header
          className="sticky top-0 z-10 flex h-12 items-center justify-between px-4 md:hidden"
          style={{
            background: HF.paper,
            borderBottom: `1px solid ${HF.border}`,
          }}
        >
          <span
            className="text-base font-semibold"
            style={{ color: HF.accent, fontFamily: HF.display }}
          >
            Frank Pilot
          </span>
          <div className="flex items-center gap-3">
            <NavLink
              to="/settings"
              aria-label={t('nav.label')}
              className="flex items-center gap-1 text-xs font-medium"
              style={({ isActive }) => ({
                color: isActive ? HF.accent : HF.ink3,
              })}
            >
              <Settings className="h-4 w-4" />
              {t('nav.label')}
            </NavLink>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: HF.ink3 }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 md:hidden"
        style={{
          background: HF.paper,
          borderTop: `1px solid ${HF.border}`,
        }}
      >
        <div className="grid grid-cols-5">
          {mobileNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium"
              style={({ isActive }) => ({
                color: isActive ? HF.accent : HF.ink3,
              })}
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
