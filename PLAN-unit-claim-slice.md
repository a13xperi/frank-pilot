# Unit-Claim Slice — Burn Plan

**Created:** 2026-05-14
**Status:** Migration shipped to local DB + schema.ts updated. Backend routes, seed, and frontend still pending.
**Branch:** `feat/my-application-messaging`
**Last commit:** `e928d9e` (applicant routing fix)
**Dirty tree at pause:** `src/db/schema.ts` + `src/db/migrations/2026-05-14-units-and-intent.sql` (uncommitted)

---

## Why This Slice

FTU on Frank-Pilot is an **applicant**, not a tenant. Conversion = get them to **plant a flag on a specific available unit** as early as possible. The claimed unit becomes psychologically theirs — every subsequent doc upload, income verification, and screening step is in service of *keeping* that unit. Skin in the game.

See [memory: `project-ftu-unit-claim-carrot.md`].

---

## End-State Flow (post-slice)

```
/apply
  │
  ▼
┌────────────────┐ POST /applicants/register
│ STEP 1 ACCOUNT │ ───────────────────────►  magic-link email
│ name + email   │
└────────────────┘
  │
  ▼ magic-link verify  →  AuthCallback  →  /apply?step=intent
┌────────────────┐                                 NEW
│ STEP 2 INTENT  │  5 questions:
│ quick quiz     │   1. Bedrooms wanted (Studio/1/2/3/4+)
│                │   2. Monthly budget slider ($500-$3000)
│                │   3. Target move-in date
│                │   4. Household size (1-8)
│                │   5. Property preference (optional)
└────────────────┘
  │  POST /applicants/intent
  ▼
┌────────────────┐                                 NEW
│ STEP 3 PICK    │  GET /applicants/units?intent=…
│ unit grid      │  Up to 12 cards w/ photos, rent, beds
│                │  "Claim this unit" CTA
└────────────────┘
  │  POST /applicants/claim-unit/:id
  ▼
┌────────────────┐                                 NEW
│ STEP 4 CLAIM   │  Modal: unit photo + 48h countdown
│ confirmation   │  CTA: "Continue your application"
└────────────────┘
  │
  ▼
┌────────────────┐
│ STEP 5 DETAILS │  Existing details form (SSN/DOB/income/etc)
│ form + header  │  NEW: sticky header with claimed unit photo
│                │  + live countdown timer
└────────────────┘
```

---

## Status: Phase 1 — Migration ✅ DONE

Committed-ready (NOT yet committed):
- `src/db/migrations/2026-05-14-units-and-intent.sql` — applied to local Postgres
- `src/db/schema.ts` — `units` table added, applications got intent_* + claimed_unit_id + claim_expires_at columns

```sql
-- units table
id, property_id (FK), unit_number, bedrooms, bathrooms, sqft, monthly_rent,
status (available|held|leased|off_market), photo_url, description,
available_from, created_at, updated_at
UNIQUE (property_id, unit_number)
indexes on (property_id, status), partial WHERE status='available', (bedrooms, monthly_rent)

-- applications additions
intent_bedrooms, intent_budget_min, intent_budget_max, intent_move_in_date,
intent_household_size, claimed_unit_id (FK to units), claim_expires_at
```

**Next-burn action:** `git add src/db/migrations/2026-05-14-units-and-intent.sql src/db/schema.ts && git commit` with message `feat(db): units table + applicant intent/claim columns`.

---

## Next-Burn Checklist (sequenced)

### Phase 2 — Seed (~20 min)
**File:** `src/db/seed.ts` (extend) or new `src/db/seed-units.ts`
- For each existing property: iterate `unit_mix` JSON (e.g. `{"1BR":40,"2BR":80}`)
- Generate N units per bedroom type with deterministic unit numbers (e.g. `A-101`, `A-102`, …)
- Pull `monthly_rent` from `properties.rent_schedule` JSON or fallback per-bedroom default
- Status distribution: ~30% available, ~50% leased, ~20% held (with expired claim_expires_at so they re-appear available)
- Photo URL: `https://picsum.photos/seed/${unit_id_short}/800/600` (deterministic Lorem Picsum) — replace with real photos later
- Run `npm run seed:demo` to verify

**Acceptance:** `SELECT count(*) FROM units WHERE status='available';` returns >50 across all properties.

### Phase 3 — Backend routes (~60 min)
**File:** `src/modules/applicants/routes.ts`

#### `POST /applicants/intent` (authenticated, requireEmailVerified)
Save the 5 quiz answers onto the user's current draft application (UPSERT — find draft, or create one). Returns the application id.

#### `GET /applicants/units` (authenticated, requireEmailVerified)
Query params: `bedrooms` (int), `maxRent` (numeric), `moveInBy` (date), `propertyId` (uuid, optional). Returns up to 12 units joined with property name, where:
```sql
status = 'available'
OR (status = 'held' AND claim_expires_at < NOW())
```
Auto-expire stale holds in the query — don't need a cron.

Response shape:
```typescript
{ units: Array<{
    id, property_id, property_name, property_city, property_state,
    unit_number, bedrooms, bathrooms, sqft, monthly_rent,
    photo_url, available_from
  }> }
```

#### `POST /applicants/claim-unit/:id` (authenticated, requireEmailVerified)
Atomic transaction:
1. `SELECT … FROM units WHERE id=:id FOR UPDATE`
2. Verify `status='available'` OR (`status='held'` AND `claim_expires_at < NOW()`). Otherwise 409 `UNIT_UNAVAILABLE`.
3. Release any existing claim by this user (free up unit if they're switching)
4. `UPDATE units SET status='held'` for the new unit
5. `UPDATE applications SET claimed_unit_id=:id, claim_expires_at=NOW()+'48 hours'` for the user's draft
6. Return `{ unit, expires_at }`

#### `DELETE /applicants/claim-unit` (authenticated, requireEmailVerified)
Release the current user's claim — set unit back to `available`, clear application's claimed_unit_id + claim_expires_at.

**Acceptance:** integration test in `src/__tests__/unit-claim.test.ts` covering: claim available → 200, claim held → 409, claim expired-held → 200 (treats as available), DELETE → unit back to available.

### Phase 4 — Frontend (~120 min)
**Files:**
- `client-tenant/src/api/units.ts` — NEW: `fetchUnits(intent)`, `claimUnit(id)`, `releaseClaim()`
- `client-tenant/src/pages/Apply.tsx` — extend the `Step` union: `1 | 'verify' | 'intent' | 'pick' | 'claim' | 2`
- `client-tenant/src/pages/AuthCallback.tsx` — change `/apply?step=2` → `/apply?step=intent` for new applicants
- `client-tenant/src/components/UnitCard.tsx` — NEW
- `client-tenant/src/components/ClaimedUnitHeader.tsx` — NEW (sticky on step 2 / details)

**Step 2 intent quiz UI:** big tappable button rows for bedrooms, range input for budget, native date input for move-in, select for household size. Single submit → save intent → advance.

**Step 3 unit picker:** 2-col grid on desktop, 1-col on mobile. Each card: hero photo (16:9 cropped), property name + city/state, unit number, "$X/mo", bedrooms·bath·sqft pill, "Claim this unit" green button.

**Step 4 claim confirmation:** centered modal-style card, large unit photo, "**Unit X is yours until [date+48h]**", live ticking countdown ("47:59:32"), CTA "Continue your application" → goes to step 2 (existing details form).

**Step 2 (renamed to step 5 conceptually) sticky header:** thin pinned card at top of details form: thumbnail (64px), property + unit one-liner, "$X/mo", small countdown. Persistent reminder of what they're working toward.

### Phase 5 — Polish (~30 min)
- Wire claimed-unit data into existing `/application` status page so it shows the unit
- Add "Release this unit" button on the status page so users can switch their claim
- Consider: cron job to auto-expire claims older than 48h and set unit back to available (currently lazy-expire via query is fine for MVP)

---

## Open Product Questions (decide before next burn)

1. **Claim hold duration**: 48h confirmed in plan. Should this be 24h to add urgency, or 72h to be forgiving? — Default 48h until told otherwise.
2. **Multiple intents over time**: if user comes back next week, do their old intent answers prefill, or do they re-quiz? — Default: prefill, but allow edit.
3. **Switching claims**: explicit DELETE + new POST (clean), or POST replaces silently? — Plan as-written: POST replaces (releases old claim atomically).
4. **Photos**: Lorem Picsum placeholders for now. Real upload UI is a separate slice (Phase 2 of project map).
5. **Optional password**: defer to Phase 2 of project map (out of scope for this slice).

---

## Project-Wide Roadmap (parent context)

This slice is **Phase 1** of the full Frank-Pilot roadmap. The other phases (incremental docs + progress bar, staff workflow, tenant lifecycle, hardening backlog, public surface) are summarized in the most recent advisor diagram and tracked via memory `project-ftu-unit-claim-carrot.md`.

---

## Files Touched In This Burn

```
src/db/migrations/2026-05-14-units-and-intent.sql   NEW    (applied to local DB)
src/db/schema.ts                                    EDIT   (units + applications cols)
PLAN-unit-claim-slice.md                            NEW    (this file)
```
