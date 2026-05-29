import type { ApiEvent } from '@/api/client';

// Master 16-step onboarding chain. Mirrors scripts/demo-onboarding-end-to-end.sh.
// owner = which tab fires the step. 'tenant' = client-tenant funnel,
// 'staff' = client (PM console — this app). Each tab's overlay lights only its
// own rows; other-owner rows render dimmer for narrative context.
export type DemoStep = {
  n: number;
  owner: 'tenant' | 'staff';
  label: string;
  match: (e: ApiEvent) => boolean;
};

export const STEPS: DemoStep[] = [
  { n: 1,  owner: 'tenant', label: 'Health',             match: (e) => e.method === 'GET'   && /\/health(\?|$)/.test(e.path) },
  { n: 2,  owner: 'tenant', label: 'Register',           match: (e) => e.method === 'POST'  && /\/api\/applicants\/register/.test(e.path) },
  { n: 3,  owner: 'tenant', label: 'Magic-link verify',  match: (e) => e.method === 'POST'  && /\/api\/auth\/magic-link\/verify/.test(e.path) },
  { n: 4,  owner: 'tenant', label: 'Intent quiz',        match: (e) => e.method === 'POST'  && /\/api\/applicants\/intent/.test(e.path) },
  { n: 5,  owner: 'tenant', label: 'Browse units',       match: (e) => e.method === 'GET'   && /\/api\/applicants\/units/.test(e.path) },
  { n: 6,  owner: 'tenant', label: 'Claim unit',         match: (e) => e.method === 'POST'  && /\/api\/applicants\/claim-unit/.test(e.path) },
  { n: 7,  owner: 'tenant', label: 'Apply (full form)',  match: (e) => e.method === 'POST'  && /\/api\/applicants\/apply($|\?)/.test(e.path) },
  { n: 8,  owner: 'tenant', label: 'Submit draft',       match: (e) => e.method === 'POST'  && /\/applications\/submit-draft/.test(e.path) },
  { n: 9,  owner: 'staff',  label: 'Staff login',        match: (e) => e.method === 'POST'  && /\/api\/auth\/login/.test(e.path) },
  { n: 10, owner: 'staff',  label: 'Run screening',      match: (e) => e.method === 'POST'  && /\/api\/screening\/[^/]+\/screen/.test(e.path) },
  { n: 11, owner: 'staff',  label: 'Tier-1 approval',    match: (e) => e.method === 'POST'  && /\/api\/approvals\/[^/]+\/tier1/.test(e.path) },
  { n: 12, owner: 'staff',  label: 'Verify income',      match: (e) => e.method === 'PATCH' && /\/verify-income/.test(e.path) },
  { n: 13, owner: 'staff',  label: 'Generate lease',     match: (e) => e.method === 'POST'  && /\/api\/leases\/[^/]+\/generate/.test(e.path) },
  { n: 14, owner: 'tenant', label: 'Sign lease',         match: (e) => e.method === 'POST'  && /\/me\/lease\/sign/.test(e.path) },
  { n: 15, owner: 'staff',  label: 'Complete onboarding',match: (e) => e.method === 'POST'  && /\/api\/leases\/[^/]+\/onboard/.test(e.path) },
  { n: 16, owner: 'tenant', label: 'Tenant dashboard',   match: (e) => e.method === 'GET'   && /\/api\/tenant\/dashboard/.test(e.path) },
];

export const THIS_OWNER: 'tenant' | 'staff' = 'staff';
