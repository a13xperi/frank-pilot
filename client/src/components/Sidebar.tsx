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

interface NavGroup {
  /** Small uppercase section label; null = ungrouped items at the top. */
  heading: string | null;
  items: NavItem[];
}

// Same routes, roles, and icons as before — grouping is purely presentational.
const NAV_GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, minRole: 'leasing_agent' },
    ],
  },
  {
    heading: 'Pipeline',
    items: [
      { label: 'Applications', path: '/applications', icon: FileText, minRole: 'leasing_agent' },
      { label: 'Screening', path: '/screening', icon: Search, minRole: 'senior_manager' },
      { label: 'Approvals', path: '/approvals', icon: CheckCircle, minRole: 'senior_manager' },
      { label: 'Ledger', path: '/ledger', icon: DollarSign, minRole: 'leasing_agent' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { label: 'Properties', path: '/properties', icon: Building2, minRole: 'leasing_agent' },
      { label: 'Users', path: '/users', icon: Users, minRole: 'senior_manager' },
      { label: 'Inspections', path: '/inspections', icon: ClipboardCheck, minRole: 'leasing_agent' },
      { label: 'Maintenance', path: '/maintenance', icon: Wrench, minRole: 'leasing_agent' },
      { label: 'Renewals', path: '/renewals', icon: RefreshCw, minRole: 'senior_manager' },
      { label: 'Move-Outs', path: '/moveouts', icon: LogOut, minRole: 'senior_manager' },
      { label: 'Evictions', path: '/evictions', icon: Gavel, minRole: 'senior_manager' },
      { label: 'Recertifications', path: '/recertifications', icon: CalendarClock, minRole: 'senior_manager' },
    ],
  },
  {
    heading: 'Governance',
    items: [
      { label: 'Compliance', path: '/compliance', icon: Shield, minRole: 'regional_manager' },
      { label: 'Audit Log', path: '/audit-log', icon: ScrollText, minRole: 'regional_manager' },
      { label: 'QA Bundles', path: '/qa-bundles', icon: Camera, minRole: 'regional_manager' },
    ],
  },
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

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasMinRole(user.role, item.minRole)),
  })).filter((group) => group.items.length > 0);

  // `collapsed` is a desktop affordance only (md+). On mobile the drawer is
  // always full-width when open, so collapse-driven label hiding / icon
  // centering is gated behind `md:`.
  const collapseRail = collapsed ? 'md:w-16' : 'md:w-64';
  const collapseLabel = collapsed ? 'md:hidden' : '';
  const collapseItemPad = collapsed ? 'md:justify-center md:px-0' : 'md:px-2.5';
  const collapseHeaderPad = collapsed ? 'md:justify-center md:px-0' : 'md:px-5';

  return (
    <aside
      ref={asideRef}
      id="primary-nav-drawer"
      className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${collapseRail} ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-gray-200 px-5 ${collapseHeaderPad}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 shadow-btn-primary">
          <Building2 className="h-[18px] w-[18px] text-white" />
        </span>
        <span className={`leading-tight ${collapseLabel}`}>
          <span className="block text-sm font-semibold tracking-tight text-gray-900">CDPC Hub</span>
          <span className="block text-2xs font-medium uppercase text-gray-400">Compliance</span>
        </span>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {visibleGroups.map((group, gi) => (
          <div key={group.heading ?? '__top'}>
            {group.heading ? (
              <>
                <p
                  className={`px-2.5 pb-1.5 pt-5 text-2xs font-semibold uppercase text-gray-400 ${collapseLabel}`}
                >
                  {group.heading}
                </p>
                {/* Collapsed rail: a hairline stands in for the hidden label. */}
                {collapsed && <div className="mx-3 my-2 hidden border-t border-gray-200 md:block" />}
              </>
            ) : (
              gi > 0 && <div className="my-2" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  title={collapsed ? item.label : undefined}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-13 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${collapseItemPad} ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 before:absolute before:bottom-[7px] before:left-0 before:top-[7px] before:w-[3px] before:rounded-full before:bg-brand-600'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          isActive ? 'text-brand-600' : 'text-gray-400'
                        }`}
                      />
                      <span className={collapseLabel}>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-gray-200 px-5 py-3.5">
        <p className={`text-2xs font-medium uppercase text-gray-400 ${collapseLabel}`}>
          CDPC Nevada
        </p>
      </div>
    </aside>
  );
}
