import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LogOut, Menu, PanelLeft } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { formatRole } from '@/types';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true'
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () =>
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });

  const closeMobile = () => setMobileOpen(false);

  // Close the drawer whenever the route changes (it also closes on nav click,
  // but this covers programmatic navigation too).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Escape closes the mobile drawer, matching the Modal affordance.
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Thin civic accent bar — the institution's mark at the very top. */}
      <div className="h-[3px] shrink-0 bg-brand-700" aria-hidden="true" />
      <div className="flex flex-1 overflow-hidden">
        {/* Overlay behind the drawer — mobile only. */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={closeMobile}
          />
        )}
        <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onClose={closeMobile} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
            {/* Mobile: open the off-canvas drawer. */}
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="primary-nav-drawer"
              className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Desktop: collapse / expand the static rail. */}
            <button
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="hidden h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:flex"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              {user && (
                <>
                  <span className="hidden text-sm text-gray-700 sm:inline">
                    {user.firstName} {user.lastName}
                  </span>
                  <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                    {formatRole(user.role)}
                  </span>
                </>
              )}
              <button
                onClick={logout}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </header>
          <main className="flex flex-1 flex-col overflow-auto">
            <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-10">
              <Outlet />
            </div>
            {/* Formal institutional footer. */}
            <footer className="border-t border-gray-200 px-4 py-5 sm:px-8">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="font-serif text-sm font-semibold tracking-wide text-gray-700">
                  CDPC Nevada
                </p>
                <p className="text-xs text-gray-500">
                  Affordable Housing Compliance &middot; Equal Housing Opportunity
                </p>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
