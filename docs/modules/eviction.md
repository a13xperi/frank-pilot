# eviction

## Purpose

Lease-violation reporting, escalation, Nevada eviction-notice generation, and court-case
tracking. Encodes NRS §118A notice periods, the LIHTC good-cause rule, the CARES Act
30-day nonpayment hold, and VAWA domestic-violence protections — the "on rails" version
of the most legally dangerous workflow in property management.

## Workflow encoded

1. **Report violation** — `reportViolation()`; `drug_violation` / `criminal_activity`
   auto-flag as material breach; VAWA detection runs here.
2. **Warn** — `issueWarning()`: audit stamp + SMS; status → `warning_issued`.
3. **Generate notice** — `generateNotice()` from NV templates with hard rules:
   - CARES Act: mortgage property + nonpayment → **forced 30-day** notice.
   - LIHTC §42(e): "no cause" notices **blocked** during the compliance period.
   - `expiration_date = serve_date + notice_period_days` per NRS §118A.
4. **File case** — `notice_served → notice_expired → filed` (justice court), with
   per-jurisdiction constable instructions (Las Vegas / Henderson / North Las Vegas).
5. **Judgment & execution** — `hearing_scheduled → judgment → writ_issued → executed`;
   illegal transitions rejected with 400.

**VAWA freeze:** `vawa_flagged=true` blocks *all* eviction actions, full stop.
Material breaches skip warning/cure (unless VAWA-flagged).

Notice periods: `pay_or_quit_7day` (7) · `perform_or_quit_5day` (5) ·
`no_cause_30day` (30) · `nonpayment_cares_30day` (30) · `nuisance_quit_3day` (3).

## Data model

- `lease_violations`: type enum, status (`reported`→`warning_issued`→`notice_served`→
  `cure_period`→`escalated`→`resolved`/`dismissed`), `is_material_breach`, `vawa_flagged`,
  evidence/cure fields.
- `eviction_notices`: notice_type enum, status (`draft`/`served`), full `notice_text`,
  `serve_date`, `expiration_date`, `certificate_of_mailing`, `cares_act_applicable`.
- `eviction_cases`: status (`pre_filing`→…→`executed`/`dismissed`/`settled`),
  `case_number`, `jurisdiction`, hearing/judgment/writ dates, `constable_instructions`.

## API surface

| Route | Permission |
|---|---|
| `POST /api/evictions/violations` | `eviction:manage` |
| `POST /api/evictions/violations/:id/warn` | `eviction:manage` |
| `POST /api/evictions/violations/:id/notice` | `eviction:manage` |
| `POST /api/evictions/cases` | `eviction:manage` |
| `PATCH /api/evictions/cases/:id` | `eviction:manage` (transition-validated) |
| `GET /api/evictions/cases` | `eviction:view` (property-scoped) |

## Compliance anchors

NRS §118A (notice periods) · LIHTC §42(e) good cause · CARES Act 30-day hold ·
VAWA 34 U.S.C. §12491 freeze. Audit stamps: `violation_reported`,
`violation_warning_issued`, `violation_notice_served`, `violation_resolved`,
`violation_dismissed`, `eviction_notice_generated`, `eviction_case_filed`,
`eviction_case_updated`.

## Flags & env

None module-specific; property-scope RBAC applies.

## Current state

**Live** end to end. Gap: VAWA detection is a placeholder (production needs a dedicated
VAWA registry check rather than a flag on the violation). Per platform policy, all
eviction-adjacent decisions remain human-reviewed.

## Key files

`src/modules/eviction/service.ts`, `src/modules/eviction/routes.ts`.
