# integrations

## Purpose

The vendor adapter seam. Each external system gets one adapter with one honest rule
(`screening/stub-policy.ts` for screening vendors; explicit stubs elsewhere): a
keyless production deploy must never silently succeed — it either stubs loudly in
dev/demo or fails loudly in prod.

## Adapter inventory — stub vs real

| Adapter | File | State | Notes |
|---|---|---|---|
| **Twilio SMS** | `integrations/twilio.ts` | **REAL** | All notification sends (`notifyApplicationSubmitted/ScreeningComplete/Approved/Denied/LeaseReady`); unconfigured → WARN + `{sent:false}`. SMS only — voice runs through ElevenLabs. |
| **Email (Resend)** | via `auth/magic-link-service.ts` | **REAL** | Magic links + status emails; `RESEND_API_KEY` unset → no-op WARN; sandbox sender default. |
| **ElevenLabs** | `voice-intake/`, `outbound-validation/dialer.ts` | **REAL** | Conversational AI inbound + outbound; signature-verified webhooks. |
| **Stripe** | `payment/` | **REAL, flag-dark** | Boot-guard crashes on live-flag-with-placeholder-keys. |
| **OneSite** | `integrations/onesite.ts` | **STUB** | Lease generation + tenant sync; fake `ols_<ts>` ids; needs `ONESITE_API_URL/KEY` from Global IT (open external ask). |
| **Loft** | `integrations/loft.ts` | **STUB** | Tenant/payment-platform onboarding; needs `LOFT_API_URL/KEY`. |
| **DocuSign** | `integrations/docusign.ts` | **STUB** | Superseded in practice by native e-signature ([lease](lease.md)); creds spec in `docs/onboarding/frank-credentials-request.md` §7 if ever needed. |
| **Checkr / TransUnion ShareAble** | `screening/{background,credit}-check.ts` + `cra-webhook.ts` | **BUILT, keyless** | Contracts + credentialing in progress; arming runbook: `docs/runbooks/checkr-cra-arming.md`. |
| **Stripe Identity** | `screening/identity-verification.ts` | **BUILT, flag-dark** | Reuses Stripe keys; flag flip + dashboard webhook config only. |
| **Plaid / Work Number / NSOPW** | `screening/*` | **BUILT, dormant** | Behind `SCREENING_EXTENDED_CHECKS_ENABLED`. |
| **Sage (Supabase)** | `outbound-validation/sage-client.ts`, `qa/routes.ts` | **REAL** | Wait-list source of truth + QA bucket; service-role only. |

## Compliance anchors

The stub policy *is* the anchor: `STUB_GATE_ERROR` in keyless prod →
`could_not_screen`/`review_required` holds — no path auto-approves without a real
verdict or a named human override.

## Current state

Real today: Twilio SMS, Resend, ElevenLabs, Sage. Everything financial or
screening-vendor is built and waiting on keys/contracts. The two asks that gate the
first cohort end-to-end: **OneSite credentials** (lease generation) and **CRA
credentialing** (automated screening; manual path covers until then).
