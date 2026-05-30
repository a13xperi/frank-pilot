import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { releaseClaim } from '@/api/units';
import { getUnitPhoto } from '@/utils/unitPlaceholder';
import {
  FileText,
  AlertCircle,
  Loader2,
  Send,
  Home,
  Calendar,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA, Pill, type PillTone } from '@/components/primitives';

interface ClaimedUnit {
  id: string;
  property_id: string;
  unit_number: string;
  bedrooms: number;
  bathrooms: string | number;
  sqft: number | null;
  monthly_rent: string | number;
  photo_url: string | null;
  property_name: string;
  property_city: string | null;
  property_state: string | null;
}

interface ApplicationDetail {
  id: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  unit_number: string | null;
  requested_rent_amount: number | null;
  requested_move_in_date: string | null;
  overall_screening_result: string | null;
  onesite_lease_id: string | null;
  loft_tenant_id: string | null;
  auto_pay_enrolled: boolean;
  submitted_at: string | null;
  created_at: string;
  property_id: string;
  property_name: string;
  property_address: string;
  claimed_unit: ClaimedUnit | null;
  claim_expires_at: string | null;
}

interface DashboardData {
  user: { id: string; firstName: string; lastName: string };
  activeApplication: ApplicationDetail | null;
  applications: ApplicationDetail[];
}

interface Message {
  id: string;
  applicationId: string;
  senderUserId: string;
  senderRole: 'staff' | 'applicant' | 'tenant';
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

interface MessagesResponse {
  messages: Message[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  screening: 'Screening',
  screening_passed: 'Screening passed',
  screening_failed: 'Screening failed',
  screening_review: 'Under review',
  tier1_review: 'Tier 1 Review',
  tier1_approved: 'Tier 1 Approved',
  tier1_denied: 'Tier 1 Denied',
  tier2_review: 'Tier 2 Review',
  tier2_approved: 'Tier 2 Approved',
  tier2_denied: 'Tier 2 Denied',
  tier3_review: 'Tier 3 Review',
  tier3_approved: 'Tier 3 Approved',
  tier3_denied: 'Tier 3 Denied',
  lease_generated: 'Lease Ready',
  onboarded: 'Onboarded',
  cancelled: 'Cancelled',
};

const DENIED = new Set([
  'screening_failed',
  'tier1_denied',
  'tier2_denied',
  'tier3_denied',
  'cancelled',
]);

function fmt(amount: number | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const sameDay = date.toDateString() === today.toDateString();
  const wasYesterday = date.toDateString() === yest.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (wasYesterday) {
    return `Yesterday ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Application() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(() => {
    return api
      .get<DashboardData>('/tenant/dashboard')
      .then((d) => setData(d))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load application'),
      );
  }, []);

  useEffect(() => {
    loadDashboard().finally(() => setLoading(false));
  }, [loadDashboard]);

  if (loading) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        style={{ background: HF.cream }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4" style={{ background: HF.cream, minHeight: '60vh' }}>
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

  if (!data || !data.activeApplication) {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <FileText className="h-10 w-10" style={{ color: HF.ink4 }} />
        <h2 style={{ fontFamily: HF.display, fontSize: 18, fontWeight: 800, color: HF.ink }}>
          No active application
        </h2>
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          Submit an application to track its progress and message staff here.
        </p>
        <Link to="/apply" style={{ textDecoration: 'none' }}>
          <CTA tone="primary">Start an application</CTA>
        </Link>
      </div>
    );
  }

  const app = data.activeApplication;
  const userId = data.user.id;

  return (
    <div
      className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6"
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}>
            My Application
          </h1>
          <p
            className="mt-1"
            style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}
          >
            {app.property_name}
            {app.unit_number ? ` · Unit ${app.unit_number}` : ''}
          </p>
        </div>
        <StatusPill status={app.status} />
      </div>

      {/* Claimed unit — only relevant while the app is a draft. Once
          submitted the hold is locked in via unit_number on the application,
          and showing a 48h countdown timer would be misleading. */}
      {app.status === 'draft' && app.claimed_unit && app.claim_expires_at && (
        <ClaimedUnitCard
          unit={app.claimed_unit}
          expiresAt={app.claim_expires_at}
          onReleased={loadDashboard}
        />
      )}

      {/* Key dates */}
      <Card variant="mobile" padding={20}>
        <h2
          className="mb-3 flex items-center gap-2 uppercase"
          style={{
            fontFamily: HF.body,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: HF.ink3,
          }}
        >
          <Calendar className="h-4 w-4" /> Key dates
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Submitted" value={fmtDate(app.submitted_at)} />
          <Field label="Requested move-in" value={fmtDate(app.requested_move_in_date)} />
          <Field label="Last updated" value={fmtDate(app.created_at)} />
        </dl>
      </Card>

      {/* Property / lease snapshot */}
      <Card variant="mobile" padding={20}>
        <h2
          className="mb-3 flex items-center gap-2 uppercase"
          style={{
            fontFamily: HF.body,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: HF.ink3,
          }}
        >
          <Home className="h-4 w-4" /> Property
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Property" value={app.property_name} />
          <Field label="Address" value={app.property_address} />
          <Field label="Unit" value={app.unit_number || 'TBD'} />
          <Field label="Requested rent" value={fmt(app.requested_rent_amount)} />
        </dl>
      </Card>

      {/* Next steps */}
      <NextStepsCard app={app} />

      {/* Messages thread */}
      <MessagesThread applicationId={app.id} userId={userId} />
    </div>
  );
}

function formatRent(rent: string | number): string {
  const n = typeof rent === 'string' ? Number(rent) : rent;
  return `$${Math.round(n).toLocaleString()}/mo`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function ClaimedUnitCard({
  unit,
  expiresAt,
  onReleased,
}: {
  unit: ClaimedUnit;
  expiresAt: string;
  onReleased: () => Promise<void> | void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remaining = new Date(expiresAt).getTime() - now;
  const photo =
    getUnitPhoto(unit.photo_url, unit.id);

  async function handleRelease() {
    const ok = window.confirm(
      `Release Unit ${unit.unit_number}? Someone else will be able to claim it.`,
    );
    if (!ok) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      await releaseClaim();
      await onReleased();
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Failed to release unit');
    } finally {
      setReleasing(false);
    }
  }

  return (
    <Card
      variant="mobile"
      padding={0}
      style={{ overflow: 'hidden', border: `1px solid ${HF.accentLo}` }}
    >
      <div className="relative">
        <img src={photo} alt="" className="h-40 w-full object-cover sm:h-48" />
        <div
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{
            background: 'rgba(255,255,255,0.95)',
            color: HF.accentInk,
            fontFamily: HF.body,
            fontSize: 12,
            fontWeight: 700,
            boxShadow: HF.shadow.xs,
          }}
        >
          <Clock className="h-3.5 w-3.5" />
          <span style={{ fontFamily: HF.mono }}>{formatCountdown(remaining)}</span>
        </div>
      </div>
      <div style={{ padding: 20 }}>
        <div
          className="uppercase"
          style={{
            fontFamily: HF.body,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: HF.accent,
          }}
        >
          You're holding this unit
        </div>
        <h3
          className="mt-1"
          style={{ fontFamily: HF.display, fontSize: 16, fontWeight: 700, color: HF.ink }}
        >
          {unit.property_name} · Unit {unit.unit_number}
        </h3>
        <div
          className="mt-1"
          style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink2 }}
        >
          {unit.bedrooms} bd · {unit.bathrooms} ba
          {unit.sqft ? ` · ${unit.sqft} sqft` : ''} · {formatRent(unit.monthly_rent)}
        </div>
        <p
          className="mt-3"
          style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}
        >
          Complete your application before the hold expires to keep this unit.
        </p>
        {releaseError && (
          <div
            className="mt-3 rounded-lg px-3 py-2"
            style={{
              background: HF.errLo,
              color: HF.err,
              fontFamily: HF.body,
              fontSize: 12,
            }}
          >
            {releaseError}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleRelease}
            disabled={releasing}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 disabled:opacity-50"
            style={{
              border: `1px solid ${HF.border}`,
              background: HF.paper,
              color: HF.ink2,
              fontFamily: HF.body,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <X className="h-3.5 w-3.5" />
            {releasing ? 'Releasing…' : 'Release this unit'}
          </button>
        </div>
      </div>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const tone: PillTone = DENIED.has(status)
    ? 'err'
    : status === 'onboarded'
    ? 'sage'
    : 'accent';
  return (
    <span className="shrink-0">
      <Pill tone={tone}>{label}</Pill>
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        className="uppercase"
        style={{
          fontFamily: HF.body,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1,
          color: HF.ink4,
        }}
      >
        {label}
      </dt>
      <dd
        style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink }}
      >
        {value}
      </dd>
    </div>
  );
}

function NextStepsCard({ app }: { app: ApplicationDetail }) {
  const steps: { label: string; done: boolean }[] = [
    { label: 'Application submitted', done: !!app.submitted_at },
    {
      label: 'Screening complete',
      done:
        !!app.overall_screening_result &&
        ['pass', 'fail', 'review_required'].includes(app.overall_screening_result),
    },
    {
      label: 'Approval decision',
      done: ['tier1_approved', 'tier2_approved', 'tier3_approved', 'lease_generated', 'onboarded'].some(
        (s) => app.status === s,
      ),
    },
    {
      label: 'Lease generated',
      done: ['lease_generated', 'onboarded'].includes(app.status),
    },
    { label: 'Move-in / onboarded', done: app.status === 'onboarded' },
  ];

  return (
    <Card variant="mobile" padding={20}>
      <h2
        className="mb-3 uppercase"
        style={{
          fontFamily: HF.body,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: HF.ink3,
        }}
      >
        Next steps
      </h2>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <CheckCircle2
              className="h-4 w-4"
              style={{ color: s.done ? HF.sage : HF.ink4 }}
            />
            <span
              style={{
                fontFamily: HF.body,
                fontSize: 13,
                color: s.done ? HF.ink2 : HF.ink4,
              }}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function MessagesThread({
  applicationId,
  userId,
}: {
  applicationId: string;
  userId: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get<MessagesResponse>(
        `/tenant/applications/${applicationId}/messages`,
      );
      setMessages(res.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Scroll to bottom whenever message count changes
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages.length]);

  // Initial load + visibility/focus refetch + 15s poll
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 15000);
    const onFocus = () => fetchMessages();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchMessages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    // Optimistic append
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      applicationId,
      senderUserId: userId,
      senderRole: 'tenant',
      senderName: 'You',
      body: trimmed,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setSending(true);
    try {
      const res = await api.post<{ message: Message }>(
        `/tenant/applications/${applicationId}/messages`,
        { body: trimmed },
      );
      // Replace optimistic with server version
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? res.message : m)),
      );
    } catch (err) {
      // Revert
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(trimmed);
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card variant="mobile" padding={0}>
      <header
        className="px-5 py-3"
        style={{ borderBottom: `1px solid ${HF.border}` }}
      >
        <h2 style={{ fontFamily: HF.display, fontSize: 14, fontWeight: 700, color: HF.ink }}>
          Messages
        </h2>
        <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>
          Talk directly to your leasing team.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[26rem] min-h-[12rem] space-y-3 overflow-y-auto px-5 py-4"
      >
        {loading ? (
          <div
            className="flex items-center justify-center py-6"
            style={{ color: HF.ink4 }}
          >
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p
            className="py-6 text-center"
            style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}
          >
            No messages yet. Send the first one below.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} selfId={userId} />)
        )}
      </div>

      {error && (
        <div
          className="mx-5 mb-2 rounded-lg px-3 py-2"
          style={{
            background: HF.errLo,
            color: HF.err,
            fontFamily: HF.body,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 px-5 py-3"
        style={{ borderTop: `1px solid ${HF.border}` }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-lg px-3 py-2 focus:outline-none"
          style={{
            border: `1px solid ${HF.border}`,
            background: HF.paper,
            color: HF.ink,
            fontFamily: HF.body,
            fontSize: 13,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSend(e);
            }
          }}
        />
        <CTA
          type="submit"
          tone="primary"
          disabled={sending || draft.trim().length === 0}
        >
          <Send className="h-4 w-4" />
          {sending ? 'Sending…' : 'Send'}
        </CTA>
      </form>
    </Card>
  );
}

function MessageBubble({ m, selfId }: { m: Message; selfId: string }) {
  const isMine = m.senderUserId === selfId;
  const roleTone: PillTone = m.senderRole === 'staff' ? 'sage' : 'accent';
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isMine ? 'text-right' : 'text-left'}`}>
        <div
          className="mb-1 flex items-center gap-2"
          style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}
        >
          {!isMine && (
            <span style={{ fontWeight: 500, color: HF.ink2 }}>{m.senderName}</span>
          )}
          <Pill tone={roleTone} style={{ padding: '1px 8px', fontSize: 10 }}>
            {isMine ? 'You' : m.senderRole === 'staff' ? 'Staff' : 'Tenant'}
          </Pill>
          <span>{fmtTime(m.createdAt)}</span>
        </div>
        <div
          className="whitespace-pre-wrap break-words rounded-2xl px-3 py-2"
          style={{
            background: isMine ? HF.accent : HF.sageLo,
            color: isMine ? HF.paper : HF.ink,
            fontFamily: HF.body,
            fontSize: 13,
          }}
        >
          {m.body}
        </div>
      </div>
    </div>
  );
}
