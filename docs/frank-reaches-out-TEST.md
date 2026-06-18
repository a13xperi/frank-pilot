# Frank Reaches Out — integration test branch

`feat/frank-reaches-out` = **`feat/phone-first-frank`** (Phase 3 cobrowse scaffold + GL-H work) **+ Phase 2** (`inbound-notify`, cherry-picked from PR #322). It is a **dark, flag-gated integration branch for end-to-end testing — NOT for merge.**

> **Phase 1** (Telegram team alerts) lives in the **battlestation** repo (`scripts/frank-escalations-watcher.py`, PR #74), not here — it polls the live agent directly and tests independently.

## Testable here vs. counsel-gated

| Phase | Surface | Status |
|---|---|---|
| **P2** | Team SMS on care reports + caller callback confirmation | ✅ testable (flag-gated) |
| **P3** | `start_cobrowse` → consent → texted viewer link → `/api/cobrowse/:id/view` → `CoBrowseViewer` page → confirm (caller **self-signs**) | ✅ scaffold testable |
| **P3** | **Live form auto-fill** (computer-use drives the wizard + screencast) | ⛔ **COUNSEL-GATED STUB** — `runtime/orchestrator.ts` throws by design ("DO NOT WIRE LIVE … pending counsel sign-off on autonomously driving an applicant's housing application"). Do **not** expect Frank to fill the form; that awaits sign-off. |

## Env / flags for testing (set in the deploy env — never commit real secrets)

```
# --- Phase 2: inbound notifications ---
VOICE_INTAKE_ENABLED=true             # opens the post-call webhook receiver
FRANK_INBOUND_NOTIFY_ENABLED=true
FRANK_INBOUND_NOTIFY_DRY_RUN=true     # logs instead of sending; flip to false for live SMS
TEAM_ALERT_NUMBER=+1XXXXXXXXXX        # team cell that gets care-report alerts
TWILIO_ACCOUNT_SID=...                # the 725 line (already configured in prod)
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1725XXXXXXX
ELEVENLABS_WEBHOOK_SECRET=wsec_...    # the inbound agent's post-call webhook secret

# --- Phase 3: cobrowse scaffold (auto-fill stays gated regardless of this flag) ---
COBROWSE_ENABLED=true
```

## Live-agent steps (operator; one-time)
1. Point the **inbound** agent (`agent_8001ksp9ar8cf8ct2x70kacxr8qq`) **post-call webhook** at `https://<host>/api/webhooks/elevenlabs/post-call` (HMAC secret = `ELEVENLABS_WEBHOOK_SECRET`).
2. *(P3)* Register the `start_cobrowse` server-tool on the inbound agent → `https://<host>/api/webhooks/elevenlabs/tools/start_cobrowse`.

## Test plan
**P1 — battlestation (separate):** confirm the watcher cron is installed (`scripts/install-cron.sh`); place an inbound care-line call → expect a Telegram ping within ~5 min (🚨 for high/emergency). Re-run the watcher → no duplicate.

**P2 — this branch (deployed), flags above, `DRY_RUN=true` first:** place an inbound call that logs a care report (so `incident_category` is captured). On hang-up:
- DRY_RUN: logs show `inbound-notify[dry-run]: would SMS team`.
- Live (`DRY_RUN=false`): the team cell receives the SMS; if the caller asked for a callback, they get the confirmation text.

**P3 scaffold — this branch (deployed), `COBROWSE_ENABLED=true`:** place a call where Frank offers co-browse → consent → you receive a texted viewer link → open it → `CoBrowseViewer` loads and `/view` returns session metadata (`streamReady:false`). The form does **not** auto-fill (gated). The caller's confirmation + self-signature records via `confirm-cobrowse`.

## Do NOT
- **Merge this branch to `main`** — it's an integration/test branch (P2 → PR #322 is the mergeable unit).
- **Enable or build the live cobrowse drive without counsel sign-off** — the orchestrator stub is a deliberate compliance fence on autonomously filling housing applications.
- **Sign on the applicant's behalf** — e-sign-by-proxy is prohibited.
