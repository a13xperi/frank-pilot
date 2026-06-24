/**
 * REAL-POSTGRES integration test for the requirements checklist + follow-up
 * wiring (the Craig scenario), end to end against actual SQL — the ON CONFLICT
 * upsert, the CASE-based auto-close, the boolean coercions, the index — which
 * the mocked unit tests can't prove.
 *
 * Gated: only runs when RUN_PG_INTEGRATION=1 and DATABASE_URL points at a
 * reachable Postgres (so the normal `npm test` / CI run skips it). To run:
 *
 *   docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=frank_test \
 *     -p 5433:5432 postgres:16-alpine
 *   RUN_PG_INTEGRATION=1 \
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/frank_test \
 *   npx jest requirements.integration
 *
 * Builds a minimal-but-accurate fixture (applications/users columns this code
 * reads) + the REAL follow-ups / call-resume / application-requirements
 * migration SQL, so the service runs against the same DDL it ships.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pool, query } from "../config/database";
import { normalizePhone } from "../modules/voice-intake/service";
import { computeMissingByPhone, markItemByPhone } from "../modules/requirements/service";
import { getAgenda, getBoard } from "../modules/follow-ups/report";

const RUN = process.env.RUN_PG_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;

const MIG = join(__dirname, "..", "db", "migrations");
const PHONE = normalizePhone("+17025550000") ?? "+17025550000";
let appId = "";

d("requirements + follow-ups e2e (real Postgres)", () => {
  beforeAll(async () => {
    // Minimal fixture: just the applications/users columns the catalog + service read.
    await query(`CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE,
      first_name text, last_name text, phone text, role text, is_active boolean DEFAULT true)`);
    await query(`CREATE TABLE IF NOT EXISTS applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text, status text,
      ssn_encrypted text, identity_verification_result text, identity_session_status text,
      income_verified boolean DEFAULT false, income_verification_result text,
      screening_authorization_at timestamptz, created_at timestamptz DEFAULT now())`);
    // The REAL migration SQL this feature ships.
    await query(readFileSync(join(MIG, "2026-06-24-follow-ups.sql"), "utf8"));
    await query(readFileSync(join(MIG, "2026-06-24-frank-call-resume.sql"), "utf8"));
    await query(readFileSync(join(MIG, "2026-06-24-application-requirements.sql"), "utf8"));

    await query(`DELETE FROM follow_ups WHERE phone_e164 = $1`, [PHONE]);
    await query(`DELETE FROM applications WHERE phone = $1`, [PHONE]);

    // Craig: photo ID verified, SSN on file, consent given, pay stubs NOT yet.
    const app = await query(
      `INSERT INTO applications
         (phone, status, ssn_encrypted, identity_verification_result, identity_session_status,
          income_verified, income_verification_result, screening_authorization_at)
       VALUES ($1,'draft','enc','pass','verified', false, null, now()) RETURNING id`,
      [PHONE]
    );
    appId = app.rows[0].id;
    await query(
      `INSERT INTO follow_ups
         (phone_e164, reason, scheduled_for, status, consent_outbound, checkpoint, source)
       VALUES ($1,'needs_info', now(), 'pending', true, 'has ID + SSN card; needs 2 pay stubs','voice_intake')`,
      [PHONE]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM follow_ups WHERE phone_e164 = $1`, [PHONE]);
    await query(`DELETE FROM applications WHERE phone = $1`, [PHONE]); // cascades requirements
    await pool.end();
  });

  it("computeMissing finds exactly the pay stubs (ID/SSN/consent satisfied)", async () => {
    const { applicationId, missing } = await computeMissingByPhone(PHONE);
    expect(applicationId).toBe(appId);
    expect(missing.map((m) => m.key)).toEqual(["income_paystubs"]);
    expect(missing[0].label).toContain("pay stubs");
  });

  it("the agenda surfaces the open callback annotated with the missing doc", async () => {
    const rows = await getAgenda();
    const r = rows.find((x) => x.phoneMasked === "***0000");
    expect(r).toBeTruthy();
    expect(r!.reason).toBe("needs_info");
    expect(r!.missing).toContain("your two most recent pay stubs");
  });

  it("marking the item clears the gap AND auto-closes the document-chase follow-up", async () => {
    const marked = await markItemByPhone(PHONE, "income_paystubs", "verified", "test");
    expect(marked.ok).toBe(true);

    const { missing } = await computeMissingByPhone(PHONE);
    expect(missing).toEqual([]); // nothing outstanding now

    const fu = await query(`SELECT status FROM follow_ups WHERE phone_e164 = $1`, [PHONE]);
    expect(fu.rows[0].status).toBe("completed"); // resolveFollowupsIfComplete fired

    const board = await getBoard();
    expect(board.find((b) => b.status === "completed")?.count).toBeGreaterThanOrEqual(1);
  });
});
