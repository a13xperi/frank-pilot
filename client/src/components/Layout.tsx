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
    <div className="flex h-screen bg-gray-50">
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
        <header className="flex h-12 items-center justify-between border-b border-gray-200 bg-white px-3 sm:px-4">
          {/* Mobile: open the off-canvas drawer. */}
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            aria-controls="primary-nav-drawer"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          {/* Desktop: collapse / expand the static rail. */}
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 md:flex"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && (
              <>
                <span className="hidden text-[13px] font-medium text-gray-700 sm:inline">
                  {user.firstName} {user.lastName}
                </span>
                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  {formatRole(user.role)}
                </span>
              </>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
