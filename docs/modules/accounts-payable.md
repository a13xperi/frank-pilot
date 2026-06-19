# accounts-payable

> **Status: DESIGN / PREP ONLY — no module code is built.** This is the build spec for
> DM-FRANK-024, written ahead of the build so that either outcome of **DM-FRANK-023**
> (the platform-scope decision: standalone financials vs operations-only + RealPage/OneSite
> as the financial source of truth) kicks off a 36–72h implementation immediately.
>
> Writing this doc is **023-SAFE** — it is documentation, gated on nothing. Building the
> module *is* gated on DM-FRANK-023; do not implement until 023 is Decided.
>
> Spec source: Tee's AP + reconciliation workflow, captured Jun 11 2026, appendix of the
> Notion page "🧭 Frank / Global — Next Steps & Priorities" (`37c03ff6-a96d-815c-bec2-f9ec79c7cae0`).

## Purpose

Accounts Payable for Global's property portfolio: register vendors, capture invoices off
the bill firehose (email + postal + manager forwards), cut checks against per-property bank
accounts, and route every disbursement through a three-person, separation-of-duties approval
chain ending in Frank Hawkins's **wet signature**. The module encodes the operator's real
control: nobody pays a bill alone, and every cut/void is recorded on the immutable tape so
the disbursement history is audit-provable, not reconstructed.

It is the operations-side counterpart to the per-tenant rent [ledger](ledger.md) (money in)
— AP is money out. The company-level general ledger that ties both to entity reporting is a
**separate, later module** (DM-FRANK-025 / GL), not in scope here. Payroll is explicitly out
of scope — Global runs it through a third party, outside RealPage and outside this module.

## Workflow encoded

The real-world process Tee runs today, step by step. The module automates capture, the
approval state machine, and the tape stamps; the **human controls stay human** — Nancy's
double-blind review and Frank's wet signature are deliberately not automated.

### Weekly bank reconciliation (Mondays) — adjacent, informs AP timing

1. Each property has its **own bank account**. Tee logs into each, pulls the period's
   deposits (e.g. 1st–8th).
2. Records deposits per property: manager deposits + Section 8 + Heartland/Global Payments
   card settlement + occasional third-party checks (coins noted separately).
3. Sends a summary to all managers, CC Dora + Nancy — managers **vouch** posted payments
   against physically received funds (the inbound internal control).

> Reconciliation is the read side and is largely a [ledger](ledger.md)/GL concern; AP cares
> about it only for the **Monday 6pm cutoff** it shares (below). Documented here so the
> build doesn't accidentally fold reconciliation into AP scope.

### AP / check-cutting — the module's core state machine

1. **Capture** — bills arrive via email, postal mail, and manager forwards. Tee prints,
   writes up a "check please," and enters the invoice in RealPage → Accounts Payable. The
   **memo field is load-bearing**: invoice #, billing #, and unit # all live there.
2. **Cut** — Tee cuts the check on blank check stock (routing + account # print on the
   check itself). This *creates* the check-run line; it is not yet authorized to send.
3. **Review (Nancy)** — Nancy performs a **double-blind audit** of the cut batch. This is
   the separation-of-duties control: the reviewer is never the cutter.
4. **Sign (Frank Hawkins)** — Frank applies a **wet signature** (no digital signature, by
   policy). Property-side items (utility bills, property expenses) are also signed off by
   **Dora (asset manager)** at the property level before they reach Frank.
5. **Disburse** — copies made, checks mailed.

**Cutoff:** invoices due **Monday by 6pm**; checks are cut the same week.

**Void / reissue:** a check can be voided and re-cut. Voids and top-level edits require
**elevated access** (a corrections-grade permission, not the everyday cutter role).

### Approval chain — state machine

```
                 capture           cut             review (Nancy)        sign (Hawkins)        mail
  invoice ─────────────────► entered ───► cut/pending_review ───► reviewed ───► signed ───► disbursed
                                                  │                    │            │
                                                  │ reject             │ reject     │ (wet sig only)
                                                  ▼                    ▼            │
                                              rejected             rejected         │
                                                                                    ▼
   void (elevated access) at any post-cut state  ──────────────────────────────► voided ──► reissue
                                                                                  (→ new invoice, append-only)
```

| State | Set by | Meaning |
|---|---|---|
| `entered` | Tee (cutter) | Invoice captured in AP, memo populated (invoice/billing/unit #). |
| `cut` / `pending_review` | Tee (cutter) | Check cut on blank stock; awaiting Nancy. |
| `reviewed` | Nancy (reviewer) | Double-blind audit passed; awaiting signature. Reviewer ≠ cutter (enforced). |
| `signed` | Frank Hawkins (signer) | Wet signature applied (recorded, not e-signed). |
| `disbursed` | Tee | Copies made, mailed. |
| `rejected` | reviewer/signer | Kicked back with a required reason; returns to the cutter. |
| `voided` | elevated access | Check voided; an append-only correction, never a delete. Reissue mints a new invoice/check that references the voided one. |

Hard rules (mirroring the [approval](approval.md) module's separation-of-duties pattern):

- **Separation of duties** — the reviewer (Nancy) and signer (Hawkins) must each differ from
  the cutter (Tee) and from each other. Reuse `enforceSeparationOfDuties`-style checks.
- **Wet-signature gate** — `signed` is a recorded *attestation that a physical signature was
  applied*, not a digital signature. The module never forges or substitutes an e-signature
  for Frank's wet signature (explicit operator policy; contrast the native e-sign in
  [lease](lease.md), which is deliberately **not** used here).
- **Elevated access for voids/top-level edits** — gate behind an `ap:correct`-grade
  permission, distinct from `ap:cut`.
- **Monday 6pm cutoff** — invoices due by Monday 6pm are eligible for the week's check run;
  a scheduler hint, not a hard block (operator can include late items by exception).

## Data model

Tables this module would own. Money is stored in integer cents, mirroring `payment` and
`ledger`. Nothing here is migrated yet — this is the proposed shape.

| Table | Load-bearing pieces |
|---|---|
| `ap_vendors` | `id` PK, `name`, `address`, `phone`, `tax_id` (the exact four fields Tee listed for vendor setup), `is_active`, `created_by`, timestamps. Tax ID handled as sensitive (encrypt-at-rest / restricted read). |
| `ap_invoices` | `id` PK, `vendor_id` FK, `property_id` FK (each property = separate bank account), `unit_id` (nullable), `amount_cents`, `invoice_number`, `billing_number`, `unit_number` (the RealPage **memo** triad, first-class columns here), `due_date`, `received_via` enum (`email`/`postal`/`manager_forward`), `status` (state machine above), `entered_by`, timestamps. |
| `ap_check_runs` | `id` PK, `property_id` FK, `bank_account_ref` (per-property account), `week_of` (the Monday cutoff window), `status` (`open`/`closed`), `cut_by`, `closed_at`. A batch the approval chain acts on. |
| `ap_checks` | `id` PK, `check_run_id` FK, `invoice_id` FK, `amount_cents`, `check_number` (blank-stock; routing/account printed at cut time), `state` (cut → reviewed → signed → disbursed → voided), `cut_by`, `reviewed_by`, `signed_by`, `voided_by`, `reissued_from_check_id` (FK, self-referential for void→reissue), reason columns for reject/void, timestamps for each transition. |
| `ap_approvals` | per-decision rows: `check_id` FK, `step` (`review`/`sign`/`property_signoff`), `actor_id`, `decision` (`approve`/`reject`), `notes`, `decided_at`. Enforces and records separation of duties; the audit trail for who-signed-what. |

Indexes: `ap_invoices(property_id, status)`, `ap_invoices(vendor_id)`,
`ap_invoices(due_date)`, `ap_checks(check_run_id)`, `ap_checks(state)`,
`ap_vendors(tax_id)` (unique, sensitive).

Constraints worth calling out: `reissued_from_check_id` makes void→reissue an explicit link
(never an in-place mutation); a partial unique index on `(check_run_id, invoice_id)` where
state ≠ `voided` stops paying the same invoice twice in a run.

## AP events on the hash ledger (immutable tape)

Every state transition that matters legally/financially is stamped onto the
hash-chained compliance [tape](tape.md) — the same append-only spine the rest of the
platform uses (`stamp()` computes
`entry_hash = SHA-256(sequence ‖ prev_hash ‖ canonicalJson(payload) ‖ created_at)`; the
Postgres `compliance_tape_no_update`/`no_truncate` triggers physically reject mutation).

Proposed stamp kinds (each needs a citation slotted into `TAPE_CITATIONS`):

| Stamp kind | Fired when | Notes |
|---|---|---|
| `AP_VENDOR_REGISTERED` | vendor created | tax-id-bearing; redact/hash the tax ID in the payload. |
| `AP_INVOICE_CAPTURED` | invoice entered | payload carries vendor, property, amount, invoice/billing/unit memo triad. |
| `AP_CHECK_CUT` | check cut on stock | links invoice → check_run. |
| `AP_CHECK_REVIEWED` | Nancy approves | records reviewer ≠ cutter. |
| `AP_CHECK_REJECTED` | reviewer/signer rejects | reason required. |
| `AP_CHECK_SIGNED` | Frank wet-signs | attestation of physical signature; signer identity + timestamp. |
| `AP_CHECK_DISBURSED` | mailed | closes the lifecycle. |
| `AP_CHECK_VOIDED` | void (elevated) | append-only correction; references the voided check. |
| `AP_CHECK_REISSUED` | reissue after void | references `reissued_from_check_id`. |

**Append-only corrections.** A void is *never* a delete or an UPDATE — the original
`AP_CHECK_CUT`/`_SIGNED` entries stand on the chain, and `AP_CHECK_VOIDED` (plus a fresh
`AP_CHECK_REISSUED` if re-cut) is stamped *after* them, exactly the correction pattern the
rent [ledger](ledger.md) uses for `reverseEntry()` (status → `reversed` + an offsetting
entry with a required reason). The disbursement history is therefore reconstructable from the
tape alone, and the chain verifies in O(n) via the existing `verify()` walk.

**Scope note:** the demo narrative's "append-only addendum corrections" is still a tape
**roadmap** item — today's tape is *pure append* (no correction-addendum block concept yet;
see [tape](tape.md) Current state). AP corrections therefore ride the pure-append model:
void/reissue are *new* stamps that supersede by reference, not an addendum-block feature that
doesn't exist yet. If/when the addendum-block lands, AP voids become its first real consumer.

## Integration shapes (both sketched — pick on DM-FRANK-023)

Per the operating rule "flat architecture / single source of truth, avoid system-to-system
hops," the choice below is exactly the DM-FRANK-023 fork. Both are sketched so neither
outcome stalls the build.

### Shape A — RealPage AP API interface (operations-only posture, CFO's lean)

RealPage / OneSite stays the **financial source of truth**; Frank-pilot is the capture +
control + audit layer in front of it.

- Add a `realpage-ap.ts` adapter under the existing **vendor-adapter seam**
  (`src/modules/integrations/`), alongside the `onesite.ts` stub. RealPage *is* OneSite's
  parent product, so this extends the same OneSite credential/adapter family rather than
  inventing a new seam.
- Honest-stub rule applies (`integrations` doctrine): keyless prod must **fail loudly**, not
  silently succeed — no AP write reaches RealPage without real `REALPAGE_AP_*` creds.
- Frank-pilot owns: capture, the approval state machine, tape stamps, and the
  separation-of-duties / wet-signature gates. On `signed → disbursed`, it **pushes** the AP
  entry into RealPage (memo triad → RealPage memo field) and stores the returned RealPage
  voucher id on `ap_checks`. RealPage remains the cheque/GL system of record.
- Reads (vendor list, outstanding bills) can hydrate from RealPage to avoid a divergent
  vendor master.
- Pros: matches the CFO's posture, no GL rebuild, fastest parallel-run path. Cons: a
  system-to-system hop (the thing the operating rule warns against) and dependence on
  RealPage AP API availability/credentials (an external gate, like the OneSite ask).

### Shape B — Standalone AP (full-platform posture)

Frank-pilot owns AP end to end; RealPage is retired from the AP path (DM-FRANK-026 legacy
retirement).

- All five tables live in our Postgres; the tape is the audit spine; no external AP system.
- Check generation produces the printable artifact (blank-stock layout: routing + account #
  + check #) in-platform — a print/export module, not an API push.
- Feeds the future GL (DM-FRANK-025) directly via the tape + `ap_*` tables, achieving the
  "single source of truth / no hops" rule outright.
- Pros: flat architecture, fully audit-native, no external dependency. Cons: we own check
  printing, bank-account handling, and reconciliation correctness; only viable once 023
  picks the standalone path and the parallel run (DM-FRANK-026) earns trust.

**Either way**, the capture layer, the approval state machine, the data model, and the tape
stamps above are **identical** — only the disbursement sink differs (RealPage push vs
in-platform print). That is the point of writing this now: ~80% of the build is
023-independent and can start the moment the gate clears.

## API surface (proposed)

| Route | Permission |
|---|---|
| `POST /api/ap/vendors` | `ap:manage` (vendor setup) |
| `GET /api/ap/vendors` | `ap:view` |
| `POST /api/ap/invoices` | `ap:cut` (capture; memo triad required) |
| `GET /api/ap/invoices` | `ap:view` (filters: property, status, due window) |
| `POST /api/ap/check-runs` | `ap:cut` (open a week's run) |
| `POST /api/ap/checks/:id/review` | `ap:review` (Nancy; reviewer ≠ cutter enforced) |
| `POST /api/ap/checks/:id/sign` | `ap:sign` (Hawkins; records wet signature) |
| `POST /api/ap/checks/:id/disburse` | `ap:cut` |
| `POST /api/ap/checks/:id/void` | `ap:correct` (elevated) |
| `POST /api/ap/checks/:id/reissue` | `ap:correct` (elevated) |

New RBAC permissions to add to the matrix ([platform](platform.md)): `ap:view`, `ap:cut`,
`ap:review`, `ap:sign`, `ap:correct` — mapped so Tee=cut, Nancy=review, Hawkins=sign, Dora=
property sign-off, with `ap:correct` reserved for elevated/admin roles.

## Compliance anchors

- Separation of duties (cutter ≠ reviewer ≠ signer) is the anti-collusion control the CFO
  narrative leans on, same as [approval](approval.md) tiers for applications.
- Every transition stamps the tape with a citation; the disbursement record is hash-chain
  provable and mutation-rejecting.
- Wet-signature attestation is recorded as a control fact, never substituted by an e-sign.
- Tax IDs are sensitive PII — restricted read + encrypt-at-rest, redacted/hashed in tape
  payloads.

## Flags & env

- **(build-time gate, not an env flag)** — entire module gated on DM-FRANK-023 being Decided.
- Shape A only: `REALPAGE_AP_ENABLED` (honest-stub gate), `REALPAGE_AP_API_URL`,
  `REALPAGE_AP_API_KEY` — supplied by Global IT; same external-ask posture as the OneSite
  credentials.
- Reuses `COMPLIANCE_TAPE_V2_ENABLED` for the hash-chain dual-write path.

## Current state

**Design / prep only — not built.** No `src/modules/accounts-payable/`, no migrations, no
routes exist. This doc is the staged build spec so that the moment DM-FRANK-023 resolves the
team can stand the module up in the estimated 36–72h. Open inputs before build: (1)
DM-FRANK-023 decision (A/B/C), (2) for Shape A, RealPage AP API credentials from Global IT,
(3) confirmation of the blank-check-stock printing requirements (routing/account/check #
layout) if Shape B.

## Key files

None yet (design only). When built, expected at `src/modules/accounts-payable/` —
`service.ts`, `routes.ts`, plus a `src/modules/integrations/realpage-ap.ts` adapter for
Shape A. Update this doc in the same PR that lands the code.

## Linkage

DM-FRANK-024 (this module) · gated on DM-FRANK-023 (platform scope) · feeds DM-FRANK-025 (GL)
· parallel-run exit criteria in DM-FRANK-026. Link this doc back on the DM-FRANK-024 Notion
page once committed.
