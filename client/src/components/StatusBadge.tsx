// Dot + tint badges: a soft 50-level tint, hairline inset ring, and a solid
// 500-level dot that stays stable across themes (the scales flip around 500).
// Tones are full literal class strings so the Tailwind JIT sees them.
const TONES = {
  gray: 'bg-gray-100 text-gray-600 ring-gray-300/50',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200/60',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-200/60',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  red: 'bg-red-50 text-red-700 ring-red-200/60',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200/60',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200/60',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60',
} as const;

const DOTS: Record<keyof typeof TONES, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-500',
  sky: 'bg-sky-500',
  yellow: 'bg-yellow-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
};

const STATUS_TONES: Record<string, keyof typeof TONES> = {
  draft: 'gray',
  submitted: 'blue',
  awaiting_identity: 'sky',
  screening: 'yellow',
  screening_review: 'amber',
  screening_passed: 'emerald',
  screening_failed: 'red',
  could_not_screen: 'orange',
  tier1_review: 'amber',
  tier1_approved: 'emerald',
  tier1_denied: 'red',
  tier2_review: 'amber',
  tier2_approved: 'emerald',
  tier2_denied: 'red',
  tier3_review: 'amber',
  tier3_approved: 'emerald',
  tier3_denied: 'red',
  lease_generated: 'purple',
  lease_signed: 'purple',
  onboarded: 'emerald',
  cancelled: 'gray',
  pass: 'emerald',
  fail: 'red',
  review_required: 'yellow',
  active: 'emerald',
  inactive: 'gray',
  // Maintenance work-order priorities (work_order_priority enum)
  emergency: 'red',
  urgent: 'amber',
  routine: 'blue',
  low: 'gray',
  // Maintenance work-order lifecycle (work_order_status enum)
  assigned: 'blue',
  in_progress: 'amber',
  completed: 'emerald',
  // Waitlist / generic outcomes
  waitlisted: 'indigo',
  pending: 'yellow',
  approved: 'emerald',
  denied: 'red',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  // Some rows carry a null status (e.g. a screening check that never ran on a
  // cancelled application). Render a neutral dash rather than crashing the page.
  const safe = status ?? '';
  const tone = STATUS_TONES[safe] || 'gray';
  const label = safe ? safe.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} aria-hidden="true" />
      {label}
    </span>
  );
}
