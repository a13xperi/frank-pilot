# Runbook — Frank 725 inbound voice go-live

> **State (verified Jun 16):** code is complete + **fail-closed**. The webhook receiver is mounted unconditionally (the path never 404s), but returns `503` unless `VOICE_INTAKE_ENABLED=true`, `503` if the secret is the `wsec_changeme` sentinel, and `400` on a bad/stale/missing signature. **The only remaining variables are config + one real call.** Linear: ADI-192 · ADI-206 · ADI-208 · ADI-209 (IN-2).

## What's already proven (so you're flipping config, not debugging code)
- **Handler logic** — `src/__tests__/voice-intake-webhook.test.ts` (+ 7 sibling suites, **97 tests green**) pins the full path: a correctly-signed `post_call_transcription` → dedupe check → `INSERT INTO voice_intake_calls` → `VOICE_INTAKE_COMPLETED` tape stamp → `markProcessed`; plus every fail-closed branch (disabled, sentinel secret, tampered sig, stale ts, duplicate, DLQ park).
- **Schema on real Postgres 16** — base `SCHEMA_SQL` + all **39 migration deltas** apply clean on a fresh DB (`ON_ERROR_STOP=1`); `voice_intake_calls`, `elevenlabs_processed_events`, `elevenlabs_webhook_dlq` all present. So `railway run npm run migrate` will apply clean against prod (see step 3).
- **Live smoke tool** — `scripts/voice-intake-smoke.mjs` signs a payload exactly like ElevenLabs and POSTs it; its signature is parity-verified against the repo's `verifySignature` (accepted; tamper rejected). Use it to prove the pipe end-to-end **without** a phone call (steps below).

---

## The 5 gate steps (in order — minutes each)

### 1. ADI-192 — provision a dedicated **prod ElevenLabs API key**
In the ElevenLabs dashboard (Conversational AI), mint a prod key for Frank's workspace. Confirm the inbound agent (`agent_8001…`, the grounded 725 agent) has its **post-call webhook URL** pointed at:
```
https://<prod-api-host>/api/webhooks/elevenlabs/post-call
```
and copy its **webhook signing secret** (used in step 2).

### 2. ADI-206 — set Railway prod env (kill the sentinel)
```bash
railway status          # confirm you're linked to the PROD service + environment first
railway variables --set ELEVENLABS_API_KEY=<prod key from step 1>
railway variables --set ELEVENLABS_WEBHOOK_SECRET=<real signing secret from step 1>   # NOT wsec_changeme
```
> If `ELEVENLABS_WEBHOOK_SECRET` is left as `wsec_changeme`, the webhook stays fail-closed (503) by design — this is the safety sentinel.

### 3. Run the prod migration (prod DB is stale)
```bash
railway run npm run migrate          # applies base schema + any pending tracked deltas, idempotently
railway run npm run migrate status   # shows applied vs pending — expect 0 pending
```
> `migrate` is idempotent (CREATE … IF NOT EXISTS, enum guards, `schema_migrations` tracking). Dry-checked Jun 16 on a fresh PG16: base + 39 deltas applied clean.

### 4. ADI-208 — flip the inbound flag (leave tools off for the first pass)
```bash
railway variables --set VOICE_INTAKE_ENABLED=true
# leave VOICE_TOOLS_ENABLED=false on the first pass (in-call server tools stay dark)
```
A deploy will roll. Once it's live, smoke the webhook **before** the phone call:
```bash
# pre-flip you can point this at staging; here, prove prod accepts a signed payload + persists the row:
ELEVENLABS_WEBHOOK_SECRET=<real secret> DATABASE_URL=<prod db url> \
  node scripts/voice-intake-smoke.mjs https://<prod-api-host> --verify-row --cleanup
# expect: 01-webhook-accepts-signed-payload PASS, 02-row-persisted PASS, smoke row cleaned up
```

### 5. ADI-209 / IN-2 — one **real call to 725**
Call **725**, complete the intake, then verify:
```sql
-- a row for your call (most recent):
-- NOTE: voice_intake_calls has NO `status` column — the call outcome lives in `call_successful`.
SELECT conversation_id, agent_id, call_successful, started_at, created_at
  FROM voice_intake_calls ORDER BY created_at DESC LIMIT 5;

-- nothing parked in the dead-letter queue in the last hour (expect 0):
SELECT count(*) FROM elevenlabs_webhook_dlq WHERE created_at > now() - interval '1 hour';

-- the compliance tape stamped the completion:
-- NOTE: by default the tape lands in the NDJSON ledger; a `compliance_tape` ROW only
-- appears when COMPLIANCE_TAPE_V2_ENABLED=true. Without the flag, 0 rows here is EXPECTED —
-- the canonical go-live signals are the voice_intake_calls row + DLQ count = 0.
SELECT kind, session_id, created_at
  FROM compliance_tape WHERE kind = 'VOICE_INTAKE_COMPLETED'
  ORDER BY created_at DESC LIMIT 5;
```
Then confirm the call shows in the **PM console** (voice-intake list/approve view). ✅ Go-live done.

---

## Rollback (instant, no deploy needed)
```bash
railway variables --set VOICE_INTAKE_ENABLED=false   # webhook returns to 503 fail-closed
```
The path stays mounted (no 404); ElevenLabs retries are absorbed harmlessly. Re-flip when ready.

## Notes
- **Keep `VOICE_TOOLS_ENABLED=false`** until the inbound happy path is confirmed — it gates in-call server tools (e.g. `send_app_link`) separately, same fail-closed pattern.
- A failed dispatch **parks in `elevenlabs_webhook_dlq` and still 200s ElevenLabs** (no retry storm); watch the DLQ count as your health signal.
- Smoke rows are tagged `conv_SMOKE_<ts>` — `--cleanup` removes them so prod stays pristine.
