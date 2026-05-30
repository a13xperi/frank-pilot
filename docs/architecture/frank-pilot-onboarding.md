# Frank-Pilot onboarding architecture (DC-006)

> **Status:** Living document. Snapshotted 2026-05-27 mid-flight while sections 2–8 of the onboarding plan are in motion. Update inline as each integration flips from STUB → LIVE.
> **Linked Notion page:** DC-006 — 33503ff6-a96d-817f-b14c-c3a222bff8ee
> **Companion docs:**
> - `docs/onboarding/frank-credentials-request.md` — what Frank still owes us
> - `docs/onboarding/twilio-a2p-application.md` — A2P 10DLC application copy
> - `docs/screening/hud-criminal-decision-matrix.md` — federal criminal-screening floors
> - `docs/screening/vendor-rfq-template.md` — screening vendor RFQ

---

## 1. What this document is

The integration map for the Frank-Pilot tenant-onboarding stack. Each external system (Stripe, Twilio, OneSite, Loft, DocuSign, screening vendor, Resend) has a stub module checked into the repo with an env-gated production path. This doc captures:

1. The pattern every integration follows (so the next one is mechanical)
2. The current LIVE / TEST-MODE / STUB / MISSING status of every system
3. The env-var wiring contract per integration
4. The end-to-end smoke chain that proves the full onboarding stack works

---

## 2. The integration pattern

Every external system in `src/modules/integrations/` or `src/modules/screening/` follows the same shape:

```ts
export class FooService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.FOO_API_URL || "https://api.foo.example.com";
    this.apiKey = process.env.FOO_API_KEY || "";
  }

  async doThing(input): Promise<Result> {
    if (!this.apiKey || this.apiKey === "changeme") {
      logger.warn("Using stub Foo doThing");
      // Stub path: fake response, optional DB write, optional audit log.
      return stubResult;
    }
    // Production path — implement when credentials land.
    throw new Error("Foo production API not yet configured");
  }
}
```

Three invariants:

- **No key ⇒ stub.** Lets the apply funnel + e2e tests run in CI without leaking real API calls.
- **Key present ⇒ either real impl or explicit throw.** Never silently degrade to stub when a key is set — that hides production misconfiguration.
- **Audit log on every state transition.** Even stubs write to `applications` and call `writeAuditLog` so the funnel telemetry stays honest across environments.

Reference implementations (in order of canonicality):

- `src/modules/integrations/onesite.ts` — full pattern incl. DB write + audit log
- `src/modules/integrations/loft.ts` — same pattern, slimmer
- `src/modules/integrations/email.ts` — Resend, currently in TEST-MODE
- `src/modules/screening/background-check.ts` — vendor-specific result evaluation
- `src/modules/screening/work-number.ts` — new stub (Equifax-conditional)
- `src/modules/integrations/docusign.ts` — new stub (BP-11 wiring)

---

## 3. Current state per system

| System                       | Module                                            | State        | What's true today                                                                                                                                            | Unblocks when                                            |
| ---------------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Stripe (payments)**        | (external — Stripe SDK in routes)                 | TEST-MODE    | BP-08 hardening shipped + redeployed on `main` (`9791853`); refund loop proven live in test-mode 2026-05-24; `STRIPE_LIVE_ENABLED=true` is arming flag only. | Frank KYC packet → live `sk_live_*` keys in Railway env. |
| **Resend (email)**           | `src/modules/integrations/email.ts`               | TEST-MODE    | API key wired in Railway; only owner email (`alex.e.peri@gmail.com`) receives. `DEMO_LINK_IN_RESPONSE=true` leaks devLink in API response as test bypass.    | Frank confirms sending domain → DNS (SPF/DKIM/DMARC) → flip to live in Resend dashboard. |
| **Twilio (SMS)**             | `src/modules/integrations/twilio.ts`              | INERT        | PR #149 (`fb7c846`) merged; channel=sms works in dev via `TWILIO_DEV_BYPASS`. Live sends require A2P 10DLC brand + campaign approval (2–4 wk).               | A2P 10DLC approval → live `TWILIO_*` env vars in Railway. |
| **Screening (BG + credit)**  | `src/modules/screening/{background-check,credit-check}.ts` | STUB         | Generic stub returning clean results. Real vendor TBD: Equifax+Checkr vs. TransUnion vs. Experian (RFQs Section 2b).                                          | Vendor decision (Section 2d) → credentialing (2–6 wk) → wire-up (Section 2e). |
| **Work Number (income)**     | `src/modules/screening/work-number.ts`            | STUB         | New stub matching the pattern; lights up only if we pick Equifax for screening.                                                                              | Equifax vendor decision + separate Work Number credentialing. |
| **NSOPW (sex offender)**     | (relies on bundled vendor data via background-check.ts:89) | NOT INDEPENDENT | `sexOffenses` field comes from vendor response, not a standalone NSOPW pull. Public XML API is free if we want defense-in-depth.                              | Vendor decision; revisit if vendor doesn't include NSOPW. |
| **OneSite (PMS — leases)**   | `src/modules/integrations/onesite.ts`             | STUB         | Stub generates fake lease IDs + document URLs. Replacing Yardi under Stage 2 LOI.                                                                            | Frank super-user login → API mapping → wire-up.          |
| **Loft (PMS — payments)**    | `src/modules/integrations/loft.ts`                | STUB         | Stub creates fake tenant IDs + auto-pay IDs. Being wound down — Donna 2 Roadmap candidate.                                                                   | Frank super-user login + decision: integrate for 60-day parallel run vs. one-time cutover. |
| **Yardi (legacy PMS)**       | n/a (no module yet)                               | NOT STARTED  | BP-21 assessment is yellow / blocked on Frank credentials.                                                                                                   | Frank super-user login → BP-21 assessment.               |
| **RealPage (legacy PMS)**    | n/a (no module yet)                               | NOT STARTED  | BP-22 assessment is yellow / blocked on Frank credentials.                                                                                                   | Frank super-user login → BP-22 assessment.               |
| **DocuSign (e-signature)**   | `src/modules/integrations/docusign.ts`            | STUB         | New stub matching the pattern (envelope send, webhook handler, executed-PDF fetch).                                                                          | Frank delivers DocuSign account access → JWT auth wire-up → BP-11. |

---

## 4. Env-var contract

All env vars live in **Railway → api service**. Default to empty in code; stub path triggers when empty or value is `changeme`. Production values are seeded from 1Password vault before each promotion.

| System         | Env vars                                                                                                                                                                | Notes                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Stripe         | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE_ENABLED`                                                                                                     | `sk_test_*` vs. `sk_live_*` is the real money switch. `STRIPE_LIVE_ENABLED` only arms routes. |
| Resend         | `RESEND_API_KEY`, `RESEND_FROM`, `DEMO_LINK_IN_RESPONSE`                                                                                                                | Drop `DEMO_LINK_IN_RESPONSE` in prod once live mode flipped.                                |
| Twilio         | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_FROM_NUMBER`, `TWILIO_DEV_BYPASS`                                                    | `TWILIO_DEV_BYPASS=1` short-circuits live sends in non-prod.                                |
| Screening      | `SCREENING_API_URL`, `SCREENING_API_KEY` (generic, today) → vendor-specific (e.g., `EQUIFAX_*`, `CHECKR_*`, `TRANSUNION_*`) after Section 2d decision                  | Generic names work until vendor lock-in; rename in PR alongside wire-up.                    |
| Work Number    | `WORK_NUMBER_API_URL`, `WORK_NUMBER_API_KEY`                                                                                                                            | Only if Equifax vendor chosen.                                                              |
| OneSite        | `ONESITE_API_URL`, `ONESITE_API_KEY`                                                                                                                                    | RealPage-owned; slow API.                                                                   |
| Loft           | `LOFT_API_URL`, `LOFT_API_KEY`                                                                                                                                          |                                                                                             |
| DocuSign       | `DOCUSIGN_API_URL`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_PRIVATE_KEY`                                                       | JWT auth (preferred) — `DOCUSIGN_PRIVATE_KEY` is the RSA private key, store as multi-line. |

---

## 5. The onboarding funnel (data + state flow)

```
Tenant lands on /                                       (client-tenant SPA)
  │
  ▼
/register  email or SMS                                  (POST /api/auth/register)
  │                          ─── Resend or Twilio (magic-link out)
  ▼
Magic-link tap                                          (GET  /apply?token=...)
  │
  ▼
Apply funnel (Welcome → Intent → Checklist → Pick → Claim)
  │                          ─── application + unit-claim writes
  ▼
Pay $35.95 application fee                              (Stripe Checkout / Elements)
  │                          ─── stripe.charges.created webhook
  ▼
Screening fan-out                                       (parallel calls in screening/service.ts)
  ├─ BackgroundCheckService.runCheck()                  ─── vendor API
  ├─ CreditCheckService.runCheck()                      ─── vendor API (often same vendor)
  └─ WorkNumberService.verifyEmployment()               ─── Equifax (if chosen)
  │
  ▼
Compliance pass                                         (FHA + 24 CFR floors + Castro-style framework)
  │                          ─── HUD criminal decision matrix (see docs/screening/)
  ▼
Approval / denial decision                              (AppOps console review)
  │                          ─── FCRA adverse-action letter on denial
  ▼
Lease generated                                         (OneSiteService.generateLease)
  │                          ─── DocuSignService.sendLeaseEnvelope
  ▼
E-signature                                             (DocuSign Connect webhook)
  │                          ─── DocuSignService.handleWebhook("envelope-completed")
  ▼
Tenant created in PMS                                   (LoftService.createTenant + setupAutoPay)
  │                          ─── compliance_tape stamp (acquisitions module)
  ▼
Move-in                                                 (UH lifecycle screens)
```

The funnel today runs end-to-end in stub mode — every box above either has a live service or a stub that completes the state transition + writes to `applications`.

---

## 6. End-to-end verification chain

The integration stack is "live" when each of these smokes passes against prod:

| Smoke                                                          | Proves                                                                                          | Status                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Apply funnel** — `tests/e2e/apply-smoke.spec.ts`             | Welcome → register → magic-link → Intent → Checklist → Pick → Claim, 21 checks                  | ✅ green; required check on `main` per branch protection             |
| **Payment loop** — BP-08 smoke (`scripts/bp08-smoke.sh` or eq) | $35.95 charge, receipt email, refund webhook, `charge.refunded` event                          | ✅ proven test-mode live 2026-05-24; live-mode awaits Frank KYC      |
| **SMS magic-link**                                             | `/register channel=sms` delivers real SMS, `/apply?token=...` works                            | ⏳ inert — awaits Twilio A2P approval                                |
| **Screening fan-out**                                          | Apply with synthetic SSN → credit + criminal + Work Number all return real data; FCRA letter on denial | 🚧 stub only — awaits Section 2d vendor decision + credentialing       |
| **Lease + e-sig**                                              | OneSite generates lease → DocuSign envelope sends → webhook completes → executed PDF stored      | 🚧 stub only — awaits OneSite + DocuSign credentials                  |
| **PMS sync**                                                   | Lease created in OneSite, rent state queryable from Loft                                        | 🚧 stub only — awaits OneSite + Loft super-user logins                |
| **Email live**                                                 | Magic-link to non-owner email lands in inbox                                                    | 🚧 TEST-MODE — awaits sending-domain confirmation + DNS               |

Each smoke is a discrete "definition of done" for one section of the onboarding plan. When all rows turn green, DC-006 is complete and the platform is production-ready.

---

## 7. Cross-cutting concerns

### Compliance + audit

- Every state transition that touches a real or stub integration calls `writeAuditLog` from `src/middleware/audit.ts`. This means the audit trail stays correct across STUB → LIVE flips — only the rawResponse payload changes.
- HUD criminal screening logic lives in `src/modules/screening/compliance.ts` (or background-check.ts depending on slice); decision matrix is canonical at `docs/screening/hud-criminal-decision-matrix.md`. Turner Letter (Nov 25 2025) rescinded the Castro framework but the FHA disparate-impact rule (24 CFR §100.500) is unchanged, so we still adhere to the matrix.
- FCRA adverse-action letter template lives in the screening module (June's template, see `docs/screening/`).

### Feature flagging + arming

- `STRIPE_LIVE_ENABLED` — arming flag for payment routes (does not toggle test/live key — that's `STRIPE_SECRET_KEY` prefix).
- `DEMO_LINK_IN_RESPONSE` — leaks devLink in `/register` response; dev/staging only.
- `TWILIO_DEV_BYPASS` — short-circuits real SMS in non-prod.
- `HOUSING_QA_CLI_FALLBACK` — separate feature, see PR #193.

### Deployment

- API: Railway `api` service. **Does not auto-deploy main pushes** — must run `railway up --service api` from a detached `origin/main` worktree.
- Client (tenant funnel): Vercel `frank-pilot-tenant`. **Does not auto-deploy main pushes** — must run `cd client-tenant && vercel --prod --yes`.
- Client (PM console): Vercel `frank-pilot-client` (staff RBAC console).
- Branch protection on `main`: 6 required checks (smoke-apply, api, client-tenant, check-i18n, pm-console-e2e, tenant-e2e); strict-up-to-date OFF, no required reviews.

---

## 8. Open questions / decisions pending

- **Loft + Yardi + RealPage:** integrate-during-cutover vs. one-time CSV reconciliation? (Donna 2 Roadmap wind-down.)
- **NSOPW:** rely on vendor's bundled data, or add standalone XML pull for defense-in-depth?
- **Resend sending domain:** which domain does Frank own? `frank-pilot.app` is currently a guess.
- **Screening vendor:** Equifax+Checkr vs. TransUnion vs. Experian — pending RFQ responses + cost model (Section 2c) that needs Frank's turnover rate.
- **DocuSign auth:** JWT (recommended, server-to-server) vs. OAuth (user-mediated). Stub assumes JWT.

---

## 9. Change log

| Date         | What changed                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| 2026-05-27   | Initial skeleton — captured during in-flight build of stubs + Twilio A2P copy + Frank email.  |
