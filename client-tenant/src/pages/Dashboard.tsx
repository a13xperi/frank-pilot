import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import {
  DollarSign, Wrench, Home, Clock, RefreshCw, FileText, AlertCircle
} from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA, Pill } from '@/components/primitives';

interface DashboardData {
  user: { firstName: string; lastName: string; email: string };
  applications: any[];
  activeApplication: any | null;
  balance: { balance: number; nextDueDate: string | null; lastPaymentDate: string | null } | null;
  nextDue: string | null;
  openWorkOrders: number;
  recentLedger: Array<{ id: string; description: string; amount: number; entryType: string; createdAt: string }>;
  lease: { propertyName: string; unitNumber: string | null; status: string } | null;
  recertification: { cutoff_date: string; status: string } | null;
  renewal: { status: string; proposed_rent: number | null } | null;
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-xl p-5"
      style={{ background: HF.paper, border: `1px solid ${HF.border}`, boxShadow: HF.shadow.xs }}
    >
      <div className="mb-3 h-4 w-1/3 rounded" style={{ background: HF.border }} />
      <div className="h-7 w-1/2 rounded" style={{ background: HF.border }} />
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/tenant/dashboard')
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="p-4 space-y-4"
        style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
      >
        <div
          className="mb-2 h-6 w-40 animate-pulse rounded"
          style={{ background: HF.border }}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
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

  if (!data) return null;

  const { user, activeApplication, balance, openWorkOrders, recentLedger, lease, recertification, renewal } = data;

  if (!activeApplication) {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <FileText className="h-12 w-12" style={{ color: HF.ink4 }} />
        <h2 style={{ fontFamily: HF.display, fontSize: 18, fontWeight: 800, color: HF.ink }}>
          No active application
        </h2>
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          Submit an application to access your dashboard.
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
        Welcome back, {user.firstName}
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Balance card */}
        <Card
          variant="mobile"
          padding={20}
          style={{ background: HF.accent, border: `1px solid ${HF.accent}`, color: HF.paper }}
        >
          <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <DollarSign className="h-4 w-4" />
            <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600 }}>
              Current balance
            </span>
          </div>
          <p
            className="mt-2"
            style={{ fontFamily: HF.display, fontSize: 30, fontWeight: 800, color: HF.paper }}
          >
            {balance ? fmt(balance.balance) : '—'}
          </p>
          {balance?.nextDueDate && (
            <p
              className="mt-1"
              style={{ fontFamily: HF.body, fontSize: 12, color: 'rgba(255,255,255,0.85)' }}
            >
              Next due {fmtDate(balance.nextDueDate)}
            </p>
          )}
          <Link
            to="/pay"
            className="mt-4 inline-block rounded-lg px-4 py-2"
            style={{
              background: HF.paper,
              color: HF.accentInk,
              fontFamily: HF.body,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Pay rent
          </Link>
        </Card>

        {/* Work orders */}
        <Card variant="mobile" padding={20}>
          <div className="flex items-center gap-2" style={{ color: HF.ink3 }}>
            <Wrench className="h-4 w-4" />
            <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600 }}>
              Open work orders
            </span>
          </div>
          <p
            className="mt-2"
            style={{ fontFamily: HF.display, fontSize: 30, fontWeight: 800, color: HF.ink }}
          >
            {openWorkOrders}
          </p>
          <Link
            to="/maintenance"
            className="mt-4 inline-block"
            style={{
              fontFamily: HF.body,
              fontSize: 13,
              fontWeight: 600,
              color: HF.accent,
              textDecoration: 'none',
            }}
          >
            View all →
          </Link>
        </Card>

        {/* Lease */}
        {lease && (
          <Card variant="mobile" padding={20}>
            <div className="flex items-center gap-2" style={{ color: HF.ink3 }}>
              <Home className="h-4 w-4" />
              <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600 }}>
                Lease
              </span>
            </div>
            <p
              className="mt-2"
              style={{ fontFamily: HF.display, fontSize: 16, fontWeight: 700, color: HF.ink }}
            >
              {lease.propertyName}
            </p>
            {lease.unitNumber && (
              <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
                Unit {lease.unitNumber}
              </p>
            )}
            <div className="mt-2">
              <Pill tone={lease.status === 'active' ? 'sage' : 'neutral'}>
                {lease.status}
              </Pill>
            </div>
          </Card>
        )}

        {/* Recertification */}
        <Card variant="mobile" padding={20}>
          <div className="flex items-center gap-2" style={{ color: HF.ink3 }}>
            <RefreshCw className="h-4 w-4" />
            <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600 }}>
              Recertification
            </span>
          </div>
          {recertification ? (
            <>
              <p
                className="mt-2"
                style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 700, color: HF.warn }}
              >
                Due {fmtDate(recertification.cutoff_date)}
              </p>
              <p
                className="capitalize"
                style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}
              >
                {recertification.status}
              </p>
            </>
          ) : (
            <p
              className="mt-2"
              style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}
            >
              No recertification due
            </p>
          )}
        </Card>

        {/* Renewal */}
        <Card variant="mobile" padding={20}>
          <div className="flex items-center gap-2" style={{ color: HF.ink3 }}>
            <Clock className="h-4 w-4" />
            <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600 }}>
              Lease renewal
            </span>
          </div>
          {renewal ? (
            <>
              <p
                className="mt-2 capitalize"
                style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 700, color: HF.ink }}
              >
                {renewal.status}
              </p>
              {renewal.proposed_rent !== null && (
                <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>
                  Proposed rent: {fmt(renewal.proposed_rent)}/mo
                </p>
              )}
            </>
          ) : (
            <p
              className="mt-2"
              style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}
            >
              Not yet eligible
            </p>
          )}
        </Card>

        {/* Recent activity */}
        <Card variant="mobile" padding={20} className="sm:col-span-2 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <span style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 600, color: HF.ink3 }}>
              Recent activity
            </span>
            <Link
              to="/ledger"
              style={{
                fontFamily: HF.body,
                fontSize: 12,
                fontWeight: 600,
                color: HF.accent,
                textDecoration: 'none',
              }}
            >
              See all
            </Link>
          </div>
          {recentLedger.length === 0 ? (
            <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink4 }}>
              No recent transactions
            </p>
          ) : (
            <ul className="space-y-2">
              {recentLedger.slice(0, 5).map(entry => (
                <li key={entry.id} className="flex items-center justify-between">
                  <div>
                    <p
                      className="line-clamp-1"
                      style={{ fontFamily: HF.body, fontSize: 13, fontWeight: 500, color: HF.ink2 }}
                    >
                      {entry.description}
                    </p>
                    <p style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
                      {fmtDate(entry.createdAt)}
                    </p>
                  </div>
                  <span
                    className="ml-3"
                    style={{
                      fontFamily: HF.body,
                      fontSize: 13,
                      fontWeight: 600,
                      color: entry.amount < 0 ? HF.sage : HF.err,
                    }}
                  >
                    {entry.amount < 0 ? '-' : '+'}{fmt(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
