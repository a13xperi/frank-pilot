# Frank Pilot — Fix Plan & Task Backlog

## Status Key
- ✅ DONE
- 🔄 IN PROGRESS
- ⬜ TODO

---

## Loop 1 — Test Infrastructure + Utility Coverage

### ✅ Set up Jest + ts-jest configuration — `jest.config.js` created
### ✅ Write tests: `src/utils/encryption.ts` — 16 tests (round-trip, tamper detection, masking)
### ✅ Write tests: `src/utils/pii-filter.ts` — 18 tests (SSN, card, email, phone, JSON keys, object sanitization)
### ✅ Write tests: `src/middleware/rbac.ts` — 24 tests (separation of duties, role hierarchy, permission matrix invariants)

**Result:** 58 tests, all passing.

---

## Loop 2 — Screening Module Tests

### ✅ Write tests: `src/modules/screening/compliance.ts` — 13 tests
- Mock `query` from `../../config/database`
- Test: property not found → review_required
- Test: AMI limit found → pass when income within limits
- Test: AMI limit found → fail when income exceeds limits
- Test: asset threshold logic (>$5000 → review_required)
- Test: falls back to prior year AMI when current year missing
- Note: use `toContainEqual(expect.stringMatching(...))` for array element regex checks

### ✅ Write tests: `src/modules/screening/fraud-detection.ts` — 14 tests
- Mock `query` from `../../config/database`
- Test: checkDuplicateSSN — duplicate found
- Test: checkDuplicateSSN — no duplicate
- Test: checkIncomeMismatch — <15% discrepancy → no flag
- Test: checkIncomeMismatch — 15-30% discrepancy → medium severity
- Test: checkIncomeMismatch — >30% discrepancy → high severity
- Test: checkApprovalSpeed — < 5 min → flags anomaly
- Test: checkApprovalSpeed — >= 5 min → no flag

**Result:** 27 tests, all passing (85 total across all loops).

---

## Loop 3 — Approval Service Tests

### ✅ Write tests: `src/modules/approval/service.ts` — 41 tests
- Mock `query`, `writeAuditLog`, `enforceSeparationOfDuties`, `FraudDetectionService`
- Test: tier1Review — wrong status → throws
- Test: tier1Review — separation of duties violation → throws
- Test: tier1Review — unresolved fraud flags + pass decision → throws
- Test: tier1Review — pass + high rent → routes to tier2_review
- Test: tier1Review — deny → tier1_denied
- Test: requiresTier2 logic (rent >$1500, review_required checks) via test.each
- Test: requiresTier3 logic (exceptions only) via tier2Review
- Test: getNextAction returns correct string for each status via test.each
- **Gotcha:** Use `mockQuery.mockReset()` (not `clearAllMocks`) in beforeEach for
  test.each suites — `clearAllMocks` does NOT flush `mockResolvedValueOnce` queues,
  causing queue items to leak across iterations.

**Result:** 41 tests, all passing (126 total across all loops).

---

## Loop 4 — Application Module Tests

### ✅ Write tests: `src/modules/application/validation.ts` — 45 tests
- Test: minimal + full valid payloads pass
- Test: each required field missing → fails (propertyId, firstName, lastName, ssn, dateOfBirth)
- Test: propertyId must be UUID
- Test: SSN — dashes optional (123456789 valid), spaces/wrong-grouping/letters → fail
- Test: dateOfBirth — YYYY-MM-DD only; MM/DD/YYYY and freeform rejected
- Test: annualIncome — 0 accepted (LIHTC zero-income households), negative fails
- Test: requestedLeaseTermMonths — 1–60 inclusive, non-integer rejects
- Test: currentState — exactly 2 chars
- Test: previousRentalDurationMonths — 0 accepted (first-time renters), negative fails
- Test: submitApplicationSchema — UUID required
- Test: updateApplicationSchema — SSN omitted (immutable), all fields optional, validation still applies
- No mocks needed — pure Zod schema tests

**Result:** 45 tests, all passing (171 total across all loops).

---

## Loop 5 — Decision Matrix Tests

### ✅ Explore and test `src/modules/decision-matrix/service.ts` — 22 tests
- Test: unknown modification type → throws, no DB call
- Test: tenant_substitution → requiresRescreening: true in INSERT params
- Test: lease_term_change → asset_manager, pet_policy_change → senior_manager, other → senior_manager
- Test: rent_increase >10% → regional_manager; ≤10% (boundary 10%) → senior_manager
- Test: audit log written with correct action + requiresRescreening detail
- Test: decideModification — already decided → throws; insufficient role → throws
- Test: decideModification — approve/deny → correct status + audit log
- Test: listModifications — returns rows, queries by application_id, empty array
- **Bug documented:** `requestModification` mutates shared `MODIFICATION_RULES` object when
  rent_increase ≤10% (sets `rule.requiredRole = "senior_manager"`). Subsequent >10% tests in the
  same worker also get senior_manager. Tests ordered accordingly and bug captured in comments.

**Result:** 22 tests, all passing (193 total across all loops).

---

## Loop 6 — Bug Fix: Decision Matrix Mutation

### ✅ Fix mutation bug in `src/modules/decision-matrix/service.ts`
- **Bug:** `rule.requiredRole = "senior_manager"` mutated the shared `MODIFICATION_RULES`
  constant, causing all subsequent `rent_increase` requests (even >10%) to use
  `senior_manager` instead of `regional_manager` for the lifetime of the process.
- **Fix:** Introduced local `let requiredRole = rule.requiredRole` variable; the shared
  constant is never written to.
- Updated decision-matrix tests: removed ordering workarounds, converted the
  "documents the bug" test to a proper regression test asserting correct behaviour.
- All 193 tests still passing.

---

## Loop 7 — Screening Orchestration Tests

### ✅ Write tests: `src/modules/screening/service.ts` — 22 tests
- Mock `query`, `writeAuditLog`, `decrypt`, `BackgroundCheckService`, `CreditCheckService`, `ComplianceService`
- Test: application not found/not submitted → throws
- Test: all pass → overallResult=pass, status=screening_passed
- Test: each individual check fail → overallResult=fail, status=screening_failed
- Test: review_required (no fail) → overallResult=review_required, status=screening_passed
- Test: fail takes precedence over review_required
- Test: SSN decrypted, only last 4 passed to check services (PCI-DSS)
- Test: DOB decrypted and passed through; falls back to "NV" when state missing
- Test: annualIncome parsed from string; defaults to 0 for null (LIHTC zero-income)
- Test: audit log written for screening_initiated, each check completion, and screening_completed
- Test: getResults returns null on miss, row on hit, queries by applicationId
- **Note:** TypeScript enforces full return-type shapes on mocked methods — use `as any`
  on mock helper return values when the full details object is not relevant to the test.

**Result:** 22 tests, all passing (215 total across all loops).

---

## Loop 8 — Payment Service Tests

### ✅ Write tests: `src/modules/payment/service.ts` — 24 tests
- Mock `query`, `writeAuditLog`, `stripe` (virtual module mock for dynamic require)
- Test: createCustomer stub path (no key / placeholder key) — cus_stub_ ID, DB write, no audit log
- Test: createCustomer live path — stripe.customers.create called, DB write, audit log written
- Test: setupPaymentMethod — no stripe_customer_id → throws
- Test: setupPaymentMethod stub path — DB update, audit log, success:true returned
- Test: setupPaymentMethod live path — attach + setDefault called on Stripe
- Test: enrollAutoPay — no stripe_payment_method_id → throws
- Test: enrollAutoPay — DB update, audit log with monthlyDiscount:25, returns enrolled:true
- Test: getPaymentStatus — null on miss; effectiveRent = rent when no auto-pay;
  effectiveRent = rent-25 when enrolled; floor at $0; hasPaymentMethod/hasCustomer flags;
  null rent defaults to 0
- **Note:** Stripe is `require()`d dynamically in the constructor — mock with
  `jest.mock('stripe', factory, { virtual: true })` and control the path via
  `process.env.STRIPE_SECRET_KEY` before `new PaymentService()`.

**Result:** 24 tests, all passing (239 total across all loops).

---

## Loop 9 — Application Route Tests

### ✅ Write tests: `src/modules/application/routes.ts` — 24 tests
- Install: `supertest` + `@types/supertest` (not previously in project)
- Auth strategy: real JWT tokens via `generateToken` + mock the users DB query
  that `authenticate` runs — exercises actual auth middleware, not a stub
- Service strategy: mock `ApplicationService` at module level (instantiated at route scope)
- Test: 401 with no token, malformed Bearer, wrong-secret token
- Test: 400 on Zod validation errors (missing fields, invalid SSN, non-UUID propertyId)
- Test: 400 on negative annualIncome in PATCH
- Test: 201 POST / happy path; service.create receives user ID + role
- Test: 500 when service.create throws
- Test: GET / — 200, query params forwarded to service.list
- Test: GET /:id — 404 when service returns null, 200 when found
- Test: PATCH /:id — 400 on validation, 200 on valid partial update
- Test: POST /:id/submit — 200 happy path, 400 on service error, correct args

**Result:** 24 tests, all passing (263 total across all loops).

---

## Loop 10 — Approval Route Tests

### ✅ Write tests: `src/modules/approval/routes.ts` — 32 tests
- Mock `ApprovalService` at module level (instantiated at route scope)
- Auth strategy: real JWT tokens + mock users DB query for `authenticate`
- Test: 401 with no token / invalid token across all four endpoints
- Test: tier RBAC enforcement — leasing_agent blocked from tier1/tier2/tier3
- Test: senior_manager blocked from tier2/tier3 (approval:tier2 requires regional_manager+)
- Test: regional_manager blocked from tier3 (approval:tier3 requires asset_manager+)
- Test: Zod validation — missing decision, missing notes, empty notes, invalid enum value
- Test: 200 happy path for senior_manager on tier1, regional_manager on tier2, asset_manager on tier3
- Test: correct args forwarded to tier1Review/tier2Review/tier3Review (applicationId, decision, notes, reviewerId, reviewerRole)
- Test: 400 when service throws (wrong status, separation of duties violations)
- Test: GET /:applicationId/status — accessible by all roles (application:read is universal)
- Test: getApprovalStatus receives correct applicationId; 400 on service error

**Result:** 32 tests, all passing (295 total across all loops).

---

## Loop 11 — Screening Route Tests

### ✅ Write tests: `src/modules/screening/routes.ts` — 26 tests
- Mock `ScreeningService` and `FraudDetectionService` at module level
- Auth strategy: real JWT tokens + mock users DB query for `authenticate`
- Test: POST /:applicationId/screen — 401 no token, 401 bad token, 403 leasing_agent blocked
- Test: initiate screening — 200 happy path; correct args (applicationId, userId, role) forwarded
- Test: initiate screening — 400 when service throws (wrong status)
- Test: GET /:applicationId/results — 401/403 enforced, 404 on null, 200 on found
- Test: results — correct applicationId forwarded; 500 on unexpected throw
- Test: GET /:applicationId/fraud-flags — 401/403 enforced, empty array, populated array
- Test: fraud-flags — correct applicationId forwarded; 500 on throw
- Test: POST /fraud-flags/:flagId/resolve — 401/403/400 enforced (leasing_agent, senior_manager both blocked — fraud:resolve requires regional_manager+)
- Test: resolve — 400 when notes missing, 200 happy path, correct args (flagId, userId, notes) forwarded
- Test: resolve — 500 when fraudService.resolveFlag throws

**Result:** 26 tests, all passing (321 total across all loops).

---

## Loop 12 — Payment Route Tests

### ✅ Write tests: `src/modules/payment/routes.ts` — 25 tests
- Mock `PaymentService` at module level; also mock `stripe` as virtual module to prevent load errors
- Auth strategy: real JWT tokens + mock users DB query for `authenticate`
- Test: POST /:applicationId/customer — 401/403 enforced (leasing_agent blocked), 200 happy path
- Test: createCustomer — correct full args object forwarded (applicationId, email, firstName, lastName, actorId, actorRole)
- Test: createCustomer — 400 when service throws
- Test: POST /:applicationId/method — 401/403 enforced, Zod validation (missing paymentMethodId, invalid paymentType enum)
- Test: setupPaymentMethod — all 4 valid paymentType values accepted (ach, credit_card, debit_card, bank_transfer)
- Test: setupPaymentMethod — correct args forwarded; 400 on service throw
- Test: POST /:applicationId/auto-pay — 401/403 enforced, 200 happy path with monthlyDiscount
- Test: enrollAutoPay — correct args forwarded; 400 on service throw
- Test: GET /:applicationId — leasing_agent allowed (payment:view is open to all roles)
- Test: getPaymentStatus — 404 on null, 200 with full status object, correct applicationId forwarded; 500 on throw

**Result:** 25 tests, all passing (346 total across all loops).

---

## Loop 13 — Decision Matrix Route Tests

### ✅ Write tests: `src/modules/decision-matrix/routes.ts` — 26 tests
- Mock `DecisionMatrixService` at module level (instantiated at route scope)
- Auth strategy: real JWT tokens + mock users DB query for `authenticate`
- Test: POST /:applicationId — 401 no token, 401 bad token, Zod validation (missing modificationType, missing description, invalid enum)
- Test: all 5 modificationType enum values accepted (rent_increase, tenant_substitution, lease_term_change, pet_policy_change, other)
- Test: 201 happy path; correct full args forwarded including optional originalValue/requestedValue
- Test: optional fields (originalValue, requestedValue) are truly optional — absent from service call when not sent
- Test: 400 when service.requestModification throws
- Test: POST /decide/:modificationId — 401 no token, Zod validation (missing decision, missing notes, invalid enum)
- Test: decide endpoint has NO requirePermission guard — leasing_agent reaches service (gets 400 from service, not 403 from middleware)
- Test: 200 approve by senior_manager, 200 deny by regional_manager; correct args forwarded
- Test: 400 when service.decideModification throws (already decided)
- Test: GET /:applicationId — leasing_agent blocked (lease:modify), 403 verified
- Test: 200 empty array, 200 with 2 modifications, correct applicationId forwarded, regional_manager allowed
- Test: 500 when service.listModifications throws

**Result:** 26 tests, all passing (372 total across all loops).

---

## Loop 14 — Application Service Tests

### ✅ Write tests: `src/modules/application/service.ts` — 31 tests
- Mock `query`, `transaction`, `encrypt`/`hashSSN`/`maskSSN`, `writeAuditLog`, `FraudDetectionService`
- **Gotcha:** TypeScript enforces full `PoolClient` shape on mock clients — cast partial mocks with `as any`

**create()** — 9 tests:
- SSN and DOB encrypted before INSERT (PCI-DSS compliance verified)
- Encrypted values (not plaintext) appear at correct param indices in INSERT query
- Duplicate SSN check fires before insert; hash value passed to checkDuplicateSSN
- high-severity fraud flag raised via raiseFraudFlag when duplicate found; skipped when clean
- Address fraud check fires when currentAddressLine1 present; skipped when absent
- Audit log written with masked SSN; returns created row

**submit()** — 4 tests:
- Status updated to submitted; query uses `AND status = 'draft'` guard
- Throws "not found or not in draft status" when rows empty
- Audit log written with application_submitted action; returns updated row

**getById()** — 4 tests:
- Returns null when not found
- ssn_encrypted and date_of_birth_encrypted stripped from response (PCI-DSS/FCRA)
- ssn_masked added via maskSSN; property JOIN fields (property_name, address) intact
- Queries by applicationId

**list()** — 6 tests:
- Returns applications + total count; empty result; propertyId filter; status filter
- Default limit=50 / offset=0; custom limit/offset; combined filters with correct param ordering

**update()** — 5 tests:
- Throws "no fields to update" without querying DB; throws when not found/not draft
- Returns updated row; maps camelCase → snake_case columns; partial update only sets provided fields
- WHERE clause restricts to `status = 'draft'`

**Result:** 31 tests, all passing (403 total across all loops).

---

## Loop 15 — Screening Integration Service Tests

### ✅ Write tests: `src/modules/screening/background-check.ts` + `credit-check.ts` — 20 tests
- Both services tested in one file (`screening-integrations.test.ts`)
- Testing strategy: `jest.spyOn(service as any, 'callScreeningAPI')` / `callCreditAPI` to inject
  controlled API responses — tests full `evaluateResults()` logic without real network calls
- Stub path tested via real no-key path (both services return clean/680 stub data)

**BackgroundCheckService** — 10 tests:
- Stub path → pass (clean record, riskScore=0)
- felonies > 0 → fail, riskScore=100
- sexOffenses=true → fail (auto-fail criterion)
- violentCrimes=true → fail (auto-fail criterion)
- misdemeanors.length >= 3 → review_required, riskScore=75
- misdemeanors.length == 2 → pass, riskScore=50 (below review threshold)
- misdemeanors.length == 1 → pass, riskScore=25
- API throws → review_required, riskScore=-1, rawResponse error message (safe fallback)
- All detail fields propagated correctly
- 0 misdemeanors → riskScore=0

**CreditCheckService** — 10 tests:
- Stub path → pass (creditScore=680)
- evictions > 0 → fail (FCRA auto-fail)
- bankruptcies > 0 → fail (auto-fail)
- creditScore exactly 600 → pass (boundary test)
- creditScore 720 → pass; creditScore 599 → review_required (NOT auto-fail — LIHTC exceptions)
- creditScore 450 → review_required
- API throws → review_required, creditScore=0, safe fallback message
- All detail fields (paymentHistory, outstandingDebts, collections) propagated
- evictions override low score: both present → fail beats review_required

**Result:** 20 tests, all passing (423 total across all loops).

---

## Loop 16 — Audit Middleware + Params Utility Tests

### ✅ Write tests: `src/middleware/audit.ts` + `src/utils/params.ts` — 28 tests
- Mock `query` (database), `sanitizeObject` (pii-filter), `logger`
- **Gotcha:** `mockQuery.mock.calls[0][1]` needs `!` non-null assertions for TypeScript to
  accept indexing — use `(mockQuery.mock.calls[0]![1]! as unknown[])[idx]`

**writeAuditLog()** — 7 tests:
- Inserts all fields at correct param positions in INSERT query
- PII-sanitizes details via `sanitizeObject` before DB write; sanitized value stored (not raw)
- Optional fields (actorId, actorRole, applicationId, etc.) default to null when absent
- Empty details → stores `{}` JSON; details → stored as JSON string
- DB failure → re-throws (audit failures never silently swallowed)
- DB failure → logs error with action name before re-throw

**auditMiddleware()** — 6 tests:
- Calls `next()` synchronously; attaches `req.audit` function to request
- `req.audit()` writes audit log with actorId/actorRole from `req.user`
- `req.audit()` falls back to `req.params.applicationId` when applicationId not passed
- Explicit applicationId arg overrides `req.params.applicationId`
- IP address and user-agent captured from request headers

**queryAuditLog()** — 8 tests:
- Returns rows array; no WHERE clause when no filters
- Individual filters: applicationId, actorId, action, startDate/endDate
- Default limit=100 / offset=0; custom limit/offset respected
- Combined filters use correct `$N` param indices (no collision with limit/offset at end)
- Results ordered by `created_at DESC`

**param()** — 5 tests:
- String → returns string; undefined → returns ""; empty string → returns ""
- Array → returns first element; single-element array → returns element

**Result:** 28 tests, all passing (451 total across all loops).

---

## Loop 17 — Lease Generation + Onboarding Module (Implementation)

### ✅ Implement `src/modules/lease/service.ts` + `src/modules/lease/routes.ts`

**Context:** Applications could reach `tier1/2/3_approved` status but had no path to
`lease_generated` → `onboarded`. OneSite, Loft, and Twilio stubs were all in place but
nothing orchestrated them.

**LeaseService** — 3 methods:

`generateLease(applicationId, actorId, actorRole)`:
- Validates application exists and is in an APPROVABLE_STATUSES set
  (`tier1_approved | tier2_approved | tier3_approved`)
- Guards against missing `requested_rent_amount` (prevents lease with no rent)
- Calls `OneSiteService.generateLease()` → gets `{ leaseId, documentUrl }`
- Writes `lease_generated` audit log (OneSite handles status transition internally)
- Fires `TwilioService.notifyLeaseReady()` non-blocking — SMS failure is logged but does
  not fail the request

`completeOnboarding(applicationId, actorId, actorRole)`:
- Validates `status === 'lease_generated'` and `onesite_lease_id` present
- Calls `LoftService.createTenant()` to register in payment platform
- If `auto_pay_enrolled && stripe_payment_method_id` → calls `LoftService.setupAutoPay()`
- Calls `OneSiteService.syncTenant()` for data sync
- Updates `status = 'onboarded'` and stores `loft_tenant_id`
- Writes `tenant_onboarded` audit log with loftTenantId, onesiteLeaseId, autoPayEnrolled
- Fires `TwilioService.notifyApproved()` non-blocking

`getLeaseStatus(applicationId)`:
- Returns `{ applicationId, status, onesiteLeaseId, loftTenantId, autoPayEnrolled }` or null

**Routes** (`/api/leases`):
- `POST /:applicationId/generate` — `lease:generate` (senior_manager+); 400 on service error
- `POST /:applicationId/onboard`  — `lease:generate` (senior_manager+); 400 on service error
- `GET  /:applicationId`          — `application:read` (all roles); 404 on null; 500 on throw

**Wired into:** `src/index.ts` at `/api/leases`
**TypeScript:** `tsc --noEmit` clean; all 451 existing tests still passing.

---

## Loop 18 — LeaseService Test Coverage

### ✅ Write tests: `src/modules/lease/service.ts` — 32 tests
- Mock `query`, `writeAuditLog`, `OneSiteService`, `LoftService`, `TwilioService`
- Non-blocking SMS pattern tested: Twilio rejections must NOT propagate (`.catch()` swallows them)

**generateLease()** — 15 tests:
- Not found → throws; wrong status (draft, submitted, lease_generated) → throws
- Missing rent amount → throws
- All 3 approved statuses accepted: tier1_approved, tier2_approved, tier3_approved (test.each)
- Correct args to OneSiteService.generateLease (applicationId, propertyId, unitNumber, rentAmount, actorId/role)
- lease_generated audit log written with leaseId
- Returns { leaseId, documentUrl } from OneSite
- Twilio SMS sent when phone present; skipped when phone null
- Twilio failure does NOT throw (non-blocking fire-and-forget)
- unit_number=null → 'TBD' used as unitNumber

**completeOnboarding()** — 13 tests:
- Not found → throws; status≠lease_generated → throws; no onesite_lease_id → throws
- LoftService.createTenant called with correct args (firstName, lastName, email, rentAmount, actorId/role)
- setupAutoPay called when auto_pay_enrolled=true AND stripe_payment_method_id present
- setupAutoPay skipped when auto_pay_enrolled=false (even with payment method)
- setupAutoPay skipped when stripe_payment_method_id=null (even if enrolled)
- OneSiteService.syncTenant called with applicationId and onesiteLeaseId
- application UPDATE: status='onboarded' + loft_tenant_id stored
- tenant_onboarded audit log written with loftTenantId + onesiteLeaseId
- Returns { onboarded: true, loftTenantId }
- Twilio failure does NOT throw (non-blocking); phone=null skips notification

**getLeaseStatus()** — 4 tests:
- null on miss; full status object with correct fields on hit
- null onesiteLeaseId/loftTenantId when not yet set; queries by applicationId

**Result:** 32 tests, all passing (483 total across all loops).

---

## Loop 19 — Lease Route Tests

### ✅ Write tests: `src/modules/lease/routes.ts` — 25 tests
- Mock `LeaseService` at module level (instantiated at route scope)
- Auth strategy: real JWT tokens + mock users DB query for `authenticate`
- `lease:generate` RBAC: leasing_agent → 403; senior_manager/regional_manager → 200

**POST /:applicationId/generate** — 9 tests:
- 401 no token; 401 bad token; 403 leasing_agent blocked
- 200 happy path for senior_manager (leaseId + documentUrl returned)
- 200 happy path for regional_manager
- Correct args forwarded: (applicationId, actorId, actorRole)
- 400 on wrong status error; 400 on not found; 400 on missing rent amount

**POST /:applicationId/onboard** — 9 tests:
- 401 no token; 401 bad token; 403 leasing_agent blocked
- 200 happy path for senior_manager (onboarded=true + loftTenantId returned)
- 200 happy path for regional_manager
- Correct args forwarded: (applicationId, actorId, actorRole)
- 400 on wrong status (not lease_generated); 400 on missing onesite_lease_id; 400 on not found

**GET /:applicationId** — 7 tests:
- 401 no token; 401 bad token
- 200 for leasing_agent (application:read open to all roles) with full status object
- 200 for senior_manager with onboarded status + loftTenantId + autoPayEnrolled
- 404 when getLeaseStatus returns null
- 500 on unexpected service throw
- Correct applicationId forwarded to service

**Result:** 25 tests, all passing (508 total across all loops).

---

## Loop 20 — Auth Middleware + App-Level Route Tests

### ✅ Write tests: `src/middleware/auth.ts` + `src/index.ts` routes — 30 tests
- Covers the last two untested areas: auth middleware and the 3 routes defined in index.ts
- bcrypt mocked via `jest.mock('bcrypt')` since login() uses dynamic import
- Build minimal Express app replicating index.ts handlers — avoids `app.listen()` port conflicts

**authenticate middleware** — 8 tests:
- 401: no Authorization header; non-Bearer header; malformed token; wrong-secret token
- 401: user not found in DB; user is_active=false
- 200: valid token + active user → req.user populated correctly
- DB values override token payload for req.user (role taken from DB, not JWT claims)

**login()** — 6 tests:
- null: user not found; user inactive; wrong password (bcrypt returns false)
- Success: returns `{ token, user }` with correct fields
- Updates `last_login` timestamp on success (UPDATE query verified)
- Returned JWT is decodable with dev secret

**GET /health** — 2 tests:
- 200 with `{ status: 'ok', service: 'frank-pilot', timestamp }`
- Timestamp is a valid ISO 8601 string

**POST /api/auth/login** — 6 tests:
- 400: missing email; missing password; both missing
- 401: login() returns null (invalid credentials)
- 200: successful login returns token + user object
- 500: unexpected DB throw

**GET /api/audit** — 8 tests:
- 401: no token; invalid token
- 403: leasing_agent blocked; senior_manager blocked (audit:view = regional_manager+)
- 200: regional_manager gets logs array
- Query params (applicationId, actorId, action, limit, offset) forwarded correctly
- Default limit=100/offset=0 when not specified
- 500: queryAuditLog throws

**Result:** 30 tests, all passing (538 total across 21 test suites).

**Coverage now complete** — every module with non-trivial logic has dedicated test coverage:
- All middleware: rbac, auth (authenticate + login), audit ✅
- All services: application, screening, approval, payment, decision-matrix, lease ✅
- All routes: application, screening, approval, payment, decision-matrix, lease, audit ✅
- All utilities: encryption, pii-filter, params ✅
- All compliance logic: LIHTC/HUD compliance, fraud detection ✅

---

## Loop 21 — Lease CLI Commands + Seed Fix (Implementation)

### ✅ Add lease CLI commands to `src/cli/index.ts`
### ✅ Fix `src/db/seed.ts` idempotency bug

**Gap:** After Loop 17 implemented `LeaseService`, the CLI had no commands to drive
applications through the lease generation → onboarding workflow. Operators could not
complete the pipeline from the command line.

**New CLI commands:**

`generate-lease -i <applicationId> -u <userId>`:
- Looks up actor role from DB (same pattern as `run-screening`)
- Calls `LeaseService.generateLease()` with applicationId, userId, role
- Prints leaseId and documentUrl on success; exits 1 on error

`onboard -i <applicationId> -u <userId>`:
- Looks up actor role from DB
- Calls `LeaseService.completeOnboarding()` with applicationId, userId, role
- Prints `onboarded: true` and loftTenantId on success; exits 1 on error

`lease-status -i <applicationId>`:
- Calls `LeaseService.getLeaseStatus()` — no auth required (read-only)
- Prints status, onesiteLeaseId, loftTenantId, autoPayEnrolled in human-readable format
- Exits 1 with "Application not found" on null result

`deactivate-user -e <email>`:
- Sets `is_active = false` for the given user email
- Exits 1 if user not found

**Bug fix — `src/db/seed.ts`:**
- `known_problem_addresses` INSERT lacked `ON CONFLICT DO NOTHING`
- Re-running `npm run seed` would fail with unique constraint violation
- Added `ON CONFLICT (address_line1, city, state, zip) DO NOTHING` to make seed idempotent

**Full workflow now operational from CLI:**
```bash
npm run cli -- login -e senior@cdpc.test -p password123
npm run cli -- run-screening -i <app-id> -u <user-id>
npm run cli -- approval-status -i <app-id>
npm run cli -- generate-lease -i <app-id> -u <user-id>
npm run cli -- onboard -i <app-id> -u <user-id>
npm run cli -- lease-status -i <app-id>
```

**TypeScript:** `tsc --noEmit` clean. All 538 tests still passing.

---

## Loop 22 — FCRA Adverse Action Notice Module (Implementation)

### ✅ Implement `src/modules/adverse-action/service.ts` + `routes.ts`
### ✅ Update `src/db/schema.ts` (new table + enum value + UNIQUE constraint)
### ✅ Wire into `ScreeningService` + `ApprovalService` (all tier denials)
### ✅ Write `src/__tests__/adverse-action-service.test.ts` — 14 tests

**Compliance gap closed:** Federal law (15 U.S.C. § 1681m) requires an adverse action
notice whenever an applicant is denied based in whole or in part on consumer report
data. Previously no notice mechanism existed; applications could reach `screening_failed`
or `tier*_denied` with no legally required disclosure to the applicant.

**Schema changes:**
- Added `adverse_action_notice_sent` to `audit_action` enum
- Added `UNIQUE(address_line1, city, state, zip)` to `known_problem_addresses`
  (required for seed's `ON CONFLICT DO NOTHING` added in Loop 21 to work)
- Added `adverse_action_notices` table:
  `(id, application_id, sent_by, reason, reason_detail, notice_text, sent_via, sms_delivered)`

**AdverseActionService — 2 methods:**

`sendNotice(applicationId, actorId, actorRole, reason, reasonDetail?)`:
- Fetches applicant name + property from DB (JOIN applications + properties)
- Builds FCRA-compliant notice text with CRA name/address/phone, FCRA rights disclosure
- Inserts record into `adverse_action_notices` (authoritative legal evidence, always written)
- Writes `adverse_action_notice_sent` audit log with noticeId, reason, applicantName
- Fires non-blocking `TwilioService.notifyDenied()` SMS — SMS failure never propagates
- Skips SMS (warns to log) when applicant has no phone number on file
- CRA details configurable via env vars: `CRA_NAME`, `CRA_ADDRESS`, `CRA_PHONE`

`getNotice(applicationId)`:
- Returns most recently sent notice (ORDER BY created_at DESC LIMIT 1)
- Returns null if no notice has been sent

**Auto-trigger wiring:**
- `ScreeningService.runFullScreening()` — fires non-blocking when `overallResult === 'fail'`
  with `reason='screening_failed'` and `reasonDetail` listing failed checks
- `ApprovalService.tier1Review()` — fires non-blocking when `decision === 'fail'`
  with `reason='tier1_denied'` and notes as reasonDetail
- `ApprovalService.tier2Review()` — same for tier2 denial
- `ApprovalService.tier3Review()` — same for tier3 denial

**Routes** (`/api/applications`):
- `GET  /:applicationId/adverse-action`         — `screening:view` (senior_manager+); 404 on miss
- `POST /:applicationId/adverse-action/resend`  — `approval:tier1` (senior_manager+); manual resend

**Tests — 14 passing:**
- Throws when application not found (no INSERT)
- INSERT written with correct params (applicationId, actorId, reason, reasonDetail=null, noticeText)
- reasonDetail included in INSERT when provided; null when absent
- Audit log written with `adverse_action_notice_sent`, correct actorId/role, resourceId=noticeId
- Returns { noticeId, applicationId, sentAt, reason }
- Twilio SMS sent when phone present; skipped when phone=null
- SMS failure does NOT throw (non-blocking fire-and-forget)
- Notice text contains FCRA rights language (FREE copy, Dispute, CRA, property name)
- getNotice: null on miss; correct shape on hit; null reasonDetail when DB is null; correct query

**TypeScript:** `tsc --noEmit` clean. 552 tests, 22 suites, all passing.

---

## Loop 23 — User Management API + CLI (Implementation)

### ✅ Implement `src/modules/users/service.ts` + `routes.ts`
### ✅ Add `reset-password`, `activate-user` CLI commands; upgrade `deactivate-user`
### ✅ Write `src/__tests__/user-service.test.ts` — 22 tests

**Gap closed:** `user:manage` (system_admin) and `user:view` (senior_manager+) RBAC
permissions were defined but had no API routes. User management was CLI-only,
requiring shell access. Now exposed via REST API.

**UserService — 5 methods:**

`list(filters?)`:
- Optional `role` + `isActive` filters generate dynamic WHERE clause
- Returns UserRecord[] sorted by role, last_name, first_name

`getById(userId)`:
- Returns null on miss; mapped UserRecord on hit

`create(input, actorId, actorRole)`:
- Validates role against VALID_ROLES set — throws before any DB write on invalid role
- bcrypt.hash(password, 10) — plaintext never logged or stored
- Inserts into users; writes `permission_change` audit log with `action: 'user_created'`

`setActive(userId, isActive, actorId, actorRole)`:
- Throws `User not found` on miss
- Writes `permission_change` audit log with `action: 'user_activated'` or `'user_deactivated'`

`resetPassword(userId, newPassword, actorId, actorRole)`:
- Admin reset — no old password required
- bcrypt.hash — plaintext never stored
- Writes `permission_change` audit log with `action: 'password_reset'`
- Throws `User not found` on miss

**Routes** (`/api/users`):
- `GET /`                     — `user:view` (senior_manager+); optional ?role=X&isActive=true/false
- `GET /:userId`              — `user:view`; 404 on miss
- `POST /`                    — `user:manage` (system_admin); Zod validation; 201 on success
- `PATCH /:userId/deactivate` — `user:manage`; 400 on not-found
- `PATCH /:userId/activate`   — `user:manage`; 400 on not-found
- `POST /:userId/reset-password` — `user:manage`; Zod: newPassword min 8 chars

**CLI upgrades:**
- `deactivate-user` — upgraded to use UserService + audit log (now requires -u actorId)
- `activate-user`   — new command (reactivate a deactivated user)
- `reset-password`  — new command (admin reset, no old password needed)

**Tests — 22 passing:**
- list(): all users; role filter; isActive filter; combined AND filters; null lastLogin
- getById(): null on miss; correct mapping; queries by userId
- create(): invalid role throws before DB; bcrypt hash used not plaintext; audit log written; returns record; null propertyIds defaults to []
- setActive(): not found throws; false/true written correctly; deactivated/activated audit logs
- resetPassword(): not found throws; plaintext not stored; password_reset audit log; resolves undefined

**TypeScript:** `tsc --noEmit` clean. 574 tests, 23 suites, all passing.

---

## Loop 24 — Property Management API + CLI (Implementation)

### ✅ Implement `src/modules/properties/service.ts` + `routes.ts`
### ✅ Mount property routes in `src/index.ts`
### ✅ Add `list-properties` and `view-property` CLI commands
### ✅ Update `src/db/schema.ts` (new enum values: property_created, property_updated)
### ✅ Write `src/__tests__/property-service.test.ts` — 14 tests

**Gap closed:** `property:manage` (asset_manager, system_admin) and `property:view`
(all roles) RBAC permissions were defined but had no backing module or API routes.

**Schema changes:**
- Added `property_created`, `property_updated` to `audit_action` enum

**PropertyService — 4 methods:**

`list()`:
- SELECT all properties, ORDER BY name
- Returns PropertyRecord[]

`getById(propertyId)`:
- Returns null on miss; mapped PropertyRecord on hit

`create(input, actorId, actorRole)`:
- INSERT with optional fields (addressLine2, onesitePropertyId, loftPropertyId) defaulting to null
- Writes `property_created` audit log

`update(propertyId, input, actorId, actorRole)`:
- Dynamic SET clause — only provided fields included (same pattern as UserService.list filters)
- addressLine1, city, state, zip are immutable (coordinate with OneSite)
- Throws "No fields provided for update" on empty input
- Throws "Property not found: X" when UPDATE returns 0 rows
- Writes `property_updated` audit log with changed fields

**Routes** (`/api/properties`):
- `GET /`               — `property:view` (all roles including leasing_agent)
- `GET /:propertyId`   — `property:view`; 404 on miss
- `POST /`             — `property:manage` (asset_manager, system_admin); Zod validation; 201
- `PATCH /:propertyId` — `property:manage`; Zod validation; note: address fields excluded from UpdatePropertySchema

**CLI commands:**
- `list-properties` — prints console.table of all properties
- `view-property -i <id>` — prints JSON detail for one property

**Tests — 14 passing:**
- list(): empty; mapped array; ORDER BY name verified
- getById(): null on miss; correct mapping; queries by propertyId
- create(): inserts and returns record; optional fields default to null (positions 2, 8, 9); audit log written
- update(): throws on empty input (no DB call); throws on not-found; dynamic SET clause (only provided fields in SET portion); returns updated record; audit log with changed fields
- **Gotcha:** RETURNING clause contains all column names — test for absent SET fields must split SQL on WHERE and check only the SET portion:
  ```typescript
  const setPart = sql.split(/WHERE/i)[0]!;
  expect(setPart).not.toMatch(/ami_area/);
  ```

**TypeScript:** `tsc --noEmit` clean. 588 tests, 24 suites, all passing.

---

## Loop 25 — Property Routes + User Routes Tests

### ✅ Write `src/__tests__/property-routes.test.ts` — 26 tests
### ✅ Write `src/__tests__/user-routes.test.ts` — 38 tests

**Gap closed:** PropertyService and UserService had service-level tests but no
route-layer tests. HTTP contract (status codes, auth, RBAC, Zod, delegation,
errors) was untested for both modules.

**property-routes.test.ts — 26 tests:**

`GET /` (list all — property:view, all roles):
- 401 no auth; 401 invalid token; 200 leasing_agent (all roles have property:view);
  200 properties array + total count; 500 service throws

`GET /:propertyId` (property:view):
- 401; 200 with property; 404 when getById returns null;
  propertyId forwarded to service; 500

`POST /` (property:manage — asset_manager, system_admin):
- 401; 403 leasing_agent; 403 senior_manager; 400 missing fields;
  400 state not 2 chars; 400 negative unitCount; 201 success;
  actorId+actorRole forwarded; 400 service throws

`PATCH /:propertyId` (property:manage):
- 401; 403 leasing_agent; 400 non-integer unitCount;
  200 success; all args forwarded; 400 not found; 400 no fields

**user-routes.test.ts — 38 tests:**

`GET /` (user:view — senior_manager+):
- 401; 403 leasing_agent; 200 for senior_manager; role filter forwarded;
  isActive=true and isActive=false forwarded as booleans; 500

`GET /:userId` (user:view):
- 401; 403 leasing_agent; 200 found; 404 null; userId forwarded

`POST /` (user:manage — system_admin only):
- 401; 403 senior_manager; 403 asset_manager; 400 missing fields;
  400 password too short; 400 invalid email; 400 invalid role enum;
  201 success; actorId+actorRole forwarded; 400 service throws

`PATCH /:userId/deactivate` (user:manage):
- 401; 403 asset_manager; 200 + isActive=false; setActive called with false;
  400 user not found

`PATCH /:userId/activate` (user:manage):
- 401; 403 senior_manager; 200 + isActive=true; setActive called with true

`POST /:userId/reset-password` (user:manage):
- 401; 403 asset_manager; 400 password too short; 400 missing newPassword;
  200 success message; all args forwarded; 400 user not found

**TypeScript:** `tsc --noEmit` clean. 652 tests, 26 suites, all passing.

---

## Loop 26 — Adverse Action Routes Tests

### ✅ Write `src/__tests__/adverse-action-routes.test.ts` — 15 tests

**Gap closed:** AdverseActionService had service tests; the route layer
(GET + POST/resend mounted at /api/applications) had no HTTP contract coverage.

**adverse-action-routes.test.ts — 15 tests:**

`GET /:applicationId/adverse-action` (screening:view — senior_manager+):
- 401 no auth; 401 invalid token; 403 leasing_agent; 200 with notice shape;
  404 when getNotice returns null; applicationId forwarded to service; 500 on throw

`POST /:applicationId/adverse-action/resend` (approval:tier1 — senior_manager+):
- 401 no auth; 401 invalid token; 403 leasing_agent; 200 with result;
  defaults reason to 'manual_resend' when body is empty;
  custom reason + reasonDetail forwarded when provided;
  applicationId + actorId + actorRole forwarded; 400 on service throw

**FCRA compliance note in test:** GET endpoint provides visibility into legally
required notices; POST/resend creates a new notice record without overwriting
prior notices (immutable audit trail per 15 U.S.C. § 1681m).

**TypeScript:** `tsc --noEmit` clean. 667 tests, 27 suites, all passing.

**Coverage now complete** — every route module has both service-level and
route-level test coverage:
- application, screening, approval, payment, decision-matrix, lease ✅
- adverse-action (service + routes) ✅
- properties (service + routes) ✅
- users (service + routes) ✅
- auth middleware + app-level routes ✅

---

## Loop 27 — README Documentation Update

### ✅ Update README.md with all modules added in Loops 17–26

**Sections updated:**

Key Features (added):
- FCRA Adverse Action Notices (15 U.S.C. § 1681m)
- Property Management (Asset Manager registry with OneSite/Loft IDs)
- User Management API (system-admin CRUD, bcrypt passwords)

API Endpoints (added):
- Lease & Onboarding — POST generate, POST onboard, GET status
- Adverse Action Notices (FCRA) — GET notice, POST resend
- Properties — GET/, GET/:id, POST/, PATCH/:id with immutability note
- Users — GET/, GET/:id, POST/, PATCH deactivate/activate, POST reset-password

CLI (added):
- activate-user, deactivate-user (upgraded), reset-password
- list-properties, view-property
- generate-lease, onboard, lease-status

Project Structure (updated):
- Added lease/, adverse-action/, properties/, users/ module entries
- Added FCRA statute reference to adverse-action entry
- Added "(do not modify)" note to integrations/

**No code changes — documentation only. 667 tests, 27 suites still passing.**

---

## Loop 28 — LIHTC Household Size Compliance Fix (Implementation)

### ✅ Add `household_size` to applications table + propagate through screening

**Compliance gap fixed:** LIHTC income limits are household-size specific per HUD
regulations. Without `household_size`, `ComplianceService.runCheck()` always
looked up the 1-person AMI limit — incorrectly failing or flagging for review
eligible multi-person households (a 4-person household's 60% AMI limit can be
40-50% higher than a 1-person limit).

**Files changed:**

`src/db/schema.ts`:
- Added `household_size INTEGER DEFAULT 1` to `applications` table (under Employment & Income section)

`src/modules/application/validation.ts`:
- Added `householdSize: z.number().int().min(1).max(8).default(1)` to `createApplicationSchema`
- Automatically included in `updateApplicationSchema` via `.partial()` inherit

`src/modules/application/service.ts`:
- Added `household_size` to INSERT column list and params array (position after `annual_income`)
- Added `householdSize: "household_size"` to the UPDATE `fieldMap`

`src/modules/screening/service.ts`:
- Added `householdSize: app.household_size || 1` to `compliance.runCheck()` call
- The `|| 1` fallback handles rows created before this migration

`src/__tests__/application-service.test.ts`:
- Added `householdSize: 1` to `minimalInput()` fixture (required by TypeScript
  after `.default(1)` makes it required in the inferred output type)

**Gotcha — Zod `.default()` and TypeScript:** `z.number().default(1)` makes the
field optional in Zod's parse input (omitting it → 1) but required in the
inferred TypeScript OUTPUT type (`z.infer<typeof schema>`). Tests that pass
`CreateApplicationInput` directly to the service must include `householdSize`.

**TypeScript:** `tsc --noEmit` clean. 667 tests, 27 suites, all passing.

---

## Notes

- DO NOT modify integration stubs in `src/modules/integrations/`
- Mock `../../config/database` in all service tests
- Mock `../../middleware/audit` where used
- All tests in `src/tests/` directory
- Compliance constraints: HUD/LIHTC, FCRA, PCI-DSS must be respected
