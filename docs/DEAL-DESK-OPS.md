# Frank Deal Desk — ops & learnings

A call-in voice line (**+1 725 201 0817**) that lets an enrolled partner ask the
deal corpus a question and hear a grounded, **compartment-masked** answer. Separate
ElevenLabs agent from the 725 tenant line. Code: `src/modules/voice-intake/deal-tool.ts`
(`ask_deal_docs` handler) + `deal-voice.ts`; reuses the deal-qa compartment-guard + corpus.

## Live wiring (as of 2026-06-26)
- EL agent: `agent_8001kw1mgmkweaytq32vf6dfs39y` ("Frank Deal Desk", Frank voice).
- Number: `+1 725 201 0817` = EL `phnum_5101kw1k1sthfpw8xpswsvn7j0am` (Twilio), assigned.
- Tool: `POST /api/webhooks/elevenlabs/tools/ask_deal_docs`.
- Confirmed end-to-end on a live call: caller_id IS injected by EL, masking holds on voice.

## Deploy (frank-pilot `api` is NOT GitHub-connected — manual `railway up`)
Deploy a branch (the normal `deploy-frank.sh` ships `origin/main`):
```
sed 's#origin/main#origin/feat/deal-qa-voice#g' ~/code/battlestation/scripts/deploy-frank.sh > /tmp/d.sh && bash /tmp/d.sh
```
This is a production deploy of the LIVE service (shares the 725 tenant line), so it is
classifier-gated — the operator runs it (e.g. `! bash /tmp/d.sh`).

### ⚠️ CRITICAL: env-var ordering (cost us a confusing failure)
A `railway variables --set ...` AFTER a manual `railway up` triggers a redeploy that
**reverts the running code to a non-branch build**, silently dropping what you just
deployed. Symptom: an endpoint that worked right after deploy starts returning
`{"ok":false,"message":"Tool not yet implemented"}`.
- **Set ALL env vars FIRST, then `railway up` LAST.** Vars persist across deploys.
- If you must change a var on an already-deployed branch, **re-run the branch deploy** after.
- Verify by **curling the live container**, not just `railway variables` (which shows
  config, not the running container's env).

## Auth contract
Tool router authenticates via header **`x-elevenlabs-tool-secret`** == env
**`ELEVENLABS_TOOL_SECRET`** (both set in prod; the 725 tools use them too), gated by
`VOICE_TOOLS_ENABLED=true`. NOT `x-frank-tool-secret` / `VOICE_TOOL_SECRET`.

## Enroll a caller (grant access)
`DEAL_QA_VOICE_ALLOWLIST="+1NUMBER:privileged,+1OTHER:ext-named"` (E.164:tier, comma-sep).
Set it, then **re-deploy** (per the var gotcha). Tiers, most → least exposure on voice:
`privileged` > `ext-named` > `ext-generic`. Unknown number → currently refused
(fail-closed); the anonymous Level-1 teaser is a not-yet-finished slice.

## ElevenLabs agent provisioning (learnings)
- Create: `POST /v1/convai/agents/create` with `conversation_config` (voice_id Frank =
  `0hghHo7QnCixqORu75zl`, llm `claude-sonnet-4-5`, the `ask_deal_docs` webhook tool).
- A tool param fed by a system var must set `dynamic_variable: "system__caller_id"` and an
  **empty `description`** (EL rejects "only one of {description, dynamic_variable, ...}").
  Params: `question`=LLM, `caller_id`=`system__caller_id`, `agent_id`=`system__agent_id`.
- Numbers originate from **Twilio** (creds live in Railway, not local `.env`): buy via
  `railway run` + Twilio API, import via `POST /v1/convai/phone-numbers`, assign via
  `PATCH /v1/convai/phone-numbers/{id}` `{agent_id}`.

## Reviewing calls
Not yet wired into the post-call capture pipeline (so no `voice_intake_calls` rows). Pull
from EL directly: `GET /v1/convai/conversations?agent_id=…` → `GET /v1/convai/conversations/{id}`
for the transcript + tool I/O.

## Open slices (design locked 2026-06-26)
1. **Answer quality** — corpus passages are markdown-heavy; the voice read `---`/`>`/backtick
   refs as junk. `cleanForSpeech()` now strips them + skips formatting-only passages (this
   commit). Deeper: voice-optimize the corpus, or add a compose pass.
2. **Progressive disclosure** — anonymous → L1 curated public teaser (`deal-public-teaser.json`,
   started) instead of a refusal; validate to escalate.
3. **Validation** — BOTH a PIN (reuse 725 `send_pin`/`verify_pin`) and a passphrase, escalating
   the session tier. (A caller asked "how do I validate?" live; Frank had no flow.)
4. **Learning loop** — wire post-call capture + a call-review pass (with a compartment-boundary
   check) like Frank Pilot, so calls auto-log and get scored.
