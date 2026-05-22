# BP-02 Compliance Tape — Rollback Runbook

This document is the canonical rollback procedure for the BP-02 compliance
tape (`compliance_tape` table + dual-write at 5 sites, gated on the
`COMPLIANCE_TAPE_V2_ENABLED` environment variable). Reach for it only when
the conditions in **When to use** are met. Every step requires two-engineer
witness sign-off.

---

## When to use

Activate this runbook only if any of:

- `verify-cron` emits `BP-02 chain break detected` warnings for **three
  consecutive ticks** (15 minutes) without a remediating PR in flight.
- `prod-smoke.yml` `compliance-tape-verify` job fails **twice consecutively**
  on the scheduled 6h cadence.
- Application latency or error rate spikes measurably and the spike correlates
  with `compliance_tape` write volume on Railway dashboards.
- Two-engineer review concludes that compliance data integrity is at risk and
  forward repair is not feasible inside the cutover window.

If none of these apply, do **not** rollback. Forward-fix in a follow-up PR.

---

## Sign-off (two-engineer witness required)

Before running any step below the diagnose phase, both engineers must record
the decision below. Save the filled-in copy to the incident channel.

```
Engineer 1:                       Engineer 2:
Name: ______                      Name: ______
Time: ______ UTC                  Time: ______ UTC
Decision: rollback / abort        Decision: rollback / abort
```

---

## Step 1 — Halt new tape writes (flag → false)

This step is safe and reversible. Run it first regardless of which downstream
path you ultimately take.

Railway dashboard → service → **Variables**:
- Set `COMPLIANCE_TAPE_V2_ENABLED=false`
- Click **Redeploy**
- Wait for the new container to come up (verify via `GET /health`, expect
  `status:ok`)
- Confirm no new rows arriving:

```sql
SELECT COUNT(*) FROM compliance_tape
 WHERE created_at > NOW() - INTERVAL '5 minutes';
```

The count should plateau within 60 seconds of the redeploy. The legacy NDJSON
tape continues to receive events untouched. Reads through
`/api/compliance-tape/*` continue to work against historic data — no data
loss yet.

---

## Step 2 — Diagnose

Pause here. Convene the two-engineer witness review. Do **not** drop tables
or restore snapshots without sign-off.

Capture:
- Winston log lines with `BP-02 chain break detected` from the last 24h
  (Railway logs → search).
- The `compliance_tape` row count vs the NDJSON event count for the same
  window. They should be roughly equal (small drift from in-flight requests
  is fine; a large gap is itself diagnostic).
- A targeted verify call on each affected applicant:

```bash
curl -fsS \
  -H "Authorization: Bearer $JWT" \
  "$API/api/compliance-tape/verify?applicantId=<id>" | jq
```

Decision: is the corruption **bounded** (specific `applicant_id`s) or
**systemic** (every chain breaks)?

---

## Step 3 — Quarantine (preferred)

If corruption is bounded to one or more `applicant_id`s, leave the table
intact for forensic review.

- Document the affected `applicant_id`s in the incident log.
- File a follow-up PR for the forward fix (typically: identify the bad
  payload, fix the maker, re-stamp from a corrected baseline).
- Skip Step 4 and Step 5.

The `verify-cron` will continue to WARN on the affected applicants until the
forward fix lands — silence it for those ids in the log filter if the noise
is hiding new breaks.

---

## Step 4 — Full table teardown (last resort)

Only proceed if **all** of:
1. corruption is systemic (every applicant chain breaks), **and**
2. Step 3 quarantine is impractical, **and**
3. both engineers have explicitly signed off above.

Run the SQL block below from a `railway run psql` shell on prod. Capture the
output to the incident channel.

```sql
-- 1. Drop the append-only triggers so DELETE/DROP can run. Without this
--    the next statement raises 'compliance_tape is append-only'.
DROP TRIGGER IF EXISTS compliance_tape_no_update ON compliance_tape;
DROP TRIGGER IF EXISTS compliance_tape_no_truncate ON compliance_tape;

-- 2. Then either:
--    a) Soft-empty (preferred — preserves indexes + grants):
DELETE FROM compliance_tape;
--    b) Or drop entirely (only if (a) leaves bad indexes behind):
-- DROP TABLE compliance_tape CASCADE;
```

After teardown:
- If you ran (b): re-apply `src/db/migrations/2026-05-23-compliance-tape.sql`
  and `src/db/migrations/2026-05-24-compliance-tape-idem-index.sql`:
  ```bash
  railway run npm run migrate
  ```
- Leave `COMPLIANCE_TAPE_V2_ENABLED=false` until the root cause is fixed in
  code and a follow-up PR re-enables the flag in a staged rollout.

---

## Step 5 — Snapshot restore (only if Step 4 corrupts adjacent data)

If Step 4's `DROP TABLE … CASCADE` removed something it shouldn't have, or
the rollback itself introduced corruption: Railway dashboard → Database →
**Snapshots** → restore the latest pre-incident snapshot.

This rewinds **every** table in the database, not just `compliance_tape`.
Coordinate with anyone holding open transactions. Expect a brief read-only
window. Re-deploy the application after the restore completes so the
connection pool picks up a fresh handle.

---

## Step 6 — Postmortem

Within 24h of the rollback completing, file the incident in the Backlog
Tracker with:
- Trigger condition (which alert fired, what was the rate).
- Time-to-detection and time-to-mitigation.
- Root cause (best-guess if still under investigation; mark as such).
- Action items to prevent recurrence (typically: extra invariant in
  `service.ts`, new test in `__tests__/`, alert tuning).

Schedule the forward-fix PR. Do not re-flip `COMPLIANCE_TAPE_V2_ENABLED=true`
until the forward fix has shipped, soaked on staging for 24h, and the
postmortem action items are at least scheduled.

---

## Rehearsal

Before the first prod flag flip (Phase 2 Step 3), rehearse this runbook
end-to-end on an isolated Railway Postgres branch:
1. Create a branch off prod.
2. Apply both migrations.
3. Stamp ~10 rows via the dual-write site by enabling the flag temporarily on
   the branch.
4. Execute Step 1 → Step 4(a) → re-apply migrations.
5. Confirm an empty `compliance_tape` with intact indexes and triggers.
6. Tear down the branch.

The rehearsal protects against the failure mode where the rollback procedure
itself is broken — discovering that during a real incident is unacceptable.
