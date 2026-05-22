import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Loader2, AlertCircle, FileText } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA, Pill, type PillTone } from '@/components/primitives';

interface LedgerEntry {
  id: string;
  entryType: string;
  description: string;
  amount: number;
  createdAt: string;
  dueDate: string | null;
}

interface BalanceSummary {
  balance: number;
  nextDueDate: string | null;
  lastPaymentDate: string | null;
}

interface DashboardData {
  activeApplication: { id: string } | null;
  balance: BalanceSummary | null;
}

const TYPE_LABELS: Record<string, string> = {
  rent_charge: 'Rent',
  payment: 'Payment',
  credit: 'Credit',
  late_fee: 'Late fee',
  deposit: 'Deposit',
};

const TYPE_TONES: Record<string, PillTone> = {
  payment: 'sage',
  credit: 'sage',
  rent_charge: 'neutral',
  late_fee: 'err',
  deposit: 'accent',
};

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PAGE_SIZE = 20;

export function Ledger() {
  const [appId, setAppId] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/tenant/dashboard')
      .then(data => {
        if (!data.activeApplication) {
          setLoading(false);
          return;
        }
        setAppId(data.activeApplication.id);
        setBalance(data.balance);
        return api.get<{ entries: LedgerEntry[]; total: number; balance?: BalanceSummary }>(
          `/tenant/applications/${data.activeApplication.id}/ledger?limit=${PAGE_SIZE}&offset=0`
        );
      })
      .then(res => {
        if (!res) return;
        setEntries(res.entries);
        setTotal(res.total);
        if (res.balance) setBalance(res.balance);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load ledger'))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!appId) return;
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const res = await api.get<{ entries: LedgerEntry[]; total: number }>(
        `/tenant/applications/${appId}/ledger?limit=${PAGE_SIZE}&offset=${nextOffset}`
      );
      setEntries(prev => [...prev, ...res.entries]);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
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
        <FileText className="h-10 w-10" style={{ color: HF.ink4 }} />
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          No active application.
        </p>
        <Link to="/apply" style={{ textDecoration: 'none' }}>
          <CTA tone="primary">Start an application</CTA>
        </Link>
      </div>
    );
  }

  return (
    <div
      className="p-4 pb-24 sm:p-6"
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
    >
      <h1
        className="mb-5"
        style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}
      >
        Account Ledger
      </h1>

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

      {/* Balance summary */}
      {balance && (
        <Card variant="mobile" padding={16} className="mb-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
                Balance
              </p>
              <p
                style={{
                  fontFamily: HF.display,
                  fontSize: 16,
                  fontWeight: 700,
                  color: balance.balance > 0 ? HF.err : HF.sage,
                }}
              >
                {fmt(balance.balance)}
              </p>
            </div>
            <div>
              <p style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
                Next due
              </p>
              <p style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink }}>
                {fmtDate(balance.nextDueDate)}
              </p>
            </div>
            <div>
              <p style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
                Last payment
              </p>
              <p style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink }}>
                {fmtDate(balance.lastPaymentDate)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {entries.length === 0 ? (
        <Card variant="mobile" padding={32} style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}>
            No transactions yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <Card key={entry.id} variant="mobile" padding={16}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate"
                    style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink }}
                  >
                    {entry.description}
                  </p>
                  <p style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
                    {fmtDate(entry.createdAt)}
                  </p>
                </div>
                <span className="shrink-0">
                  <Pill tone={TYPE_TONES[entry.entryType] ?? 'neutral'}>
                    {TYPE_LABELS[entry.entryType] ?? entry.entryType}
                  </Pill>
                </span>
                <span
                  className="shrink-0"
                  style={{
                    fontFamily: HF.body,
                    fontSize: 13,
                    fontWeight: 700,
                    color: entry.amount < 0 ? HF.sage : HF.err,
                  }}
                >
                  {entry.amount < 0 ? '-' : '+'}{fmt(entry.amount)}
                </span>
              </div>
            </Card>
          ))}

          {entries.length < total && (
            <div className="pt-2 text-center">
              <CTA
                tone="primary"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </CTA>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
