// Civic Trust: muted, dignified status tints — pale 50-level fills with a
// hairline ring and 700-level text. The leading dot inherits `currentColor`,
// so each entry only needs one class string and both themes stay legible
// (the 50/200/700 levels flip via the CSS variables).
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 ring-gray-300',
  submitted: 'bg-blue-50 text-blue-700 ring-blue-200',
  awaiting_identity: 'bg-sky-50 text-sky-700 ring-sky-200',
  screening: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  screening_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  screening_passed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  screening_failed: 'bg-red-50 text-red-700 ring-red-200',
  could_not_screen: 'bg-orange-50 text-orange-700 ring-orange-200',
  tier1_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  tier1_approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  tier1_denied: 'bg-red-50 text-red-700 ring-red-200',
  tier2_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  tier2_approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  tier2_denied: 'bg-red-50 text-red-700 ring-red-200',
  tier3_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  tier3_approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  tier3_denied: 'bg-red-50 text-red-700 ring-red-200',
  lease_generated: 'bg-purple-50 text-purple-700 ring-purple-200',
  lease_signed: 'bg-purple-50 text-purple-700 ring-purple-200',
  onboarded: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-gray-100 text-gray-500 ring-gray-300',
  pass: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  fail: 'bg-red-50 text-red-700 ring-red-200',
  review_required: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  inactive: 'bg-gray-100 text-gray-500 ring-gray-300',
  // Maintenance work-order priorities (work_order_priority enum)
  emergency: 'bg-red-50 text-red-700 ring-red-200',
  urgent: 'bg-amber-50 text-amber-700 ring-amber-200',
  routine: 'bg-blue-50 text-blue-700 ring-blue-200',
  low: 'bg-gray-100 text-gray-600 ring-gray-300',
  // Maintenance work-order lifecycle (work_order_status enum)
  assigned: 'bg-blue-50 text-blue-700 ring-blue-200',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  // Waitlist / generic outcomes
  waitlisted: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  pending: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  denied: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  // Some rows carry a null status (e.g. a screening check that never ran on a
  // cancelled application). Render a neutral dash rather than crashing the page.
  const safe = status ?? '';
  const colors = STATUS_COLORS[safe] || 'bg-gray-100 text-gray-600 ring-gray-300';
  const label = safe ? safe.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colors}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label}
    </span>
  );
}
