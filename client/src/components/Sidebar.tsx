import { useEffect, useRef } from 'react';
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

interface SidebarProps {
  /** Desktop-only width collapse (icons-only rail). Ignored below `md`. */
  collapsed?: boolean;
  /** Whether the off-canvas drawer is open (below `md`). */
  mobileOpen?: boolean;
  /** Close the mobile drawer (overlay click, nav, Escape). */
  onClose?: () => void;
}

export function Sidebar({ collapsed = false, mobileOpen = false, onClose }: SidebarProps) {
  const { user } = useAuth();
  const asideRef = useRef<HTMLElement>(null);
  // Remember what had focus before the drawer opened so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Focus management + trap — mobile drawer only (below `md`). The desktop rail
  // is a static, always-visible `md:` element; we never trap focus there. We
  // gate on a `(max-width)` media query so a stray `mobileOpen` at desktop width
  // can't hijack focus.
  useEffect(() => {
    const aside = asideRef.current;
    if (!mobileOpen || !aside) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(aside.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Move focus into the drawer.
    const first = getFocusable()[0];
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstEl || !aside.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !aside.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    aside.addEventListener('keydown', handleKeyDown);
    return () => {
      aside.removeEventListener('keydown', handleKeyDown);
      // Restore focus to whatever opened the drawer (the hamburger trigger).
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [mobileOpen]);

  if (!user) return null;

  const visible = NAV_ITEMS.filter((item) => hasMinRole(user.role, item.minRole));

  // `collapsed` is a desktop affordance only (md+). On mobile the drawer is
  // always full-width when open, so collapse-driven label hiding / icon
  // centering is gated behind `md:`.
  const collapseRail = collapsed ? 'md:w-16' : 'md:w-64';
  const collapseLabel = collapsed ? 'md:hidden' : '';
  const collapseItemPad = collapsed ? 'md:justify-center md:px-0' : 'md:px-3';
  const collapseHeaderPad = collapsed ? 'md:justify-center md:px-0' : 'md:px-6';

  return (
    <aside
      ref={asideRef}
      id="primary-nav-drawer"
      className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${collapseRail} ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className={`flex h-16 items-center gap-2.5 border-b border-gray-200 px-6 ${collapseHeaderPad}`}>
        <div className="shrink-0 rounded-lg bg-brand-100 p-1.5">
          <Building2 className="h-5 w-5 text-brand-700" />
        </div>
        <span className={`font-display text-lg font-semibold tracking-tight text-gray-900 ${collapseLabel}`}>CDPC Hub</span>
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            title={collapsed ? item.label : undefined}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${collapseItemPad} ${
                isActive
                  ? 'bg-brand-100 text-brand-800'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            <span className={collapseLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-200 p-4">
        <p className={`text-xs text-gray-400 ${collapseLabel}`}>CDPC Nevada</p>
      </div>
    </aside>
  );
}
