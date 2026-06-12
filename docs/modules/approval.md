# approval

## Purpose

The tiered human approval gate: Tier 1 (senior manager) → Tier 2 (regional, conditional)
→ Tier 3 (asset manager, exceptions). Encodes separation of duties, fraud-flag
blocking, and approval-speed anomaly detection — no application reaches a lease
without distinct humans signing off.

## Workflow encoded

1. **Tier 1** — from `screening_passed`/`tier1_review`: pass/fail + notes.
   Pass + (rent ≥ TIER2_RENT_THRESHOLD or exceptions) → `tier2_review`; plain pass →
   `tier1_approved`; fail → `tier1_denied` + FCRA notice.
2. **Tier 2** (conditional) — same shape; pass + exceptions → `tier3_review`.
3. **Tier 3** (exceptions only) — final word.
4. Approved → lease generation (income-verified gate applies there).

Hard rules:
- **Separation of duties** — each tier's reviewer must differ from the submitter and
  every prior reviewer (`enforceSeparationOfDuties`); violation throws.
- **Fraud-flag blocking** — unresolved `fraud_flags` make a Tier-1 pass a 400.
- **Speed anomaly** — `checkApprovalSpeed()` flags suspiciously fast turnarounds
  (`unusual_approval_speed` fraud flag).

## Data model

Tier columns on `applications` (`tierN_reviewer_id/decision/notes/decided_at`,
`tier2_required`, `tier3_required`); `fraud_flags`; every decision lands in the
immutable `audit_log`.

## API surface

| Route | Permission |
|---|---|
| `POST /api/approvals/:applicationId/tier1` | `approval:tier1` (senior+) |
| `POST /api/approvals/:applicationId/tier2` | `approval:tier2` (regional+) |
| `POST /api/approvals/:applicationId/tier3` | `approval:tier3` (asset+) |
| `GET /api/approvals/:applicationId/status` | `application:read` |

## Compliance anchors

Audit actions `tierN_approved/denied` on every decision; FCRA §1681m notice
dispatched (non-blocking) on every denial; separation of duties is the
anti-collusion control the CFO narrative leans on.

## Flags & env

None — gates are RBAC permissions, not env flags. (Gap: `TIER2_RENT_THRESHOLD` and
the "exceptions" predicate are code constants, not configurable.)

## Current state

**Live** end to end.

## Key files

`src/modules/approval/service.ts`, `src/modules/approval/routes.ts`.
