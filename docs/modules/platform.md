# platform (cross-cutting)

RBAC, audit, the scheduler, and database provisioning — the rails every module runs on.

## RBAC — the complete permission matrix

Role hierarchy: `leasing_agent < senior_manager < regional_manager < asset_manager <
system_admin` (`src/middleware/rbac.ts`). LA = leasing_agent, SM = senior_manager,
RM = regional_manager, AM = asset_manager, SA = system_admin.

| Permission | LA | SM | RM | AM | SA |
|---|---|---|---|---|---|
| application:create / read / submit | ✔ | ✔ | ✔ | ✔ | ✔ |
| screening:initiate / view | | ✔ | ✔ | ✔ | ✔ |
| approval:tier1 | | ✔ | ✔ | ✔ | ✔ |
| approval:tier2 | | | ✔ | ✔ | ✔ |
| approval:tier3 | | | | ✔ | ✔ |
| lease:generate / modify | | ✔ | ✔ | ✔ | ✔ |
| payment:setup | | ✔ | ✔ | ✔ | ✔ |
| payment:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| fraud:view | | ✔ | ✔ | ✔ | ✔ |
| fraud:resolve | | | ✔ | ✔ | ✔ |
| modification:request | ✔ | ✔ | ✔ | ✔ | ✔ |
| modification:approve_senior / _regional / _asset | | ✔ | ✔* | ✔* | ✔ |
| inspection:view · maintenance:view · renewal:view · moveout:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| maintenance:manage | ✔ | ✔ | ✔ | ✔ | ✔ |
| inspection/renewal/moveout/ledger/recertification:manage | | ✔ | ✔ | ✔ | ✔ |
| ledger:view · recertification:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| eviction:view / manage | | ✔ | ✔ | ✔ | ✔ |
| audit:view | | | ✔ | ✔ | ✔ |
| housing_qa:admin · user:manage | | | | | ✔ |
| user:view | | ✔ | ✔ | ✔ | ✔ |
| property:manage · acquisition:view / manage | | | | ✔ | ✔ |
| property:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| voice_intake:view | ✔ | ✔ | ✔ | ✔ | ✔ |
| voice_intake:approve · outbound_validation:view | | ✔ | ✔ | ✔ | ✔ |
| **outbound_validation:run** | | | | | ✔ |

\* tier-mapped: approve_regional = RM+, approve_asset = AM+.

`enforceSeparationOfDuties(actorId, previousActorIds)` is the shared anti-collusion
primitive; `buildPropertyScope()` confines staff reads/writes to their
`property_ids`.

## Audit middleware

`audit_log` — INSERT-only (no UPDATE/DELETE), ~50 action kinds across the lifecycle,
`details` JSONB **PII-filtered** (`sanitizeObject` blocks SSN/DOB/card/bank
patterns), plus actor role, IP, user agent.

## Scheduler (`src/scheduler.ts`) — every job

| Job | Cron | Flag |
|---|---|---|
| Recertification reminders (120/90/60d, overdue, market rent) | daily 08:00 | always |
| TRACS deadline check | daily 09:00 | always |
| Monthly rent postings | 1st, 06:00 | always |
| Late-fee assessment | daily 07:00 (day ≥ 6) | always |
| Renewal offers + reminders | daily 07:30 | always |
| Tape chain verify (sample 20 stamped applicants/hr) | every 5 min | `COMPLIANCE_TAPE_V2_ENABLED` |
| Tape DLQ replay | every 15 min | `COMPLIANCE_TAPE_V2_ENABLED` |
| FCRA pre-adverse finalizer | daily 06:00 | `FCRA_PRE_ADVERSE_ENABLED` |
| **Outbound dialer tick** | every 5 min, 9:00–19:55 PT | `FRANK_OUTBOUND_ENABLED` |
| Outbound stuck-call sweeper | every 15 min | `FRANK_OUTBOUND_ENABLED` |
| Outbound daily report → Notion | 20:05 PT | `FRANK_OUTBOUND_ENABLED` |

Flag-gated jobs are unregistered entirely when their flag is off.

## Database provisioning (`src/db/migrate.ts`)

Two layers, every run: (1) `SCHEMA_SQL` — fully idempotent base (self-heals missing
objects), one atomic batch; (2) tracked deltas `src/db/migrations/*.sql` applied in
filename order exactly once **via `psql -f`** (because `ALTER TYPE … ADD VALUE`
can't run in a transaction). Commands: `up` (default) / `status` / `baseline` /
`down` (dev-only) / `reset`. New tables go in BOTH the base schema and a delta.

## Boot guardrails (`src/index.ts`)

Production refuses to start without `JWT_SECRET` + `ENCRYPTION_KEY`; CORS fails
closed without an explicit allow-list; Stripe boot-guard validates key/flag
consistency; raw-body webhook routers (Stripe, ElevenLabs ×2, CRA) mount **before**
`express.json()` — reordering silently breaks signature verification.
