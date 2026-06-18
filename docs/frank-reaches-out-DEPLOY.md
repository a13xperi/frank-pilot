# Deploy — Frank Reaches Out (Phases 2 & 3)

Turnkey deploy for the `feat/frank-reaches-out` integration branch (PR #324).
Pairs with `docs/frank-reaches-out-TEST.md` (what each phase does + what's counsel-gated).

- **Build:** NIXPACKS — `npm install && npm run build` (`tsc`)
- **Start:** `node dist/index.js` · **Health:** `GET /health` · **Prod host:** `api-production-ed89.up.railway.app`
- **Migrations run SEPARATELY** (not on deploy): `npm run migrate`

> ⚠️ Deploy to a **preview / staging** Railway environment — **not prod**. This branch carries unmerged
> GL-H work. Keep `FRANK_INBOUND_NOTIFY_DRY_RUN=true` for the first call. The P3 cobrowse auto-drive
> stays a **counsel-gated stub** regardless of flags (`runtime/orchestrator.ts` throws by design).

## 1. Deploy the branch
Railway → new environment / staging service tracking `feat/frank-reaches-out` (GitHub integration),
**or** from a local checkout: `railway up`. Wait for build green + `GET /health` → 200.

## 2. Run migrations (against the deploy's DB)
```
railway run npm run migrate
```
Applies pending migrations incl. **`2026-06-16-cobrowse-sessions.sql`** + **`2026-06-17-cobrowse-guided.sql`** (P3)
and `2026-05-27-voice-intake.sql` (P2 post-call persistence).

## 3. Env vars (set in the Railway environment)
```bash
# --- Phase 2: inbound notifications ---
VOICE_INTAKE_ENABLED=true
FRANK_INBOUND_NOTIFY_ENABLED=true
FRANK_INBOUND_NOTIFY_DRY_RUN=true        # start here (logs, no real SMS); flip to false when confident
TEAM_ALERT_NUMBER=+1XXXXXXXXXX           # team cell that receives care-report alerts
ELEVENLABS_WEBHOOK_SECRET=wsec_XXXXXXXX  # MUST match the secret set on the agent webhook (step 4)
TWILIO_ACCOUNT_SID=ACxxxxx               # copy the 3 Twilio values from prod (the 725 line)
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1725XXXXXXX
# --- Phase 3: cobrowse scaffold (auto-fill stays counsel-gated) ---
COBROWSE_ENABLED=true
```

## 4. Wire the inbound agent → the preview (ElevenLabs dashboard) — one-time
Agent `agent_8001ksp9ar8cf8ct2x70kacxr8qq`:
- **Post-call webhook** → `https://<preview-host>/api/webhooks/elevenlabs/post-call` (secret = `ELEVENLABS_WEBHOOK_SECRET`).
- **(P3) Server-tool `start_cobrowse`** → `https://<preview-host>/api/webhooks/elevenlabs/tools/start_cobrowse`.

> The 725 line's post-call data routes to the preview while pointed there — do this in a controlled
> test window, then revert. (The test agent has no phone, so phone testing uses the 725 agent.)

## 5. Test sequence
1. **DRY_RUN on:** call 725, report a maintenance issue → Railway logs show `inbound-notify[dry-run]: would SMS team`. Pipeline confirmed, zero SMS sent.
2. **`FRANK_INBOUND_NOTIFY_DRY_RUN=false`** + redeploy → call again → team cell gets the SMS; a callback request texts the caller a confirmation.
3. **P3:** call where Frank offers co-browse → consent → viewer link texted → open it → `CoBrowseViewer` loads (`streamReady:false`; form does NOT auto-fill — gated, expected). Caller confirms + self-signs.

## 6. Verify + rollback
- Smoke: `node post-deploy-verify.mjs` + `GET /health`.
- **Rollback = unset the flags** (all default off) + redeploy. Never wire the live 725 webhook to the preview long-term. Do not enable/build the cobrowse auto-drive without counsel sign-off.

## Phase 1 (separate — battlestation, already live)
Telegram team alerts run from the `battlestation` repo (`scripts/frank-escalations-watcher.py`, cron every 5 min) — no deploy here. Proven on a real call (06-18).
