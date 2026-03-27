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

### ⬜ Write tests: `src/modules/application/validation.ts`
- Test: valid application schema passes
- Test: invalid SSN format → fails
- Test: missing required fields → fails
- Test: income edge cases

---

## Loop 5 — Decision Matrix Tests

### ⬜ Explore and test `src/modules/decision-matrix/service.ts`

---

## Notes

- DO NOT modify integration stubs in `src/modules/integrations/`
- Mock `../../config/database` in all service tests
- Mock `../../middleware/audit` where used
- All tests in `src/tests/` directory
- Compliance constraints: HUD/LIHTC, FCRA, PCI-DSS must be respected
