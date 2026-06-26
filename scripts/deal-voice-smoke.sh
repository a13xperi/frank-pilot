#!/usr/bin/env bash
# deal-voice-smoke.sh - endpoint smoke test for the ask_deal_docs in-call tool.
#
# Hits the DEPLOYED ElevenLabs tool-callback endpoint the way ElevenLabs does
# (POST flat JSON + the x-elevenlabs-tool-secret header) and asserts the compartment
# wall holds end to end: an enrolled caller gets a masked answer (no $/cap), a
# stranger is refused (never answered), a wrong agent is refused, and a bad
# secret is rejected at the auth layer. Non-zero exit on any failure (CI style).
#
# Required env:
#   BASE_URL            e.g. https://frank-pilot-production.up.railway.app
#   ELEVENLABS_TOOL_SECRET   the deployed ELEVENLABS_TOOL_SECRET
#   DEAL_DESK_AGENT_ID  the deployed deal-desk agent id
#   ENROLLED_CALLER     a phone ON the deployed DEAL_QA_VOICE_ALLOWLIST (E.164)
# Optional env:
#   STRANGER_CALLER     a phone NOT on the allow-list (default +15555550123)
#
# Usage:
#   BASE_URL=https://... ELEVENLABS_TOOL_SECRET=... DEAL_DESK_AGENT_ID=agent_... \
#   ENROLLED_CALLER=+1702... bash scripts/deal-voice-smoke.sh
set -euo pipefail

: "${BASE_URL:?set BASE_URL}"
: "${ELEVENLABS_TOOL_SECRET:?set ELEVENLABS_TOOL_SECRET}"
: "${DEAL_DESK_AGENT_ID:?set DEAL_DESK_AGENT_ID}"
: "${ENROLLED_CALLER:?set ENROLLED_CALLER (must be on DEAL_QA_VOICE_ALLOWLIST)}"
STRANGER_CALLER="${STRANGER_CALLER:-+15555550123}"

URL="${BASE_URL%/}/api/webhooks/elevenlabs/tools/ask_deal_docs"
BODYF="$(mktemp)"
trap 'rm -f "$BODYF"' EXIT
fails=0
HTTP=""
BODY=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# post <secret> <json-body> -> sets HTTP (status code) and BODY (response text)
post() {
  local secret="$1" body="$2" code
  code="$(curl -sS -o "$BODYF" -w '%{http_code}' \
    -X POST "$URL" \
    -H 'content-type: application/json' \
    -H "x-elevenlabs-tool-secret: ${secret}" \
    --data "$body" 2>/dev/null)" || code="000"
  HTTP="$code"
  BODY="$(cat "$BODYF" 2>/dev/null || true)"
}

echo "ask_deal_docs smoke -> $URL"

# 1. Enrolled caller, economics question: 200 + ok:true + NO $/cent/51%/sentinel.
post "$ELEVENLABS_TOOL_SECRET" \
  "$(printf '{"question":"what are the economics and the deal size","caller_id":"%s","agent_id":"%s"}' \
    "$ENROLLED_CALLER" "$DEAL_DESK_AGENT_ID")"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | grep -q '"ok":true'; then
  if printf '%s' "$BODY" | grep -Eq '\$[0-9]|¢|51 ?%|\[scoped\]'; then
    fail "enrolled econ question leaked a figure/sentinel: $BODY"
  else
    pass "enrolled caller answered, masked (no figure leak)"
  fi
else
  fail "enrolled caller: expected 200 ok:true, got HTTP $HTTP $BODY"
fi

# 2. Stranger caller: refused (ok:false), never answered.
post "$ELEVENLABS_TOOL_SECRET" \
  "$(printf '{"question":"what is the deal size","caller_id":"%s","agent_id":"%s"}' \
    "$STRANGER_CALLER" "$DEAL_DESK_AGENT_ID")"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | grep -q '"ok":false'; then
  pass "unknown caller refused (not answered)"
else
  fail "stranger: expected 200 ok:false, got HTTP $HTTP $BODY"
fi

# 3. Wrong agent id: refused by the pin.
post "$ELEVENLABS_TOOL_SECRET" \
  "$(printf '{"question":"how is it structured","caller_id":"%s","agent_id":"agent_not_the_deal_desk"}' \
    "$ENROLLED_CALLER")"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | grep -q '"ok":false'; then
  pass "wrong agent id refused (pin)"
else
  fail "wrong agent: expected 200 ok:false, got HTTP $HTTP $BODY"
fi

# 4. Bad secret: rejected at the auth layer (never 200).
post "wsec_wrong_secret_value" \
  "$(printf '{"question":"hello","caller_id":"%s","agent_id":"%s"}' \
    "$ENROLLED_CALLER" "$DEAL_DESK_AGENT_ID")"
if [ "$HTTP" != "200" ]; then
  pass "bad secret rejected at auth layer (HTTP $HTTP)"
else
  fail "bad secret: expected non-200, got 200 $BODY"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "ALL SMOKE CHECKS PASSED"
else
  echo "$fails CHECK(S) FAILED"
  exit 1
fi
