import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { formatRole } from '@/types';

export function Layout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true'
  );

  const toggleSidebar = () =>
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar collapsed={collapsed} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4">
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
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
