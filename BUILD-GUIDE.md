# CDPC Compliance Hub — Parallel Build Guide

**Project:** `/Users/a13xperi/projects/frank-pilot`
**Stack:** Node.js + TypeScript + Express + PostgreSQL (raw pg) + React + Vite + Tailwind
**DB:** `frank_pilot` on localhost, user `a13xperi`
**Backend port:** 3002 | **Frontend port:** 5173
**Test credentials:** All `password123` — agent@cdpc.test, senior@cdpc.test, regional@cdpc.test, asset@cdpc.test, admin@cdpc.test

---

## Current State (What's Built)

### Backend Modules (14)
| Module | Path | Endpoints | Status |
|--------|------|-----------|--------|
| Application | `src/modules/application/` | 7 | Complete |
| Screening | `src/modules/screening/` | 4 | Complete |
| Approval | `src/modules/approval/` | 4 | Complete |
| Payment | `src/modules/payment/` | 4 | Complete (Stripe setup only) |
| Lease | `src/modules/lease/` | 3 | Complete (OneSite stubbed) |
| Decision Matrix | `src/modules/decision-matrix/` | 3 | Complete |
| Adverse Action | `src/modules/adverse-action/` | 2 | Complete |
| Users | `src/modules/users/` | 6 | Complete |
| Properties | `src/modules/properties/` | 4 | Complete (16 properties) |
| Compliance | `src/modules/compliance/` | 1 | Complete |
| Recertification | `src/modules/recertification/` | 8 | Complete |
| Ledger | `src/modules/ledger/` | 9 | Complete |
| Eviction | `src/modules/eviction/` | 13 | Complete |
| Integrations | `src/modules/integrations/` | — | OneSite/Loft/Twilio (all stubbed) |

### Frontend Pages (14)
Login, Dashboard, Applications, ApplicationForm, ApplicationDetail, Screening, Approvals, Properties, Users, Compliance, AuditLog, Recertifications, Ledger (overview + detail), Evictions (3 tabs)

### Database Tables (14)
users, properties, applications, fraud_flags, lease_modifications, known_problem_addresses, adverse_action_notices, recertifications, tenant_ledger, lease_violations, eviction_notices, eviction_cases, audit_log, ami_limits

### Scheduler Jobs (4)
- 6:00 AM 1st of month: Monthly rent postings
- 7:00 AM daily (from 6th): Late fee assessment
- 8:00 AM daily: Recertification reminders
- 9:00 AM daily: TRACS deadline checks

---

## What Needs to Be Built (Master Build List Coverage)

### Module 8: Lease Renewal & Move-Out — READY TO BUILD
**Priority:** HIGH | **Complexity:** Medium | **Dependencies:** None (schema ready to extend)

**Schema changes needed:**
- Add enums: `renewal_status`, `moveout_status`
- Add tables: `lease_renewals`, `move_outs`
- Add to applications: `lease_end_date DATE`, `security_deposit_amount DECIMAL(10,2)`
- Add 10 audit actions: `renewal_offered`, `renewal_accepted`, `renewal_declined`, `renewal_counter_offered`, `renewal_approved`, `moveout_initiated`, `moveout_inspection_completed`, `deposit_disposition_calculated`, `deposit_refund_sent`, `collections_referred`

**Backend (2 new modules):**
- `src/modules/renewal/service.ts` — Renewal offer generation (auto at 90 days before lease end), accept/decline/counter workflow, approval, lease extension
- `src/modules/renewal/routes.ts` — 6 endpoints: list, detail, create, respond, approve, process
- `src/modules/moveout/service.ts` — 30-day notice, pre/final inspections, deposit disposition (NV 21-day law NRS 118A.242), itemized deductions, collections referral at day 45
- `src/modules/moveout/routes.ts` — 7 endpoints: list, detail, initiate, inspection, deposit, refund, deadlines

**Scheduler additions:**
- 7:30 AM daily: Process renewal offers (auto-generate at 90 days, send 60/30-day reminders)
- 10:00 AM daily: Check 21-day deposit deadlines, collections notices

**Frontend (2 new pages):**
- `client/src/pages/Renewals.tsx` — Summary cards, offer table, rent comparison modal, accept/counter/approve actions
- `client/src/pages/MoveOuts.tsx` — Timeline view, deposit calculator with itemized deductions, 21-day countdown

**Lease service update:** In `completeOnboarding()`, set `lease_end_date = lease_start_date + requested_lease_term_months` and `security_deposit_amount = requested_rent_amount` (1 month rent).

**RBAC:** renewal:view (all), renewal:manage (senior_manager+), moveout:view (all), moveout:manage (senior_manager+)

**Demo data:** Keisha Williams gets renewal offer (3% increase). Tomasz Kowalski gets move-out with pre-inspection complete.

---

### Module 10: Inspections & Maintenance — READY TO BUILD
**Priority:** MEDIUM | **Complexity:** Medium | **Dependencies:** None

**Schema:**
- Add enums: `inspection_type` (monthly, move_in, move_out, annual, emergency), `inspection_status`, `work_order_status`, `work_order_priority`
- New tables: `inspections` (unit, type, status, notes, photos JSONB, inspector, scheduled_date, completed_date), `work_orders` (unit, description, priority, assigned_to, status, emergency_flag)

**Backend:**
- `src/modules/inspections/service.ts` — Monthly inspection scheduler (written notice required), room-by-room digital form, photo documentation refs, smoke detector compliance tracker, HQS/UPCS records
- `src/modules/inspections/routes.ts` — CRUD + schedule + complete + photos
- `src/modules/maintenance/service.ts` — Work order submission (through mgmt office only), emergency classification (plumbing, frozen pipes, no heat, electrical), assignment, completion
- `src/modules/maintenance/routes.ts` — CRUD + assign + complete

**Frontend:**
- `client/src/pages/Inspections.tsx` — Calendar view of scheduled inspections, completion form, photo upload refs
- `client/src/pages/Maintenance.tsx` — Work order queue, priority badges, emergency flag, assignment

**Demo data:** 3-4 scheduled inspections, 2 work orders (1 emergency plumbing, 1 routine)

---

### Module 12: HUD Regulatory Auto-Update Engine — READY TO BUILD
**Priority:** HIGH | **Complexity:** High | **Dependencies:** None (extends existing AMI infrastructure)

**Schema:**
- New table: `regulatory_updates` (source, change_type, old_value, new_value, effective_date, impact_assessment, auto_applied, reviewed_by)
- Extend `ami_limits` with `source_url`, `last_fetched_at`

**Backend:**
- `src/modules/regulatory/service.ts` — HUD User API polling (income limits, FMR, utility allowances), Federal Register RSS monitoring, NV Housing Division monitoring, change detection engine, auto-update income eligibility, auto-update LIHTC rent caps, auto-recalculate affected tenant rents, management email notifications (Critical/Standard/Informational tiers)
- `src/modules/regulatory/routes.ts` — List updates, detail, manual poll trigger, apply update, dismiss

**Scheduler:** Daily at 5 AM: poll HUD User API, compare with current ami_limits, flag deltas

**Frontend:**
- `client/src/pages/RegulatoryUpdates.tsx` — Feed of detected changes, impact assessment, apply/dismiss actions

**Demo data:** 1-2 simulated HUD updates (AMI limit increase for 2027)

---

### Module 13: Tenant Communication & Portal — READY TO BUILD
**Priority:** MEDIUM | **Complexity:** High | **Dependencies:** None

**Schema:**
- New tables: `messages` (sender, recipient, application_id, subject, body, read_at, attachments JSONB), `alerts` (property_id, type, subject, body, priority, delivered_count, created_by), `document_vault` (application_id, document_type, file_name, file_url, uploaded_by)

**Backend:**
- `src/modules/communication/service.ts` — Two-way messaging (tenant ↔ PM), mass notifications (property-wide or filtered), emergency alerts (5-min delivery target), package notifications (72-hour pickup window), scheduled templates, communication audit log
- `src/modules/documents/service.ts` — My Documents vault (receipts, leases, notices), upload/download, retention schedule

**Frontend:**
- `client/src/pages/Messages.tsx` — Inbox/sent view, compose modal, attachment support
- `client/src/pages/Alerts.tsx` — Mass notification composer, delivery tracking
- `client/src/pages/Documents.tsx` — Tenant document vault browser

**Note:** This is the biggest remaining module. Could be split: Messages first, then Alerts, then Documents.

---

### Module 5 Enhancements: Lease Addenda Engine
**Priority:** MEDIUM | **Complexity:** Low | **Dependencies:** None

**What:** Auto-attach all required addenda at lease signing: Community Policies, LIHTC Addendum, Drug-Free Housing, Crime-Free, Smoke Detector, Satellite Dish, VAWA (HUD 91067), Lead-Based Paint (pre-1978), Move-In/Move-Out Condition Report.

**Schema:** New table `lease_addenda` (application_id, addendum_type, template_version, signed, signed_at)

**Backend:** Generate addenda checklist per property/lease, track which are signed via DocuSign (stubbed)

---

### Module 15 Enhancements: Live Vacancy Tracker
**Priority:** LOW | **Complexity:** Low | **Dependencies:** Module 8 (move-out updates vacancy)

**What:** Auto-decrement `total_vacancy` on move-in, auto-increment on move-out. Waiting list FIFO with priority placement for veterans & government referrals.

**Schema:** New table `waiting_list` (property_id, applicant_name, contact, priority, position, added_at, status)

---

### Module 17: Government Agency Referral Engine
**Priority:** LOW | **Complexity:** Medium | **Dependencies:** None

**What:** Dedicated referral inbox, inbound email parsing, government agency domain whitelist, auto-extract prospect data, auto-send application link, pre-populate with referred property, priority placement flag, audit trail.

---

## Architecture Patterns (for new builders)

### Service Pattern
```typescript
// src/modules/{name}/service.ts
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";

export class MyService {
  private twilio = new TwilioService();
  // Methods here — all async, all audit-logged
}
```

### Route Pattern
```typescript
// src/modules/{name}/routes.ts
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";

const router = Router();
// Zod schemas, then routes with authenticate + requirePermission
export default router;
```

### Route Registration — `src/index.ts`
```typescript
import myRoutes from "./modules/{name}/routes";
app.use("/api/{name}", myRoutes);
```

### RBAC — `src/middleware/rbac.ts`
Add permissions to the `PERMISSIONS` object. Pattern: `"{module}:view"` for reads, `"{module}:manage"` for writes.

### Schema — `src/db/schema.ts`
- Enums go in the ENUMS section
- Tables go in the TABLES section (order matters for FKs)
- Add indexes in INDEXES section
- Add updated_at trigger in TRIGGERS section
- Update DROP_SCHEMA_SQL (reverse order)

### Frontend Page Pattern
- Use `useApiQuery<T>(path)` for data fetching
- Use `DataTable<T>` for tables, `Modal` for dialogs, `StatusBadge` for status chips
- Use `RoleGate minRole="..."` for conditional UI
- Use `api.get/post/patch/del` from `@/api/client`
- Add route in `App.tsx`, nav item in `Sidebar.tsx`

### Demo Seed — `src/db/seed-demo.ts`
- Uses existing user IDs (agentId, seniorId, regionalId, assetId)
- Uses property IDs from `getPropertyId(index)` round-robin
- Onboarded applications available via `onboardedResult`

---

## Parallel Execution Strategy

These modules are **independent** and can be built simultaneously:

### Worker 1: Module 8 (Renewal + Move-Out)
Files: schema.ts (enums + tables), renewal/service.ts, renewal/routes.ts, moveout/service.ts, moveout/routes.ts, lease/service.ts (update), scheduler.ts (add jobs), rbac.ts (add perms), index.ts (register routes), Renewals.tsx, MoveOuts.tsx, App.tsx, Sidebar.tsx, types/index.ts, seed-demo.ts

### Worker 2: Module 10 (Inspections + Maintenance)
Files: schema.ts (enums + tables), inspections/service.ts, inspections/routes.ts, maintenance/service.ts, maintenance/routes.ts, rbac.ts, index.ts, Inspections.tsx, Maintenance.tsx, App.tsx, Sidebar.tsx, types/index.ts, seed-demo.ts

### Worker 3: Module 12 (HUD Regulatory Updates)
Files: schema.ts (table), regulatory/service.ts, regulatory/routes.ts, rbac.ts, index.ts, scheduler.ts, RegulatoryUpdates.tsx, App.tsx, Sidebar.tsx, types/index.ts, seed-demo.ts

### Worker 4: Module 13 (Tenant Communication — Phase 1: Messages)
Files: schema.ts (tables), communication/service.ts, communication/routes.ts, rbac.ts, index.ts, Messages.tsx, App.tsx, Sidebar.tsx, types/index.ts, seed-demo.ts

### Merge Conflicts to Watch
These files are touched by ALL workers — merge carefully:
1. **`src/db/schema.ts`** — Each worker adds enums + tables. Coordinate insertion points.
2. **`src/middleware/rbac.ts`** — Each worker adds permissions. Easy merge (additive).
3. **`src/index.ts`** — Each worker adds route imports + app.use. Easy merge.
4. **`src/scheduler.ts`** — Workers 1 and 3 add cron jobs.
5. **`client/src/App.tsx`** — Each worker adds routes. Easy merge.
6. **`client/src/components/Sidebar.tsx`** — Each worker adds nav items.
7. **`client/src/types/index.ts`** — Each worker adds interfaces.
8. **`src/db/seed-demo.ts`** — Each worker adds demo data at the end.

### Recommended Merge Order
1. Worker with most schema changes goes first (Module 8)
2. Then Module 10 (smaller schema)
3. Then Module 12 (extends existing ami_limits)
4. Then Module 13 (independent tables)
5. Final: `npm run migrate -- reset && npm run seed && npm run seed:demo` to validate

---

## Commands Reference

```bash
cd /Users/a13xperi/projects/frank-pilot

# Database
npm run migrate          # Create tables
npm run migrate -- reset # Drop + recreate
npm run seed             # Seed users + 16 properties + AMI limits
npm run seed:demo        # Seed demo applications + recertifications + ledger + evictions

# Dev
npm run dev              # Start backend on port 3002
cd client && npm run dev # Start frontend on port 5173

# Test
npm test                 # Run all backend tests (751+)
npx tsc --noEmit         # TypeScript check (backend)
cd client && npx tsc --noEmit  # TypeScript check (frontend)
```

---

## Master Build List Module Status

| # | Module | Status | Lines of Code |
|---|--------|--------|--------------|
| 1 | Welcome & Property Selection | Partial | — |
| 2 | Tenant Application | Good | ~800 |
| 3 | Screening & Background | Good | ~600 |
| 4 | Income Certification | Partial | ~300 |
| 5 | Lease Execution | Partial | ~250 |
| 6 | Rent Payment & Ledger | **Complete** | ~500 |
| 7 | Recertification Engine | **Complete** | ~350 |
| 8 | Lease Renewal & Move-Out | **NOT BUILT** | — |
| 9 | Eviction & Violation | **Complete** | ~600 |
| 10 | Inspections & Maintenance | **NOT BUILT** | — |
| 11 | Compliance & Audit | Partial | ~200 |
| 12 | HUD Regulatory Auto-Update | **NOT BUILT** | — |
| 13 | Tenant Communication | **NOT BUILT** | — |
| 14 | PM Portal | Partial (Dashboard) | — |
| 15 | Master Property Registry | **Complete** (16 properties) | — |
| 16 | Third-Party Integrations | Partial (all stubbed) | — |
| 17 | Gov Agency Referral | **NOT BUILT** | — |
