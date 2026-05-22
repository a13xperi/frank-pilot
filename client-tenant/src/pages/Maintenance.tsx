import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA, Pill, type PillTone } from '@/components/primitives';

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  category: string | null;
  created_at: string;
}

interface DashboardData {
  activeApplication: { id: string } | null;
}

const PRIORITY_TONES: Record<string, PillTone> = {
  routine: 'sage',
  urgent: 'warn',
  emergency: 'err',
};

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function Maintenance() {
  const [appId, setAppId] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'emergency'>('routine');
  const [category, setCategory] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const dash = await api.get<DashboardData>('/tenant/dashboard');
        setAppId(dash.activeApplication?.id ?? null);
        const wo = await api.get<{ workOrders: WorkOrder[] }>('/tenant/maintenance');
        setWorkOrders(wo.workOrders ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appId) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/tenant/maintenance', {
        applicationId: appId,
        title,
        description,
        priority,
        category: category || undefined,
      });
      // Refetch list
      const wo = await api.get<{ workOrders: WorkOrder[] }>('/tenant/maintenance');
      setWorkOrders(wo.workOrders ?? []);
      // Reset form
      setTitle('');
      setDescription('');
      setPriority('routine');
      setCategory('');
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

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

  if (!appId) {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <Wrench className="h-10 w-10" style={{ color: HF.ink4 }} />
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          No active application found.
        </p>
        <Link to="/dashboard" style={{ textDecoration: 'none' }}>
          <CTA tone="primary">Back to dashboard</CTA>
        </Link>
      </div>
    );
  }

  return (
    <div
      className="p-4 pb-24 sm:p-6"
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
    >
      <div className="mb-5 flex items-center justify-between">
        <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}>
          Maintenance
        </h1>
        <CTA tone="primary" onClick={() => setFormOpen(v => !v)}>
          New request
          {formOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CTA>
      </div>

      {error && (
        <Card
          variant="mobile"
          padding={12}
          elevation="none"
          className="mb-4"
          style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}
        >
          <div className="flex items-center gap-2" style={{ color: HF.err }}>
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span style={{ fontFamily: HF.body, fontSize: 13 }}>{error}</span>
          </div>
        </Card>
      )}

      {/* New request form */}
      {formOpen && (
        <Card variant="mobile" padding={20} className="mb-5">
          <h2
            className="mb-4"
            style={{ fontFamily: HF.display, fontSize: 14, fontWeight: 700, color: HF.ink2 }}
          >
            Submit a new request
          </h2>
          {formError && (
            <div
              className="mb-3 rounded-lg p-2"
              style={{
                background: HF.errLo,
                color: HF.err,
                fontFamily: HF.body,
                fontSize: 12,
              }}
            >
              {formError}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="title">Title *</label>
              <input
                id="title"
                className="input"
                required
                placeholder="e.g. Leaking faucet in kitchen"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="desc">Description *</label>
              <textarea
                id="desc"
                className="input min-h-[80px] resize-y"
                required
                placeholder="Describe the issue…"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div>
              <p className="label mb-2">Priority *</p>
              <div className="flex gap-3">
                {(['routine', 'urgent', 'emergency'] as const).map(p => (
                  <label key={p} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="priority"
                      value={p}
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                      style={{ accentColor: HF.accent }}
                    />
                    <span
                      className="capitalize"
                      style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink2 }}
                    >
                      {p}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="category">Category</label>
              <input
                id="category"
                className="input"
                placeholder="e.g. Plumbing, HVAC, Electrical"
                value={category}
                onChange={e => setCategory(e.target.value)}
              />
            </div>
            <CTA
              type="submit"
              tone="primary"
              block
              disabled={submitting || !title || !description}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </CTA>
          </form>
        </Card>
      )}

      {/* Work order list */}
      {workOrders.length === 0 ? (
        <Card variant="mobile" padding={32} style={{ textAlign: 'center' }}>
          <Wrench className="mx-auto mb-2 h-8 w-8" style={{ color: HF.ink4 }} />
          <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}>
            No maintenance requests yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {workOrders.map(wo => (
            <Card key={wo.id} variant="mobile" padding={16}>
              <div className="flex items-start justify-between gap-2">
                <p
                  style={{
                    fontFamily: HF.display,
                    fontSize: 14,
                    fontWeight: 700,
                    color: HF.ink,
                  }}
                >
                  {wo.title}
                </p>
                <span className="shrink-0 capitalize">
                  <Pill tone={PRIORITY_TONES[wo.priority] ?? 'neutral'}>
                    {wo.priority}
                  </Pill>
                </span>
              </div>
              <p
                className="mt-1 line-clamp-2"
                style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}
              >
                {wo.description}
              </p>
              <div
                className="mt-2 flex items-center gap-3"
                style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}
              >
                <span className="capitalize">{wo.status.replace(/_/g, ' ')}</span>
                {wo.category && <span>· {wo.category}</span>}
                <span>· {relativeTime(wo.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
