import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Loader2, AlertCircle, FileText, Check, ArrowRight } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA } from '@/components/primitives';
import { useFlag } from '@/lib/flags';

interface ApplicationItem {
  id: string;
  status: string;
  property_name?: string;
  unit_number?: string | null;
  requested_rent_amount?: number | null;
  submitted_at?: string | null;
  created_at: string;
}

interface ApplicationsResponse {
  applications: ApplicationItem[];
}

const TERMINAL_BAD = new Set([
  'screening_failed',
  'tier1_denied',
  'tier2_denied',
  'tier3_denied',
  'cancelled',
]);

type StageKey = 'submitted' | 'docs' | 'pm' | 'lease' | 'movein';

interface StageState {
  current: StageKey | null;
  done: Set<StageKey>;
}

const STAGE_LABELS: Record<StageKey, string> = {
  submitted: 'Submitted',
  docs: 'Screening',
  pm: 'PM review',
  lease: 'Lease',
  movein: 'Move-in',
};

const STAGE_ORDER: StageKey[] = ['submitted', 'docs', 'pm', 'lease', 'movein'];

function stageFor(status: string): StageState {
  const done = new Set<StageKey>();
  let current: StageKey | null = null;

  if (status === 'draft') return { current: null, done };

  // Submitted is reached the moment status leaves draft.
  done.add('submitted');
  current = 'submitted';

  if (status === 'submitted') return { current: 'submitted', done: new Set() };

  if (status.startsWith('screening')) {
    return { current: 'docs', done: new Set(['submitted']) };
  }

  // Screening passed -> Docs done
  done.add('docs');
  current = 'docs';

  if (status.startsWith('tier1') || status.startsWith('tier2') || status.startsWith('tier3')) {
    return { current: 'pm', done: new Set(['submitted', 'docs']) };
  }

  // Past PM review
  done.add('pm');
  current = 'pm';

  if (status === 'lease_generated') {
    return { current: 'lease', done: new Set(['submitted', 'docs', 'pm']) };
  }

  if (status === 'lease_signed') {
    return { current: 'movein', done: new Set(['submitted', 'docs', 'pm', 'lease']) };
  }

  if (status === 'onboarded') {
    return { current: 'movein', done: new Set(['submitted', 'docs', 'pm', 'lease']) };
  }

  return { current, done };
}

const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: HF.warnLo, fg: HF.warn },
  submitted: { label: 'Submitted', bg: HF.accentLo, fg: HF.accentInk },
  screening: { label: 'Screening', bg: HF.accentLo, fg: HF.accentInk },
  screening_passed: { label: 'Screening passed', bg: HF.okLo, fg: HF.ok },
  tier1_review: { label: 'PM review', bg: HF.accentLo, fg: HF.accentInk },
  tier1_approved: { label: 'PM approved', bg: HF.okLo, fg: HF.ok },
  tier2_review: { label: 'PM review', bg: HF.accentLo, fg: HF.accentInk },
  tier2_approved: { label: 'PM approved', bg: HF.okLo, fg: HF.ok },
  tier3_review: { label: 'Final review', bg: HF.accentLo, fg: HF.accentInk },
  tier3_approved: { label: 'Approved', bg: HF.okLo, fg: HF.ok },
  lease_generated: { label: 'Lease ready', bg: HF.okLo, fg: HF.ok },
  lease_signed: { label: 'Lease signed', bg: HF.okLo, fg: HF.ok },
  onboarded: { label: 'Moved in', bg: HF.okLo, fg: HF.ok },
};

const SUBTITLE: Partial<Record<string, string>> = {
  draft: 'Finish your application to enter the queue.',
  submitted: 'We received your application. Frank is reviewing it next.',
  screening: 'Frank is verifying your documents.',
  screening_passed: 'Documents verified. The PM will review your file next.',
  tier1_review: 'Frank is reviewing your file. Typical turnaround: 2–3 business days.',
  tier2_review: 'Final review in progress.',
  tier3_review: 'Final review in progress.',
  lease_generated: "Your lease is ready to sign.",
  lease_signed: 'Signed — awaiting move-in.',
  onboarded: 'Welcome home — you’re moved in.',
};

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StageTracker({ status }: { status: string }) {
  const { current, done } = stageFor(status);
  const currentIdx = current ? STAGE_ORDER.indexOf(current) : -1;
  const stepNumber = currentIdx === -1 ? 0 : currentIdx + 1;
  const stepLabel = current ? STAGE_LABELS[current] : 'Submit pending';
  const subtitle = SUBTITLE[status] ?? 'We’ll keep this page up to date.';

  return (
    <Card variant="mobile" padding={0} style={{ background: HF.accent, color: HF.paper, border: 'none' }}>
      <div style={{ padding: '16px 18px' }}>
        <p
          style={{
            fontFamily: HF.body,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          Application status
        </p>
        <h2
          style={{
            fontFamily: HF.display,
            fontSize: 20,
            fontWeight: 800,
            color: HF.paper,
            marginTop: 6,
          }}
        >
          Step {stepNumber} of 5 · {stepLabel}
        </h2>
        <p
          style={{
            fontFamily: HF.body,
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            marginTop: 4,
          }}
        >
          {subtitle}
        </p>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
          {STAGE_ORDER.map((key, i) => {
            const isDone = done.has(key);
            const isCurrent = current === key;
            const isReached = isDone || isCurrent;
            return (
              <div key={key} style={{ display: 'contents' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    flex: '0 0 auto',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: isReached ? HF.paper : 'rgba(255,255,255,0.25)',
                      border: `2px solid ${HF.paper}`,
                      display: 'grid',
                      placeItems: 'center',
                      fontFamily: HF.display,
                      fontWeight: 800,
                      fontSize: 11,
                      color: isReached ? HF.accent : HF.paper,
                    }}
                  >
                    {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </div>
                  <span
                    style={{
                      marginTop: 4,
                      fontFamily: HF.body,
                      fontSize: 9,
                      fontWeight: isCurrent ? 700 : 500,
                      color: 'rgba(255,255,255,0.9)',
                      textAlign: 'center',
                      width: 56,
                    }}
                  >
                    {STAGE_LABELS[key]}
                  </span>
                </div>
                {i < STAGE_ORDER.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      marginBottom: 18,
                      background: isDone ? HF.paper : 'rgba(255,255,255,0.3)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function DeniedBanner({ status }: { status: string }) {
  return (
    <Card variant="mobile" padding={14} style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}>
      <p style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 14, color: HF.err }}>
        Application {status.replace(/_/g, ' ')}
      </p>
      <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink2, marginTop: 4 }}>
        Reach out to your property manager for next steps.
      </p>
    </Card>
  );
}

export function Status() {
  const { data, loading, error } = useApiQuery<ApplicationsResponse>('/applicants/me/applications');
  const leaseEsignEnabled = useFlag('LEASE_ESIGN_ENABLED');

  if (loading) {
    return (
      <div
        style={{ background: HF.cream, minHeight: '60vh' }}
        className="flex items-center justify-center"
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: HF.cream, minHeight: '60vh' }} className="p-4">
        <Card
          variant="mobile"
          padding={14}
          style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}
        >
          <div className="flex items-center gap-2" style={{ color: HF.err }}>
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p style={{ fontFamily: HF.body, fontSize: 13 }}>{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  const applications = data?.applications ?? [];

  if (applications.length === 0) {
    return (
      <div
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
        className="flex flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <FileText className="h-10 w-10" style={{ color: HF.ink4 }} />
        <h2 style={{ fontFamily: HF.display, fontSize: 18, fontWeight: 800 }}>
          No applications yet
        </h2>
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          Start your application to get placed in affordable housing.
        </p>
        <Link to="/apply" style={{ textDecoration: 'none' }}>
          <CTA tone="primary">Start an application</CTA>
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
      className="p-4 pb-24 sm:p-6"
    >
      <h1
        style={{
          fontFamily: HF.display,
          fontSize: 22,
          fontWeight: 800,
          marginBottom: 18,
        }}
      >
        Application Status
      </h1>

      <div className="space-y-4">
        {applications.map((app) => {
          const badge = STATUS_BADGE[app.status] ?? {
            label: app.status,
            bg: HF.border,
            fg: HF.ink2,
          };
          const denied = TERMINAL_BAD.has(app.status);

          return (
            <Card key={app.id} variant="mobile" padding={0}>
              <div style={{ padding: '16px 18px 4px' }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p
                      style={{
                        fontFamily: HF.display,
                        fontWeight: 700,
                        fontSize: 15,
                        color: HF.ink,
                      }}
                    >
                      {app.property_name ?? 'Property TBD'}
                    </p>
                    {app.unit_number && (
                      <p
                        style={{
                          fontFamily: HF.body,
                          fontSize: 12,
                          color: HF.ink3,
                          marginTop: 2,
                        }}
                      >
                        Unit {app.unit_number}
                      </p>
                    )}
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontFamily: HF.body,
                      fontSize: 11,
                      fontWeight: 700,
                      background: badge.bg,
                      color: badge.fg,
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
              </div>

              <div style={{ padding: '8px 18px 14px' }}>
                {denied ? <DeniedBanner status={app.status} /> : <StageTracker status={app.status} />}

                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    fontFamily: HF.body,
                    fontSize: 11,
                    color: HF.ink3,
                  }}
                >
                  {app.requested_rent_amount != null && (
                    <span>
                      Requested rent:{' '}
                      <strong style={{ color: HF.ink2, fontWeight: 700 }}>
                        {fmt(app.requested_rent_amount)}/mo
                      </strong>
                    </span>
                  )}
                  {app.submitted_at ? (
                    <span>
                      Submitted:{' '}
                      <strong style={{ color: HF.ink2, fontWeight: 700 }}>
                        {fmtDate(app.submitted_at)}
                      </strong>
                    </span>
                  ) : (
                    <span>
                      Started:{' '}
                      <strong style={{ color: HF.ink2, fontWeight: 700 }}>
                        {fmtDate(app.created_at)}
                      </strong>
                    </span>
                  )}
                </div>

                {app.status === 'draft' && (
                  <Link to="/apply" style={{ textDecoration: 'none', marginTop: 12, display: 'block' }}>
                    <CTA tone="primary" block>
                      Finish application <ArrowRight size={16} />
                    </CTA>
                  </Link>
                )}

                {app.status === 'lease_generated' && leaseEsignEnabled && (
                  <Link to="/lease" style={{ textDecoration: 'none', marginTop: 12, display: 'block' }}>
                    <CTA tone="primary" block>
                      Sign your lease <ArrowRight size={16} />
                    </CTA>
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
