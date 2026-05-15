-- Applications: SSN/DOB nullable for drafts (2026-05-14)
-- The applicant self-serve flow creates a draft row before SSN/DOB are
-- collected (intent quiz → unit picker → claim → form). Those columns are
-- still required at submit-time, enforced by validation, but the NOT NULL
-- on the table itself blocks every new applicant's /intent and /claim-unit
-- calls with a 500. Relax the column-level constraint; keep enforcement
-- at the boundary.

ALTER TABLE applications ALTER COLUMN ssn_encrypted DROP NOT NULL;
ALTER TABLE applications ALTER COLUMN ssn_hash DROP NOT NULL;
ALTER TABLE applications ALTER COLUMN date_of_birth_encrypted DROP NOT NULL;
