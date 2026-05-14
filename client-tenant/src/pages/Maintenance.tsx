import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Wrench } from 'lucide-react';

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

const PRIORITY_STYLES: Record<string, string> = {
  routine: 'bg-emerald-100 text-emerald-700',
  urgent: 'bg-amber-100 text-amber-700',
  emergency: 'bg-red-100 text-red-700',
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!appId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <Wrench className="h-10 w-10 text-gray-300" />
        <p className="text-gray-500">No active application found.</p>
        <Link to="/dashboard" className="btn-primary">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Maintenance</h1>
        <button
          onClick={() => setFormOpen(v => !v)}
          className="btn-primary inline-flex items-center gap-1"
        >
          New request
          {formOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {/* New request form */}
      {formOpen && (
        <div className="mb-5 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">Submit a new request</h2>
          {formError && (
            <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{formError}</div>
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
                      className="accent-emerald-600"
                    />
                    <span className="text-sm capitalize">{p}</span>
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
            <button
              type="submit"
              disabled={submitting || !title || !description}
              className="btn-primary w-full"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
        </div>
      )}

      {/* Work order list */}
      {workOrders.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm">
          <Wrench className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-400">No maintenance requests yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workOrders.map(wo => (
            <div key={wo.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-900">{wo.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize
                  ${PRIORITY_STYLES[wo.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                  {wo.priority}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500 line-clamp-2">{wo.description}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                <span className="capitalize">{wo.status.replace(/_/g, ' ')}</span>
                {wo.category && <span>· {wo.category}</span>}
                <span>· {relativeTime(wo.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
