#!/usr/bin/env bash
# Smoke test the tenant portal API end-to-end.
#
# Assumes the dev backend is running on $API_URL (default http://localhost:3002)
# with the demo seed loaded (npm run seed:demo). Exits non-zero on first failure.

set -euo pipefail

API="${API_URL:-http://localhost:3002}"
TENANT_EMAIL="${TENANT_EMAIL:-demo-tenant@example.com}"
APPLICANT_EMAIL="${APPLICANT_EMAIL:-portal-smoke-$(date +%s)@example.com}"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
say()   { printf "\033[36m▸\033[0m %s\n" "$*"; }

require() {
  local body="$1" path="$2" label="$3"
  if ! echo "$body" | jq -e "$path" >/dev/null 2>&1; then
    red "FAIL: $label — missing $path"
    echo "  body: $body"
    exit 1
  fi
}

say "Health check"
curl -fsS "$API/health" | jq -e '.status == "ok"' >/dev/null
green "  ok"

say "Magic-link request for $TENANT_EMAIL"
LINK_RES=$(curl -fsS -X POST "$API/api/auth/magic-link/request" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TENANT_EMAIL\"}")
require "$LINK_RES" '.ok == true' "magic-link request"
DEV_LINK=$(echo "$LINK_RES" | jq -r '.devLink // empty')
if [ -z "$DEV_LINK" ]; then
  red "FAIL: no devLink returned (is NODE_ENV != production?)"
  exit 1
fi
TOKEN=$(echo "$DEV_LINK" | sed -E 's|.*token=([^&]+).*|\1|')
green "  link issued, token=${TOKEN:0:8}…"

say "Magic-link verify"
VERIFY_RES=$(curl -fsS -X POST "$API/api/auth/magic-link/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}")
require "$VERIFY_RES" '.token | length > 20' "verify returns JWT"
require "$VERIFY_RES" '.user.role == "tenant"' "verify returns tenant user"
JWT=$(echo "$VERIFY_RES" | jq -r '.token')
green "  jwt acquired"

say "GET /api/tenant/me"
ME=$(curl -fsS "$API/api/tenant/me" -H "Authorization: Bearer $JWT")
require "$ME" '.user.email == "'"$TENANT_EMAIL"'"' "/me returns tenant"
green "  ok"

say "GET /api/tenant/dashboard"
DASH=$(curl -fsS "$API/api/tenant/dashboard" -H "Authorization: Bearer $JWT")
require "$DASH" '.activeApplication' "dashboard has activeApplication"
require "$DASH" '.balance' "dashboard has balance"
APP_ID=$(echo "$DASH" | jq -r '.activeApplication.id')
BALANCE=$(echo "$DASH" | jq -r '.balance.balance')
green "  active=$APP_ID balance=\$$BALANCE"

say "GET /api/tenant/applications/$APP_ID/ledger"
LED=$(curl -fsS "$API/api/tenant/applications/$APP_ID/ledger" -H "Authorization: Bearer $JWT")
require "$LED" '.entries | length >= 0' "ledger entries array"
green "  $(echo "$LED" | jq -r '.entries | length') entries"

say "POST /api/tenant/maintenance"
WO=$(curl -fsS -X POST "$API/api/tenant/maintenance" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"applicationId\":\"$APP_ID\",\"title\":\"Smoke test\",\"description\":\"Auto-generated test\",\"priority\":\"routine\"}")
require "$WO" '.id' "work order created"
green "  wo=$(echo "$WO" | jq -r '.id')"

say "POST /api/tenant/applications/$APP_ID/pay"
PAY=$(curl -fsS -X POST "$API/api/tenant/applications/$APP_ID/pay" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"amount": 100}')
require "$PAY" '.ok == true' "payment posted"
green "  posted \$100"

say "POST /api/applicants/register (new email)"
REG=$(curl -fsS -X POST "$API/api/applicants/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$APPLICANT_EMAIL\",\"firstName\":\"Smoke\",\"lastName\":\"Test\",\"phone\":\"702-555-9999\"}")
require "$REG" '.token | length > 20' "applicant register returns JWT"
APPLICANT_JWT=$(echo "$REG" | jq -r '.token')
green "  registered applicant"

say "GET /api/applicants/me/applications (empty)"
ME_APPS=$(curl -fsS "$API/api/applicants/me/applications" -H "Authorization: Bearer $APPLICANT_JWT")
require "$ME_APPS" '.applications | length == 0' "no apps yet"
green "  empty as expected"

green ""
green "✓ All tenant portal smoke tests passed"
