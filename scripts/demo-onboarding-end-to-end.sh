#!/usr/bin/env bash
# End-to-end demo of every API in the applicant → tenant → lease chain.
#
# Walks one applicant from a cold register through to onboarded tenant, hitting
# every working onboarding endpoint along the way. Prints which API was called
# at each step and surfaces the response shape so you can see what the client
# sees. Bails on the first non-2xx.
#
# Required env on the backend:
#   MOCK_MODE=1               — fraud/screening vendors return canned responses
#   ALLOW_STUB_SCREENING=1    — stub-gate lets unkeyed vendors pass
#   DEMO_LINK_IN_RESPONSE=1   — /register and /magic-link/request echo devLink
#
# Defaults: API=http://localhost:3002, seed loaded (npm run seed).
set -euo pipefail

API="${API_URL:-http://localhost:3002}"
TS="$(date +%s)"
APPLICANT_EMAIL="${APPLICANT_EMAIL:-onboarding-demo-${TS}@example.com}"
SENIOR_EMAIL="${SENIOR_EMAIL:-senior@cdpc.test}"
STAFF_PASSWORD="${STAFF_PASSWORD:-password123}"

# Random SSN per run — fraud-screening short-circuits on duplicate SSN, so a
# fixed value would auto-fail every run after the first. Format XXX-XX-XXXX.
rand_ssn() {
  printf "%03d-%02d-%04d" $((RANDOM%900+100)) $((RANDOM%90+10)) $((RANDOM%9000+1000))
}
APPLICANT_SSN="${APPLICANT_SSN:-$(rand_ssn)}"

# Optional demo-link header. When the backend has DEMO_LINK_SECRET configured
# (a staging/prod-shaped env), the devLink is only echoed to requests carrying
# a matching x-demo-token header (see src/utils/demo-link.ts — "secret wins").
# Export DEMO_TOKEN=<secret> to use that path; leave unset for a fully-open
# DEMO_LINK_IN_RESPONSE=true backend (local default).
DEMO_HDR=()
[ -n "${DEMO_TOKEN:-}" ] && DEMO_HDR=(-H "x-demo-token: ${DEMO_TOKEN}")

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
say()   { printf "\033[36m▸\033[0m %s\n" "$*"; }
api()   { printf "  \033[90mAPI: %s\033[0m\n" "$*"; }

require() {
  local body="$1" path="$2" label="$3"
  if ! echo "$body" | jq -e "$path" >/dev/null 2>&1; then
    red "FAIL: $label — missing $path"
    echo "  body: $body" | head -c 800
    echo
    exit 1
  fi
}

# Staff JWT via email+password. Magic-link rejects staff roles
# (magic-link-service.ts gates to applicant|tenant only), so staff use
# POST /api/auth/login.
staff_login() {
  local email="$1" pw="$2"
  local res
  res=$(curl -fsS -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg em "$email" --arg pw "$pw" '{email:$em,password:$pw}')")
  echo "$res" | jq -r '.token // .access_token // empty'
}

# Get a JWT for an applicant/tenant email via the magic-link flow.
magic_login() {
  local email="$1"
  local req
  req=$(curl -fsS -X POST "$API/api/auth/magic-link/request" \
    -H 'Content-Type: application/json' "${DEMO_HDR[@]}" \
    -d "{\"email\":\"$email\"}")
  local dev_link
  dev_link=$(echo "$req" | jq -r '.devLink // empty')
  if [ -z "$dev_link" ]; then
    red "no devLink for $email — is DEMO_LINK_IN_RESPONSE=1 set?"; exit 1
  fi
  local token
  token=$(echo "$dev_link" | sed -E 's|.*token=([^&]+).*|\1|')
  local verify
  verify=$(curl -fsS -X POST "$API/api/auth/magic-link/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$token\"}")
  echo "$verify" | jq -r '.token'
}

green ""
green "════════════════════════════════════════════════════════════════════"
green "Frank-Pilot end-to-end onboarding demo"
green "applicant: $APPLICANT_EMAIL"
green "════════════════════════════════════════════════════════════════════"
green ""

# ─── 1. Health ─────────────────────────────────────────────────────────
say "1. Backend health"
api "GET /health"
curl -fsS "$API/health" | jq -e '.status == "ok"' >/dev/null
green "  ok"

# ─── 2. Applicant register ─────────────────────────────────────────────
say "2. Applicant self-registers"
api "POST /api/applicants/register"
REG=$(curl -fsS -X POST "$API/api/applicants/register" \
  -H 'Content-Type: application/json' "${DEMO_HDR[@]}" \
  -d "{\"email\":\"$APPLICANT_EMAIL\",\"firstName\":\"Alice\",\"lastName\":\"Onboarding\",\"phone\":\"702-555-0100\"}")
require "$REG" '.ok == true' "register accepted"
DEV_LINK=$(echo "$REG" | jq -r '.devLink // empty')
[ -n "$DEV_LINK" ] || { red "no devLink (set DEMO_LINK_IN_RESPONSE=1)"; exit 1; }
green "  registered — magic link issued"

# ─── 3. Magic-link verify → JWT ────────────────────────────────────────
say "3. Applicant clicks magic link"
TOKEN=$(echo "$DEV_LINK" | sed -E 's|.*token=([^&]+).*|\1|')
api "POST /api/auth/magic-link/verify"
VERIFY=$(curl -fsS -X POST "$API/api/auth/magic-link/verify" \
  -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}")
require "$VERIFY" '.token | length > 20' "JWT issued"
require "$VERIFY" '.user.role == "applicant"' "applicant role"
JWT=$(echo "$VERIFY" | jq -r '.token')
USER_ID=$(echo "$VERIFY" | jq -r '.user.id')
green "  jwt acquired, user=$USER_ID"

# ─── 4. Intent quiz → draft application ────────────────────────────────
say "4. Applicant submits intent quiz"
api "POST /api/applicants/intent"
INTENT=$(curl -fsS -X POST "$API/api/applicants/intent" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"bedrooms":1,"budget_max":1200,"move_in_date":"2026-08-01","household_size":2,"gross_annual_income":32000,"qualifying_ami_tier":"50"}')
require "$INTENT" '.ok == true' "intent saved"
APP_ID=$(echo "$INTENT" | jq -r '.application_id')
green "  draft app=$APP_ID, ami tier=50%"

# ─── 5. Browse matching units ──────────────────────────────────────────
say "5. Applicant browses units"
api "GET /api/applicants/units?bedrooms=1&maxRent=1200&amiTier=50"
UNITS=$(curl -fsS "$API/api/applicants/units?bedrooms=1&maxRent=1200&amiTier=50" \
  -H "Authorization: Bearer $JWT")
require "$UNITS" '.units | length > 0' "at least one matching unit"
UNIT_ID=$(echo "$UNITS" | jq -r '.units[0].id')
UNIT_RENT=$(echo "$UNITS" | jq -r '.units[0].monthly_rent')
UNIT_PROP=$(echo "$UNITS" | jq -r '.units[0].property_name')
green "  $(echo "$UNITS" | jq -r '.units | length') matches; picking #${UNIT_ID:0:8}… @ \$${UNIT_RENT}/mo ($UNIT_PROP)"

# ─── 6. Claim the unit (48h hold) ──────────────────────────────────────
say "6. Applicant claims the unit"
api "POST /api/applicants/claim-unit/:id"
CLAIM=$(curl -fsS -X POST "$API/api/applicants/claim-unit/$UNIT_ID" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}')
require "$CLAIM" '.ok == true' "unit claimed"
green "  held until $(echo "$CLAIM" | jq -r '.expires_at')"

# ─── 7. Fill the full application form ─────────────────────────────────
say "7. Applicant submits the full application form"
PROPERTY_ID=$(echo "$UNITS" | jq -r '.units[0].property_id')
api "POST /api/applicants/apply"
APPLY=$(curl -fsS -X POST "$API/api/applicants/apply" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg pid "$PROPERTY_ID" --arg em "$APPLICANT_EMAIL" --arg ssn "$APPLICANT_SSN" '{
    propertyId: $pid,
    firstName: "Alice",
    lastName: "Onboarding",
    ssn: $ssn,
    dateOfBirth: "1990-04-15",
    email: $em,
    phone: "702-555-0100",
    currentAddressLine1: "1200 Maryland Pkwy",
    currentCity: "Las Vegas",
    currentState: "NV",
    currentZip: "89104",
    employerName: "Vegas Coffee Co",
    annualIncome: 32000,
    householdSize: 2,
    requestedLeaseTermMonths: 12,
    requestedRentAmount: 1100,
    requestedMoveInDate: "2026-08-01"
  }')")
require "$APPLY" '.id' "application persisted"
green "  application form captured (HUD-92006 supplement stamped)"

# ─── 8. Submit the draft for screening ─────────────────────────────────
say "8. Applicant submits draft → submitted"
api "POST /api/applicants/me/applications/submit-draft"
SUBMIT=$(curl -fsS -X POST "$API/api/applicants/me/applications/submit-draft" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}')
require "$SUBMIT" '.id' "submitted"
green "  status → $(echo "$SUBMIT" | jq -r '.status')"

# ─── 9. Senior manager logs in (email + password) ──────────────────────
say "9. Senior manager logs in (staff password login)"
api "POST /api/auth/login ($SENIOR_EMAIL)"
SR_JWT=$(staff_login "$SENIOR_EMAIL" "$STAFF_PASSWORD")
[ -n "$SR_JWT" ] || { red "staff login failed for $SENIOR_EMAIL"; exit 1; }
green "  senior_manager jwt acquired"

# ─── 10. Run automated screening ───────────────────────────────────────
# The screening pipeline now runs identity verification as its first gate
# (Persona / Stripe Identity scaffold) before the duplicate-SSN check and
# parallel background/credit/compliance. Under MOCK_MODE=1, pass a
# screeningTag in the body to drive canned vendor responses — e.g.
#     curl ... -d '{"screeningTag":"id_verification_fail"}'
# returns overallResult=fail with identity.status=rejected (mirrors the
# duplicate-SSN early-exit and fires an FCRA adverse-action notice).
say "10. Staff fires automated screening pipeline"
api "POST /api/screening/:applicationId/screen"
SCREEN=$(curl -fsS -X POST "$API/api/screening/$APP_ID/screen" \
  -H "Authorization: Bearer $SR_JWT" -H 'Content-Type: application/json' -d '{}')
OVERALL=$(echo "$SCREEN" | jq -r '.overallResult')
ID=$(echo "$SCREEN" | jq -r '.identity.status // "n/a"')
BG=$(echo "$SCREEN" | jq -r '.background.status')
CR=$(echo "$SCREEN" | jq -r '.credit.status')
CO=$(echo "$SCREEN" | jq -r '.compliance.status')
green "  overall=$OVERALL  identity=$ID  bg=$BG  credit=$CR  compliance=$CO"
if [ "$OVERALL" != "pass" ]; then
  red "screening did not pass — cannot continue chain (review_required or fail)"
  echo "$SCREEN" | jq .
  exit 1
fi

# ─── 11. Tier-1 approval ───────────────────────────────────────────────
say "11. Senior manager — Tier 1 approval"
api "POST /api/approvals/:applicationId/tier1"
T1=$(curl -fsS -X POST "$API/api/approvals/$APP_ID/tier1" \
  -H "Authorization: Bearer $SR_JWT" -H 'Content-Type: application/json' \
  -d '{"decision":"pass","notes":"All checks clean — within AMI tier, no fraud flags."}')
require "$T1" '.status' "tier1 status present"
NEW_STATUS=$(echo "$T1" | jq -r '.status')
green "  status → $NEW_STATUS  (requiresTier2=$(echo "$T1" | jq -r '.requiresTier2'))"

# Tier 2/3 are conditional. The script handles only the common case
# (rent < \$1500, no exception flags → straight to lease). If the unit
# crosses thresholds, surface and stop so the operator can route by hand.
if [ "$NEW_STATUS" != "tier1_approved" ]; then
  red "tier1 result not tier1_approved — manual routing needed (status=$NEW_STATUS)"
  echo "$T1" | jq .
  exit 1
fi

# ─── 11b. Income verification (LIHTC §42 pre-lease gate) ───────────────
say "11b. Staff verifies income (LIHTC §42 third-party verification)"
api "PATCH /api/applications/:id/verify-income"
VI=$(curl -fsS -X PATCH "$API/api/applications/$APP_ID/verify-income" \
  -H "Authorization: Bearer $SR_JWT" -H 'Content-Type: application/json' \
  -d '{"verifiedIncome":32000}')
green "  income_verified=$(echo "$VI" | jq -r '.income_verified // .incomeVerified // "true"')"

# ─── 12. Generate the lease ────────────────────────────────────────────
say "12. Generate lease (OneSite + DocuSign stubs)"
api "POST /api/leases/:applicationId/generate"
GEN=$(curl -fsS -X POST "$API/api/leases/$APP_ID/generate" \
  -H "Authorization: Bearer $SR_JWT" -H 'Content-Type: application/json' -d '{}')
require "$GEN" '.leaseId // .onesiteLeaseId // .id' "lease id present"
green "  lease generated (status → lease_generated)"

# ─── 13. Tenant e-signs the lease (native) ─────────────────────────────
say "13. Applicant electronically signs the lease"
api "POST /api/applicants/me/lease/sign"
SIGN_PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
SIGN=$(curl -fsS -X POST "$API/api/applicants/me/lease/sign" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg img "$SIGN_PNG" '{
    signatureName: "Alice Onboarding",
    signatureImage: $img,
    consent: true
  }')")
require "$SIGN" '.signedAt // .status' "lease signed"
green "  lease signed at $(echo "$SIGN" | jq -r '.signedAt // "now"')"

# ─── 14. Complete onboarding (PMS sync) ────────────────────────────────
say "14. Staff completes tenant onboarding"
api "POST /api/leases/:applicationId/onboard"
ONB=$(curl -fsS -X POST "$API/api/leases/$APP_ID/onboard" \
  -H "Authorization: Bearer $SR_JWT" -H 'Content-Type: application/json' -d '{}')
require "$ONB" '.onboarded == true' "onboarded"
green "  applicant → tenant (loft_tenant_id=$(echo "$ONB" | jq -r '.loftTenantId'))"

# ─── 15. New tenant dashboard ──────────────────────────────────────────
say "15. Tenant dashboard (post-onboard)"
api "GET /api/tenant/dashboard"
# Re-issue JWT — the user's role flipped applicant → tenant on onboard,
# and the old JWT still carries role=applicant. Refresh via magic-link.
TENANT_JWT=$(magic_login "$APPLICANT_EMAIL")
DASH=$(curl -fsS "$API/api/tenant/dashboard" -H "Authorization: Bearer $TENANT_JWT")
require "$DASH" '.activeApplication.id' "tenant has active application"
green "  active app=$(echo "$DASH" | jq -r '.activeApplication.id')  balance=\$$(echo "$DASH" | jq -r '.balance.balance')"

green ""
green "════════════════════════════════════════════════════════════════════"
green "✓ End-to-end onboarding chain succeeded"
green "  applicant=$APPLICANT_EMAIL"
green "  application=$APP_ID"
green "  unit=${UNIT_ID:0:8}… @ \$${UNIT_RENT}/mo ($UNIT_PROP)"
green "════════════════════════════════════════════════════════════════════"
