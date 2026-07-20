#!/usr/bin/env bash
# e2e-system-test.sh — Frank-pilot SYSTEM E2E: boots the real server in three postures and
# proves the launch-critical properties end-to-end (HTTP + DB), with a PASS/FAIL board and
# a non-zero exit on any failure. Complements the Switchboard voice battery (conversation
# layer) — this is the SYSTEM layer: routes → tools → DB states.
#
#   A · PROD-POSTURE SAFETY   stubs OFF, no vendor keys → a screened application must HOLD
#                             in `screening_review` (no auto-approve on fake data). THE gate.
#   B · HAPPY PATH            stubs ON (MOCK_MODE) → the full applicant journey completes and
#                             screening lands `screening_passed`.
#   C · VOICE-TOOL PATH       the real /api/webhooks/elevenlabs/tools/:name route: auth is
#                             enforced, read tools answer, and create_application REFUSES an
#                             unverified phone (the verify-first server fence).
#
# Fully local + inert: dockerized Postgres, no Twilio/Resend/ElevenLabs/live-Stripe. Needs:
# docker postgres on :5432 (docker-compose.yml), `npm run migrate && npm run seed` done once,
# psql + jq on PATH (macOS: /opt/homebrew/opt/libpq/bin). Runs on macOS bash 3.2.
#
#   bash scripts/e2e-system-test.sh              # all three postures
#   bash scripts/e2e-system-test.sh A            # one posture (A|B|C)
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

# ── env (pinned; ENCRYPTION_KEY must match the seed run or SSNs won't decrypt) ──────────
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export NODE_ENV=development
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}" DB_NAME="${DB_NAME:-frank_pilot}"
export DB_USER="${DB_USER:-postgres}" DB_PASSWORD="${DB_PASSWORD:-changeme}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-1f2e3d4c5b6a798812345678901234567890abcdef1234567890abcdef123456}"
export JWT_SECRET="${JWT_SECRET:-e2e-dev-secret}"
export DEMO_LINK_IN_RESPONSE=1
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_e2e_local_fixed}"
PORT="${E2E_PORT:-3102}"; export PORT
API="http://localhost:$PORT"
PG="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
TOOL_SECRET="e2e-tool-secret-distinct"
WEBHOOK_SECRET="wsec_e2e_webhook"

ONLY="${1:-ALL}"
PASS=0; FAIL=0; BOARD=""
ok()   { PASS=$((PASS+1)); BOARD="$BOARD
  PASS  $1"; printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); BOARD="$BOARD
  FAIL  $1"; printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
note() { printf '\033[36m▸\033[0m %s\n' "$*"; }

SERVER_PID=""
boot() { # boot <label> [extra env as VAR=VAL ...]
  local label="$1"; shift
  note "boot server · $label"
  # shellcheck disable=SC2086
  env "$@" npx ts-node src/index.ts > "/tmp/frank-e2e-$label.log" 2>&1 &
  SERVER_PID=$!
  local i=0
  while [ $i -lt 45 ]; do
    curl -fsS -m 2 "$API/health" >/dev/null 2>&1 && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || { bad "$label: server died on boot (see /tmp/frank-e2e-$label.log)"; return 1; }
    sleep 2; i=$((i+1))
  done
  bad "$label: /health never came up"; return 1
}
shutdown() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }
trap 'shutdown' EXIT

dbq() { psql "$PG" -tA -c "$1" 2>/dev/null; }

rand_ssn() { printf "%03d-%02d-%04d" $((RANDOM%900+100)) $((RANDOM%90+10)) $((RANDOM%9000+1000)); }

# ── the applicant journey (register → … → submitted); echoes APP_ID ─────────────────────
journey() { # journey <email>
  local email="$1" reg link token verify jwt intent app_id units unit_id prop_id
  reg=$(curl -fsS -X POST "$API/api/applicants/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"firstName\":\"E2E\",\"lastName\":\"Journey\",\"phone\":\"702-555-0142\"}") || return 1
  link=$(echo "$reg" | jq -r '.devLink // empty'); [ -n "$link" ] || return 1
  token=$(echo "$link" | sed -E 's|.*token=([^&]+).*|\1|')
  verify=$(curl -fsS -X POST "$API/api/auth/magic-link/verify" -H 'Content-Type: application/json' -d "{\"token\":\"$token\"}") || return 1
  jwt=$(echo "$verify" | jq -r '.token')
  intent=$(curl -fsS -X POST "$API/api/applicants/intent" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' \
    -d '{"bedrooms":1,"budget_max":1200,"move_in_date":"2026-08-01","household_size":2,"gross_annual_income":32000,"qualifying_ami_tier":"50"}') || return 1
  app_id=$(echo "$intent" | jq -r '.application_id')
  units=$(curl -fsS "$API/api/applicants/units?bedrooms=1&maxRent=1200&amiTier=50" -H "Authorization: Bearer $jwt") || return 1
  unit_id=$(echo "$units" | jq -r '.units[0].id // empty'); [ -n "$unit_id" ] || return 1
  prop_id=$(echo "$units" | jq -r '.units[0].property_id')
  curl -fsS -X POST "$API/api/applicants/claim-unit/$unit_id" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' -d '{}' >/dev/null || return 1
  curl -fsS -X POST "$API/api/applicants/apply" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg pid "$prop_id" --arg em "$email" --arg ssn "$(rand_ssn)" '{propertyId:$pid,firstName:"E2E",lastName:"Journey",ssn:$ssn,dateOfBirth:"1991-02-03",email:$em,phone:"702-555-0142",currentAddressLine1:"1200 Maryland Pkwy",currentCity:"Las Vegas",currentState:"NV",currentZip:"89104",employerName:"E2E Test Co",annualIncome:32000,householdSize:2,requestedLeaseTermMonths:12,requestedRentAmount:1100,requestedMoveInDate:"2026-08-01"}')" >/dev/null || return 1
  curl -fsS -X POST "$API/api/applicants/me/applications/submit-draft" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' -d '{}' >/dev/null || return 1
  echo "$app_id"
}

staff_jwt() {
  curl -fsS -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"senior@cdpc.test","password":"password123"}' | jq -r '.token'
}

screen_app() { # screen_app <app_id> <staff_jwt>
  curl -fsS -X POST "$API/api/screening/$1/screen" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1
}

# ═════ POSTURE A · prod-posture safety: no stubs → screened app must HOLD ═══════════════
if [ "$ONLY" = "ALL" ] || [ "$ONLY" = "A" ]; then
  note "═══ POSTURE A · prod-posture safety (stubs OFF → must HOLD in screening_review) ═══"
  if boot A ALLOW_STUB_SCREENING= MOCK_MODE=; then
    EMAIL="e2e-holdcheck-$(date +%s)@example.com"
    APP_ID=$(journey "$EMAIL")
    if [ -z "$APP_ID" ]; then bad "A: applicant journey did not complete"; else
      ok "A: applicant journey register→submitted ($APP_ID)"
      SJ=$(staff_jwt); screen_app "$APP_ID" "$SJ"; sleep 2
      STATUS=$(dbq "select status from applications where id='$APP_ID'")
      RESULT=$(dbq "select overall_screening_result from applications where id='$APP_ID'")
      if [ "$STATUS" = "screening_review" ]; then
        ok "A: HOLD verified — status=screening_review (result=$RESULT); nothing auto-approved with vendors unkeyed"
      else
        bad "A: expected HOLD screening_review, got status=$STATUS result=$RESULT — LAUNCH BLOCKER if prod matches"
      fi
      N_PASSED=$(dbq "select count(*) from applications where id='$APP_ID' and status in ('screening_passed','tier1_approved')")
      [ "$N_PASSED" = "0" ] && ok "A: no auto-approve state reached" || bad "A: application reached an approved state without real screening"
    fi
    shutdown
  fi
fi

# ═════ POSTURE B · happy path: stubs ON → journey completes to screening_passed ═════════
if [ "$ONLY" = "ALL" ] || [ "$ONLY" = "B" ]; then
  note "═══ POSTURE B · happy path (MOCK_MODE stubs → screening_passed) ═══"
  if boot B ALLOW_STUB_SCREENING=1 MOCK_MODE=1; then
    EMAIL="e2e-happy-$(date +%s)@example.com"
    APP_ID=$(journey "$EMAIL")
    if [ -z "$APP_ID" ]; then bad "B: applicant journey did not complete"; else
      ok "B: applicant journey register→submitted ($APP_ID)"
      SJ=$(staff_jwt); screen_app "$APP_ID" "$SJ"; sleep 2
      STATUS=$(dbq "select status from applications where id='$APP_ID'")
      case "$STATUS" in
        screening_passed) ok "B: screening completed → screening_passed" ;;
        screening_review) bad "B: expected pass under stubs, got HOLD (screening_review)" ;;
        *)                bad "B: unexpected status '$STATUS' after stubbed screening" ;;
      esac
      LEDGER=$(dbq "select count(*) from audit_log where application_id='$APP_ID'")
      [ "${LEDGER:-0}" -ge 1 ] && ok "B: audit_log has $LEDGER row(s) for the journey" || bad "B: no audit_log rows written"
    fi
    shutdown
  fi
fi

# ═════ POSTURE C · voice-tool path: auth fence + read tools + verify-first fence ════════
if [ "$ONLY" = "ALL" ] || [ "$ONLY" = "C" ]; then
  note "═══ POSTURE C · voice server-tools (real webhook route) ═══"
  if boot C ALLOW_STUB_SCREENING=1 MOCK_MODE=1 VOICE_TOOLS_ENABLED=true \
        ELEVENLABS_WEBHOOK_SECRET="$WEBHOOK_SECRET" ELEVENLABS_TOOL_SECRET="$TOOL_SECRET"; then
    T="$API/api/webhooks/elevenlabs/tools"
    # C1 — auth is enforced: missing AND wrong secret both rejected (the route answers 400
    # "Invalid tool secret" by design — don't leak which part failed), right secret 200.
    C_NONE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$T/prequalify" -H 'Content-Type: application/json' -d '{}')
    C_WRONG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$T/prequalify" -H 'Content-Type: application/json' -H 'x-elevenlabs-tool-secret: WRONG' -d '{}')
    if [ "${C_NONE:0:1}" != "2" ] && [ "${C_WRONG:0:1}" != "2" ]; then
      ok "C: tool auth enforced — missing secret → $C_NONE, wrong secret → $C_WRONG (never 2xx)"
    else
      bad "C: tool route accepted an unauthenticated/wrong-secret call (none=$C_NONE wrong=$C_WRONG)"
    fi
    # C2 — read tool answers with the secret header
    PRE=$(curl -fsS -X POST "$T/prequalify" -H 'Content-Type: application/json' -H "x-elevenlabs-tool-secret: $TOOL_SECRET" \
      -d '{"household_size":2,"monthly_income":2600,"current_city":"Las Vegas","nonce":"e2e-c2-'$(date +%s)'"}' 2>/dev/null)
    echo "$PRE" | jq -e '.' >/dev/null 2>&1 && ok "C: prequalify answers via the real webhook route" || bad "C: prequalify failed: $(echo "$PRE" | head -c 120)"
    # C3 — get_property_details grounds from the real corpus/DB
    GPD=$(curl -fsS -X POST "$T/get_property_details" -H 'Content-Type: application/json' -H "x-elevenlabs-tool-secret: $TOOL_SECRET" \
      -d '{"property_name":"Donna Louise","nonce":"e2e-c3-'$(date +%s)'"}' 2>/dev/null)
    echo "$GPD" | jq -e '.' >/dev/null 2>&1 && ok "C: get_property_details answers" || bad "C: get_property_details failed: $(echo "$GPD" | head -c 120)"
    # C4 — the verify-first fence: create_application for an UNVERIFIED phone must refuse
    BEFORE=$(dbq "select count(*) from applications")
    CA=$(curl -fsS -X POST "$T/create_application" -H 'Content-Type: application/json' -H "x-elevenlabs-tool-secret: $TOOL_SECRET" \
      -d '{"phone":"702-555-0199","first_name":"Fence","last_name":"Check","nonce":"e2e-c4-'$(date +%s)'"}' 2>/dev/null)
    AFTER=$(dbq "select count(*) from applications")
    if [ "$BEFORE" = "$AFTER" ]; then
      ok "C: verify-first fence held — create_application refused an unverified phone (no row created)"
      echo "$CA" | grep -qiE 'verify|confirm|code' && ok "C: fence response asks to verify the phone" || note "  (fence reply: $(echo "$CA" | head -c 100))"
    else
      bad "C: create_application CREATED an application for an unverified phone (fence bypassed)"
    fi
    shutdown
  fi
fi

echo
echo "══════════ E2E SYSTEM BOARD ══════════$BOARD"
echo "──────────────────────────────────────"
echo "  $PASS passed · $FAIL failed"
[ "$FAIL" -eq 0 ] && { echo "  ALL SYSTEM CHECKS PASSED"; exit 0; } || { echo "  SYSTEM CHECKS FAILED"; exit 1; }
