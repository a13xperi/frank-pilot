/**
 * Resolve the durable unit a transaction belongs to, from its application.
 *
 * Unit-identity Phase B (WS-4) write-path helper. Transaction tables
 * (tenant_ledger, recertifications, lease_violations, lease_renewals,
 * move_outs) carry a nullable unit_id alongside application_id: the unit is the
 * durable spine, the application is the tenancy *episode* on it. This resolves
 * that spine at INSERT time using the same chain the recert income-ceiling
 * service walks (src/modules/acquisitions/recert-compliance.ts):
 *
 *   application -> claimed_unit_id -> units.id                 (primary)
 *   application -> (property_id, unit_number) -> units.id      (secondary)
 *
 * The secondary match only fires when claimed_unit_id is NULL but a unit_number
 * is on file (legacy / non-unit-picker applicants). It is unambiguous because
 * units carries UNIQUE(property_id, unit_number).
 *
 * NULL-TOLERANT: returns null when the application is unknown or resolves to no
 * unit. Callers store the null — a transaction whose unit can't be resolved
 * stays unanchored rather than guessed; it is never an error.
 *
 * Works in both a pooled and a transactional context: pass the standalone
 * `query` export, or a bound `client.query` from inside a `transaction(...)`
 * block so the resolution shares the caller's txn/advisory lock.
 */

/** Minimal executor shape satisfied by both `query` and `PoolClient.query`. */
export type SqlExec = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: any[] }>;

export async function resolveUnitIdForApplication(
  exec: SqlExec,
  applicationId: string | null | undefined,
): Promise<string | null> {
  if (!applicationId) return null;
  const res = await exec(
    `SELECT COALESCE(
              a.claimed_unit_id,
              (SELECT u.id FROM units u
                WHERE u.property_id = a.property_id
                  AND u.unit_number = a.unit_number
                LIMIT 1)
            ) AS unit_id
       FROM applications a
      WHERE a.id = $1`,
    [applicationId],
  );
  return res.rows[0]?.unit_id ?? null;
}
