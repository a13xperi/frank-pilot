# Runbook — Donna Louise 2: replace stale placeholder units with the real 48

**Owner:** operator (DML against Railway prod, the shared multi-tenant DB).
**When:** once, after PR #351 (picker AMI fix) is merged + deployed, to make DL2
applyable for the first real applicant. Reusable as the template for the other
GPMG buildings.

## Why this is needed

`onboard-property.ts` is **additive only** — it creates units
`ON CONFLICT (property_id, unit_number) DO NOTHING`. Donna Louise 2 currently
holds **stale generic seed units** (the studio $747 / 1BR $995 / 2BR $1194
template every property carries), with unit numbers `A-101…`, `B-201…`. Those
numbers collide with the numbers the loader generates for the real mix, so a
plain re-run is a **no-op on the wrong rows** — the wrong $995/$1194 rents and
wrong counts (9×1BR, not 30) would survive.

So the stale units must be **deleted first**, then the loader run. The loader
keeps its "never delete" safety rail by design; the delete is an explicit,
operator-reviewed step here.

Target state from `src/db/data/onboard/donna-louise-2.json`:
- 30 × 1BR @ **$890** (`1BR_45AMI`)  ·  18 × 2BR @ **$1068** (`2BR_45AMI`)
- `ami_set_aside = "40%/45% AMI: 30 1BR + 12 2BR affordable; 6 2BR market-rate"`
- (The finer 28/2/10/2/6 per-unit AMI split is set in OneSite at lease-up, per
  the json's own note — not by the loader.)

## Pre-flight (read-only — run these first, confirm the output)

```sql
-- 1. Resolve the property id by the SAME slug derivation the app uses.
--    Expect exactly one row (the DL2 property).
SELECT id, name, unit_count, ami_set_aside
  FROM properties
 WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g'))
       = 'donna-louise-2';

-- 2. Show the current (stale) units for that property.
SELECT unit_number, bedrooms, monthly_rent, status, available_from
  FROM units
 WHERE property_id = (SELECT id FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name),'[^a-z0-9]+','-','g'))
              = 'donna-louise-2')
 ORDER BY unit_number;

-- 3. Safety check: are ANY of those units referenced by a real application
--    claim or a sealed compliance tape? For a never-applyable building this
--    MUST return 0. If it returns >0, STOP — a real person is attached to a
--    unit; do not delete, escalate instead.
SELECT count(*) AS referenced_units
  FROM units u
 WHERE u.property_id = (SELECT id FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name),'[^a-z0-9]+','-','g'))
              = 'donna-louise-2')
   AND ( EXISTS (SELECT 1 FROM applications a WHERE a.claimed_unit_id = u.id)
      OR EXISTS (SELECT 1 FROM compliance_tape c WHERE c.subject_unit_id = u.id) );
```

## Apply — step A: delete the stale units (guarded)

Only runs if pre-flight #3 returned **0**. The `NOT EXISTS` guards make this
self-protecting: it refuses to touch any unit tied to an application or a
compliance tape even if you skipped the check.

```sql
DELETE FROM units u
 WHERE u.property_id = (SELECT id FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name),'[^a-z0-9]+','-','g'))
              = 'donna-louise-2')
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.claimed_unit_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM compliance_tape c WHERE c.subject_unit_id = u.id);
-- Expect: DELETE <n> where <n> == the row count from pre-flight #2.
```

## Apply — step B: load the real 48 units

From the deployed `api` service checkout (or a local checkout pointed at the
prod `DATABASE_URL`):

```bash
ts-node src/db/onboard-property.ts src/db/data/onboard/donna-louise-2.json
```

The loader UPDATEs the property row in place, refreshes `unit_mix` /
`rent_schedule`, and creates 48 units (`A-101…A-130`, `B-201…B-218`). It prints
a field-level diff and a final `Done: … 48 unit rows (48 available)`.

## Verify (read-only)

```sql
SELECT bedrooms, monthly_rent, count(*)
  FROM units
 WHERE property_id = (SELECT id FROM properties
        WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name),'[^a-z0-9]+','-','g'))
              = 'donna-louise-2')
 GROUP BY bedrooms, monthly_rent
 ORDER BY bedrooms;
-- Expect: 1BR ×30 @ 890 ; 2BR ×18 @ 1068.
```

Then re-run the applicant smoke test against the live site: a ≤45% AMI applicant
who deep-links via `frank-go.vercel.app/dl2` should now see DL2's real $890 /
$1068 units (PR #351 makes the 40/45% set-aside reachable; the picker
deep-link scopes the list to DL2). Only after that should the apply link go to
the real applicant.

## Rollback

The loaded units are additive and carry no applicant data immediately after
load, so rollback is the same guarded `DELETE` from step A (it will refuse once
a real claim is attached — which is the point).
