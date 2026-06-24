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
  Landmark,
  Megaphone,
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
  /** Small-caps section heading; `null` for the ungrouped top item(s). */
  label: string | null;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard, minRole: 'leasing_agent' },
      // Unified ops rollup for managers (KPIs + attention + property snapshot).
      // Senior+ to match the manager_briefing:view permission on the API.
      { label: 'Manager Briefing', path: '/manager-briefing', icon: Megaphone, minRole: 'senior_manager' },
      // Showcase view — agents are property-scoped (often to zero properties in
      // the demo seed), so an empty showcase would undercut it; managers and up.
      { label: 'The Ledger', path: '/the-ledger', icon: Landmark, minRole: 'senior_manager' },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { label: 'Applications', path: '/applications', icon: FileText, minRole: 'leasing_agent' },
      { label: 'Screening', path: '/screening', icon: Search, minRole: 'senior_manager' },
      { label: 'Approvals', path: '/approvals', icon: CheckCircle, minRole: 'senior_manager' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Rent Ledger', path: '/ledger', icon: DollarSign, minRole: 'leasing_agent' },
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
    label: 'Governance',
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

  // Role-filter each section; sections with no visible items disappear entirely.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasMinRole(user.role, item.minRole)),
  })).filter((group) => group.items.length > 0);

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
      <div className={`flex h-16 items-center gap-3 border-b border-gray-200 px-5 ${collapseHeaderPad}`}>
        {/* Seal-like double-ring mark. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 p-[3px]">
          <div className="flex h-full w-full items-center justify-center rounded-full border border-brand-700">
            <Building2 className="h-4 w-4 text-brand-700" />
          </div>
        </div>
        <div className={collapseLabel}>
          <p className="font-serif text-lg font-bold leading-tight text-gray-900">CDPC</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
            Compliance Hub
          </p>
        </div>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`}>
            {group.label && (
              <>
                <p
                  className={`px-3 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 ${collapseLabel}`}
                >
                  {group.label}
                </p>
                {/* Collapsed rail: a hairline rule stands in for the heading. */}
                {collapsed && (
                  <div className="mx-2 mb-2 mt-3 hidden border-t border-gray-200 md:block" aria-hidden="true" />
                )}
              </>
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
                    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${collapseItemPad} ${
                      isActive
                        ? 'bg-brand-50 font-semibold text-brand-800'
                        : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className={collapseLabel}>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-gray-200 px-5 py-4">
        <div className={collapseLabel}>
          <p className="font-serif text-sm font-semibold text-gray-700">CDPC Nevada</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-400">
            In Public Trust
          </p>
        </div>
      </div>
    </aside>
  );
}
