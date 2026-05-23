const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  screening: 'bg-yellow-100 text-yellow-700',
  screening_passed: 'bg-emerald-100 text-emerald-700',
  screening_failed: 'bg-red-100 text-red-700',
  tier1_review: 'bg-amber-100 text-amber-700',
  tier1_approved: 'bg-emerald-100 text-emerald-700',
  tier1_denied: 'bg-red-100 text-red-700',
  tier2_review: 'bg-amber-100 text-amber-700',
  tier2_approved: 'bg-emerald-100 text-emerald-700',
  tier2_denied: 'bg-red-100 text-red-700',
  tier3_review: 'bg-amber-100 text-amber-700',
  tier3_approved: 'bg-emerald-100 text-emerald-700',
  tier3_denied: 'bg-red-100 text-red-700',
  lease_generated: 'bg-purple-100 text-purple-700',
  lease_signed: 'bg-purple-100 text-purple-700',
  onboarded: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-gray-100 text-gray-500',
  pass: 'bg-emerald-100 text-emerald-700',
  fail: 'bg-red-100 text-red-700',
  review_required: 'bg-yellow-100 text-yellow-700',
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-gray-100 text-gray-500',
  // Maintenance work-order priorities (work_order_priority enum)
  emergency: 'bg-red-100 text-red-700',
  urgent: 'bg-amber-100 text-amber-700',
  routine: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
  // Maintenance work-order lifecycle (work_order_status enum)
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  // Waitlist / generic outcomes
  waitlisted: 'bg-indigo-100 text-indigo-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-emerald-100 text-emerald-700',
  denied: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  );
}
