// MODERN OPS: status is the ONLY place color appears in the UI. Each badge is
// a hairline-bordered tint with a signal dot and an uppercase micro-label —
// the levels used (50/200/500/700) flip correctly in dark via the CSS vars.
const TONES: Record<string, { chip: string; dot: string }> = {
  gray: { chip: 'border-gray-200 bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  blue: { chip: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  sky: { chip: 'border-sky-200 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  yellow: { chip: 'border-yellow-200 bg-yellow-50 text-yellow-700', dot: 'bg-yellow-500' },
  amber: { chip: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  emerald: { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  red: { chip: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  orange: { chip: 'border-orange-200 bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  purple: { chip: 'border-purple-200 bg-purple-50 text-purple-700', dot: 'bg-purple-500' },
  indigo: { chip: 'border-indigo-200 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
};

const STATUS_TONE: Record<string, string> = {
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
  const tone = TONES[STATUS_TONE[safe] ?? 'gray'];
  const label = safe ? safe.replace(/_/g, ' ') : '—';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone.chip}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
