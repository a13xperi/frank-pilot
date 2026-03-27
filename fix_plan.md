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

## Notes

- DO NOT modify integration stubs in `src/modules/integrations/`
- Mock `../../config/database` in all service tests
- Mock `../../middleware/audit` where used
- All tests in `src/tests/` directory
- Compliance constraints: HUD/LIHTC, FCRA, PCI-DSS must be respected
