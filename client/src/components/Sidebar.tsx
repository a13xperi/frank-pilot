import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Search,
  CheckCircle,
  Building2,
  Users,
  CalendarClock,
  DollarSign,
  Gavel,
  ClipboardCheck,
  Wrench,
  RefreshCw,
  LogOut,
  Shield,
  ScrollText,
  Camera,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasMinRole, type UserRole } from '@/types';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  minRole: UserRole;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, minRole: 'leasing_agent' },
  { label: 'Applications', path: '/applications', icon: FileText, minRole: 'leasing_agent' },
  { label: 'Screening', path: '/screening', icon: Search, minRole: 'senior_manager' },
  { label: 'Approvals', path: '/approvals', icon: CheckCircle, minRole: 'senior_manager' },
  { label: 'Ledger', path: '/ledger', icon: DollarSign, minRole: 'leasing_agent' },
  { label: 'Properties', path: '/properties', icon: Building2, minRole: 'leasing_agent' },
  { label: 'Users', path: '/users', icon: Users, minRole: 'senior_manager' },
  { label: 'Inspections', path: '/inspections', icon: ClipboardCheck, minRole: 'leasing_agent' },
  { label: 'Maintenance', path: '/maintenance', icon: Wrench, minRole: 'leasing_agent' },
  { label: 'Renewals', path: '/renewals', icon: RefreshCw, minRole: 'senior_manager' },
  { label: 'Move-Outs', path: '/moveouts', icon: LogOut, minRole: 'senior_manager' },
  { label: 'Evictions', path: '/evictions', icon: Gavel, minRole: 'senior_manager' },
  { label: 'Recertifications', path: '/recertifications', icon: CalendarClock, minRole: 'senior_manager' },
  { label: 'Compliance', path: '/compliance', icon: Shield, minRole: 'regional_manager' },
  { label: 'Audit Log', path: '/audit-log', icon: ScrollText, minRole: 'regional_manager' },
  { label: 'QA Bundles', path: '/qa-bundles', icon: Camera, minRole: 'regional_manager' },
];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  if (!user) return null;

  const visible = NAV_ITEMS.filter((item) => hasMinRole(user.role, item.minRole));

  return (
    <aside
      className={`flex h-full flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div
        className={`flex h-16 items-center gap-2 border-b border-gray-200 ${
          collapsed ? 'justify-center px-0' : 'px-6'
        }`}
      >
        <Building2 className="h-6 w-6 shrink-0 text-emerald-600" />
        {!collapsed && <span className="text-lg font-semibold text-gray-900">CDPC Hub</span>}
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-1 p-3">
        {visible.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-3'
              } ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-200 p-4">
        {!collapsed && <p className="text-xs text-gray-400">CDPC Nevada</p>}
      </div>
    </aside>
  );
}
