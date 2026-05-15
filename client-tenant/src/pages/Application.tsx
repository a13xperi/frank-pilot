import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { releaseClaim } from '@/api/units';
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || !data.activeApplication) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <FileText className="h-10 w-10 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-900">No active application</h2>
        <p className="text-sm text-gray-500">
          Submit an application to track its progress and message staff here.
        </p>
        <Link to="/apply" className="btn-primary">
          Start an application
        </Link>
      </div>
    );
  }

  const app = data.activeApplication;
  const userId = data.user.id;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Application</h1>
          <p className="mt-1 text-sm text-gray-500">
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
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <Calendar className="h-4 w-4" /> Key dates
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Submitted" value={fmtDate(app.submitted_at)} />
          <Field label="Requested move-in" value={fmtDate(app.requested_move_in_date)} />
          <Field label="Last updated" value={fmtDate(app.created_at)} />
        </dl>
      </section>

      {/* Property / lease snapshot */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <Home className="h-4 w-4" /> Property
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Property" value={app.property_name} />
          <Field label="Address" value={app.property_address} />
          <Field label="Unit" value={app.unit_number || 'TBD'} />
          <Field label="Requested rent" value={fmt(app.requested_rent_amount)} />
        </dl>
      </section>

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
    unit.photo_url || `https://picsum.photos/seed/${unit.id.slice(0, 8)}/800/600`;

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
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-emerald-100">
      <div className="relative">
        <img src={photo} alt="" className="h-40 w-full object-cover sm:h-48" />
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono">{formatCountdown(remaining)}</span>
        </div>
      </div>
      <div className="p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
          You're holding this unit
        </div>
        <h3 className="mt-1 text-base font-semibold text-gray-900">
          {unit.property_name} · Unit {unit.unit_number}
        </h3>
        <div className="mt-1 text-sm text-gray-600">
          {unit.bedrooms} bd · {unit.bathrooms} ba
          {unit.sqft ? ` · ${unit.sqft} sqft` : ''} · {formatRent(unit.monthly_rent)}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Complete your application before the hold expires to keep this unit.
        </p>
        {releaseError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {releaseError}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleRelease}
            disabled={releasing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {releasing ? 'Releasing…' : 'Release this unit'}
          </button>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const tone = DENIED.has(status)
    ? 'bg-red-100 text-red-700'
    : status === 'onboarded'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-emerald-50 text-emerald-700';
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
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
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Next steps
      </h2>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <CheckCircle2
              className={`h-4 w-4 ${s.done ? 'text-emerald-600' : 'text-gray-300'}`}
            />
            <span className={s.done ? 'text-gray-800' : 'text-gray-400'}>{s.label}</span>
          </li>
        ))}
      </ol>
    </section>
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
    <section className="rounded-xl bg-white shadow-sm">
      <header className="border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Messages</h2>
        <p className="text-xs text-gray-500">Talk directly to your leasing team.</p>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[26rem] min-h-[12rem] space-y-3 overflow-y-auto px-5 py-4"
      >
        {loading ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No messages yet. Send the first one below.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} selfId={userId} />)
        )}
      </div>

      {error && (
        <div className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-gray-100 px-5 py-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ m, selfId }: { m: Message; selfId: string }) {
  const isMine = m.senderUserId === selfId;
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isMine ? 'text-right' : 'text-left'}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-400">
          {!isMine && <span className="font-medium text-gray-600">{m.senderName}</span>}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              m.senderRole === 'staff'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {isMine ? 'You' : m.senderRole === 'staff' ? 'Staff' : 'Tenant'}
          </span>
          <span>{fmtTime(m.createdAt)}</span>
        </div>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
            isMine
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          {m.body}
        </div>
      </div>
    </div>
  );
}
