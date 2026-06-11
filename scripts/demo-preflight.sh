#!/usr/bin/env bash
# demo-preflight.sh — 30-second read-only GO/NO-GO for the Jun 11 demo.
#
# Checks every rehearsed beat's backing surface WITHOUT mutating anything:
# no work orders created, no screenings run, no chat tokens spent (unless
# --chat). Run it after ./demo-up.sh, before the room fills.
#
#   ./scripts/demo-preflight.sh          # fast, free
#   ./scripts/demo-preflight.sh --chat   # + one real chat answer (~15s, 1 CLI call)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

API=http://localhost:3010
STAFF=http://localhost:5180
TENANT=http://localhost:5174
PASS=0; FAIL=0
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
note() { printf '  \033[1;33m·\033[0m %s\n' "$*"; }

echo "demo preflight — $(date '+%H:%M:%S')"

# ── stack up ────────────────────────────────────────────────────────────
curl -sf -m 3 "$API/health" | grep -q '"ok"' \
  && ok "API :3010 healthy" || bad "API :3010 down — run ./demo-up.sh"
curl -sf -m 3 -o /dev/null "$STAFF/" \
  && ok "staff client :5180 up" || bad "staff client :5180 down"
curl -sf -m 3 -o /dev/null "$TENANT/" \
  && ok "tenant client :5174 up" || bad "tenant client :5174 down"

# ── logins (primary driver + beat-4 driver) ─────────────────────────────
login() {
  curl -sf -m 5 -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"password123\"}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])' 2>/dev/null
}
TOKEN=$(login regional@cdpc.test)
[ -n "$TOKEN" ] && ok "login regional@cdpc.test" || bad "login regional@cdpc.test FAILED"
SENIOR=$(login senior@cdpc.test)
[ -n "$SENIOR" ] && ok "login senior@cdpc.test" || bad "login senior@cdpc.test FAILED"

authget() { curl -sf -m 5 "$API$1" -H "Authorization: Bearer $TOKEN"; }

# ── beat 1 · Maintenance: seeded work orders incl. 1 emergency ──────────
WO=$(authget /api/maintenance)
WO_N=$(printf '%s' "$WO" | grep -o '"id"' | wc -l | tr -d ' ')
if [ "${WO_N:-0}" -ge 3 ] && printf '%s' "$WO" | grep -q '"emergency"'; then
  ok "beat 1 — $WO_N work orders seeded, emergency present"
else
  bad "beat 1 — expected ≥3 work orders incl. an emergency (got ${WO_N:-0})"
fi

# ── beat 2 · Audit Log surface answers ──────────────────────────────────
curl -sf -m 5 -o /dev/null "$API/api/audit" -H "Authorization: Bearer $TOKEN" \
  && ok "beat 2 — audit log endpoint answers" \
  || bad "beat 2 — /api/audit failed"

# ── beats 3+4 · scripted applicants present ─────────────────────────────
APPS=$(authget /api/applications)
printf '%s' "$APPS" | grep -q 'Kowalski' \
  && ok "beat 3 — Tomasz Kowalski on file" || bad "beat 3 — Tomasz Kowalski MISSING"
printf '%s' "$APPS" | grep -q 'Thornton' \
  && ok "beat 4 — James Thornton on file" || bad "beat 4 — James Thornton MISSING"
if printf '%s' "$APPS" | python3 -c '
import json,sys
apps=json.load(sys.stdin)["applications"]
t=[a for a in apps if a.get("last_name")=="Thornton"]
sys.exit(0 if t and t[0].get("status")=="submitted" else 1)' 2>/dev/null; then
  ok 'beat 4 — Thornton status "submitted" (screenable live)'
else
  note 'beat 4 — Thornton not in "submitted" (already screened?) → use Elena fallback, and do NOT click "Complete Onboarding"'
fi

# ── beat 5 · The Ledger showcase — print the LIVE stat band ─────────────
SHOW=$(authget /api/ledger/showcase)
if printf '%s' "$SHOW" | grep -q '"stats"'; then
  STATS=$(printf '%s' "$SHOW" | python3 -c '
import json, sys
s = json.load(sys.stdin)["stats"]
er, u, p, cr = s["evidenceRecords"], s["unitsOnLedger"], s["properties"], s["currentRate"]
print(f"{er} evidence records · {u} units · {p} properties · {cr}% current")')
  ok "beat 5 — showcase live: $STATS"
  note "say THESE numbers in the room (runbook's may have drifted)"
else
  bad "beat 5 — /api/ledger/showcase failed"
fi

# ── bonus beat · chat widget flag + voice pill dark ─────────────────────
TENANT_PID=$(lsof -ti:5174 2>/dev/null | head -1)
if [ -n "$TENANT_PID" ] && ps eww "$TENANT_PID" | grep -q 'VITE_ENABLE_FAQ_CHAT=true'; then
  ok "bonus — chat widget flag ON in the :5174 process"
else
  bad "bonus — VITE_ENABLE_FAQ_CHAT not in the :5174 env (restart via ./demo-up.sh)"
fi
if [ -n "$TENANT_PID" ] && ps eww "$TENANT_PID" | grep -q 'VITE_ENABLE_VOICE_PILL=true'; then
  bad "bonus — VOICE PILL FLAG IS ON (must stay dark for Jun 11)"
else
  ok "bonus — voice pill flag off"
fi
VOICE=$(curl -s -m 5 -X POST "$TENANT/api/voice/sessions")
printf '%s' "$VOICE" | grep -q 'voice_disabled' \
  && ok "bonus — voice mint fails closed (503 voice_disabled)" \
  || bad "bonus — voice mint did NOT fail closed: $VOICE"

# ── optional: one real chat answer through the widget path ──────────────
if [ "${1:-}" = "--chat" ]; then
  note "asking the fee question through :5174 (~15s)…"
  ANS=$(curl -s -m 90 -X POST "$TENANT/api/housing-qa" -H 'Content-Type: application/json' \
    -d '{"question":"How much is the application fee?"}')
  printf '%s' "$ANS" | grep -q '\$35\.95' \
    && ok "bonus — chat answered with \$35.95" \
    || bad "bonus — chat answer wrong/missing: $(printf '%s' "$ANS" | head -c 160)"
  for marker in 'Carson City' 'statewide' 'HUD-LIHTC' 'Frank-Pilot'; do
    printf '%s' "$ANS" | grep -qi "$marker" && bad "bonus — LEAK MARKER in answer: $marker"
  done
fi

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32mGO\033[0m — %d checks green.\n' "$PASS"
else
  printf '\033[1;31mNO-GO\033[0m — %d failed, %d green. Fix before the room fills.\n' "$FAIL" "$PASS"
  exit 1
fi
