import { query } from "../../config/database";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope, isGlobalPropertyScope } from "../../middleware/scope";

/**
 * Manager briefing — the unified operations rollup.
 *
 * This is the surface GPMG's managers already expect (their "Global Meridian"
 * portal presents the same KPI tiles). The difference: Meridian's tiles are an
 * ingest of RealPage and sit empty without a fact packet; ours read straight
 * from the system of record, so the numbers are live and we can also surface
 * the pipeline work Meridian has no concept of (screening holds, approvals,
 * voice callbacks, recert deadlines).
 *
 * Everything is property-scoped via buildPropertyScope: a senior_manager sees
 * only their assigned properties; regional/asset/admin see the whole portfolio.
 * Read-only aggregation — no new tables, no writes.
 */

export interface BriefingKpis {
  openWorkOrders: number;
  emergencyWorkOrders: number;
  overdueFollowUps: number;
  activeTurns: number;
  delinquentHouseholds: number;
  pastDueRent: number;
}

export interface BriefingPipeline {
  screeningReview: number;
  pendingApprovals: number;
  voiceCallbacks: number;
  upcomingRecerts: number;
}

export type AttentionSeverity = "high" | "medium" | "low";

export interface AttentionItem {
  id: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
}

export interface PropertySnapshot {
  propertyId: string;
  name: string;
  openWorkOrders: number;
  delinquentHouseholds: number;
  pastDueRent: number;
}

export interface ManagerBriefing {
  generatedAt: string;
  scope: { global: boolean; propertyCount: number | null };
  kpis: BriefingKpis;
  pipeline: BriefingPipeline;
  attention: AttentionItem[];
  properties: PropertySnapshot[];
}

/** One scoped COUNT(*) over `table` with optional extra WHERE conditions. */
async function scopedCount(
  req: AuthRequest,
  table: string,
  propertyColumn: string,
  extraSql: string,
  extraParams: unknown[] = []
): Promise<number> {
  const params = [...extraParams];
  const conditions = extraSql ? [extraSql] : [];
  const scope = buildPropertyScope(req, params.length + 1, propertyColumn);
  if (scope.denyAll) return 0;
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(scope.param);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const res = await query(`SELECT COUNT(*)::int AS n FROM ${table} ${where}`, params);
  return Number(res.rows[0]?.n ?? 0);
}

export class ManagerBriefingService {
  /** Open work orders (not completed/cancelled). */
  private openWorkOrders(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "work_orders w",
      "w.property_id",
      "w.status IN ('submitted','assigned','in_progress','on_hold')"
    );
  }

  /** Open work orders flagged as life-safety emergencies. */
  private emergencyWorkOrders(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "work_orders w",
      "w.property_id",
      "w.is_emergency = TRUE AND w.status IN ('submitted','assigned','in_progress','on_hold')"
    );
  }

  /**
   * Overdue follow-ups: recertifications past their cutoff that haven't been
   * submitted or decided — the compliance clock GPMG cares about most.
   */
  private overdueFollowUps(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "recertifications r",
      "r.property_id",
      "r.cutoff_date < CURRENT_DATE AND r.status NOT IN ('approved','denied','submitted','under_review','market_rent_applied')"
    );
  }

  /**
   * Active turns: move-outs in the make-ready pipeline (notice through deposit
   * disposition), excluding terminal states. Proxy for "units being turned".
   */
  private activeTurns(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "move_outs m",
      "m.property_id",
      "m.status NOT IN ('closed','collections')"
    );
  }

  private screeningReview(req: AuthRequest): Promise<number> {
    return scopedCount(req, "applications a", "a.property_id", "a.status = 'screening_review'");
  }

  private pendingApprovals(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "applications a",
      "a.property_id",
      "a.status IN ('tier1_review','tier2_review','tier3_review')"
    );
  }

  /** Voice intakes waiting on a human callback (not yet promoted). */
  private voiceCallbacks(req: AuthRequest): Promise<number> {
    // voice_intake_calls has no property_id; it precedes property selection.
    // Scoped roles with no portfolio still shouldn't see a global count, so we
    // gate on global scope and otherwise return 0 (these are unassigned leads).
    const scope = buildPropertyScope(req, 1, "x");
    if (scope.denyAll || scope.sql) return Promise.resolve(0);
    return query(
      `SELECT COUNT(*)::int AS n FROM voice_intake_calls
        WHERE callback_requested = TRUE AND applicant_id IS NULL`
    ).then((r) => Number(r.rows[0]?.n ?? 0));
  }

  private upcomingRecerts(req: AuthRequest): Promise<number> {
    return scopedCount(
      req,
      "recertifications r",
      "r.property_id",
      "r.anniversary_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days' AND r.status NOT IN ('approved','denied')"
    );
  }

  /** Delinquent households + total past-due rent across onboarded tenants. */
  private async delinquency(
    req: AuthRequest
  ): Promise<{ households: number; pastDue: number }> {
    const params: unknown[] = [];
    const conditions = ["a.status = 'onboarded'"];
    const scope = buildPropertyScope(req, params.length + 1, "a.property_id");
    if (scope.denyAll) return { households: 0, pastDue: 0 };
    if (scope.sql) {
      conditions.push(scope.sql);
      params.push(scope.param);
    }
    const res = await query(
      `SELECT COUNT(*)::int AS households, COALESCE(SUM(bal.balance), 0)::numeric AS past_due
         FROM applications a
         JOIN (
           SELECT application_id, SUM(amount) AS balance
             FROM tenant_ledger WHERE status = 'posted'
            GROUP BY application_id
           HAVING SUM(amount) > 0
         ) bal ON bal.application_id = a.id
        WHERE ${conditions.join(" AND ")}`,
      params
    );
    return {
      households: Number(res.rows[0]?.households ?? 0),
      pastDue: Number(res.rows[0]?.past_due ?? 0),
    };
  }

  /** Per-property rollup for the snapshot table. */
  private async propertySnapshot(req: AuthRequest): Promise<PropertySnapshot[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    const scope = buildPropertyScope(req, params.length + 1, "p.id");
    if (scope.denyAll) return [];
    if (scope.sql) {
      conditions.push(scope.sql);
      params.push(scope.param);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const res = await query(
      `SELECT p.id, p.name,
              (SELECT COUNT(*) FROM work_orders w
                 WHERE w.property_id = p.id
                   AND w.status IN ('submitted','assigned','in_progress','on_hold')) AS open_work_orders,
              COUNT(DISTINCT CASE WHEN bal.balance > 0 THEN a.id END) AS delinquent_households,
              COALESCE(SUM(CASE WHEN bal.balance > 0 THEN bal.balance ELSE 0 END), 0)::numeric AS past_due_rent
         FROM properties p
         LEFT JOIN applications a ON a.property_id = p.id AND a.status = 'onboarded'
         LEFT JOIN (
           SELECT application_id, SUM(amount) AS balance
             FROM tenant_ledger WHERE status = 'posted' GROUP BY application_id
         ) bal ON bal.application_id = a.id
         ${where}
         GROUP BY p.id, p.name
         ORDER BY past_due_rent DESC, open_work_orders DESC`,
      params
    );
    return res.rows.map((r) => ({
      propertyId: r.id as string,
      name: r.name as string,
      openWorkOrders: Number(r.open_work_orders ?? 0),
      delinquentHouseholds: Number(r.delinquent_households ?? 0),
      pastDueRent: Number(r.past_due_rent ?? 0),
    }));
  }

  /**
   * Build the prioritized attention list from a handful of bounded queries.
   * High = compliance/safety risk; medium = pipeline backing up; low = leads.
   */
  private async attention(req: AuthRequest): Promise<AttentionItem[]> {
    const items: AttentionItem[] = [];

    // Emergency work orders — each is its own high-severity line.
    const emerParams: unknown[] = [];
    const emerConds = ["w.is_emergency = TRUE", "w.status IN ('submitted','assigned','in_progress','on_hold')"];
    const emerScope = buildPropertyScope(req, emerParams.length + 1, "w.property_id");
    if (!emerScope.denyAll) {
      if (emerScope.sql) {
        emerConds.push(emerScope.sql);
        emerParams.push(emerScope.param);
      }
      const emer = await query(
        `SELECT w.id, w.title, w.unit_number, p.name AS property_name
           FROM work_orders w JOIN properties p ON p.id = w.property_id
          WHERE ${emerConds.join(" AND ")}
          ORDER BY w.created_at ASC LIMIT 8`,
        emerParams
      );
      for (const r of emer.rows) {
        items.push({
          id: `wo:${r.id}`,
          kind: "emergency_work_order",
          severity: "high",
          title: `Emergency: ${r.title}`,
          detail: `${r.property_name}${r.unit_number ? ` · Unit ${r.unit_number}` : ""}`,
        });
      }
    }

    // Overdue recertifications — compliance risk, each its own high line.
    const recParams: unknown[] = [];
    const recConds = [
      "r.cutoff_date < CURRENT_DATE",
      "r.status NOT IN ('approved','denied','submitted','under_review','market_rent_applied')",
    ];
    const recScope = buildPropertyScope(req, recParams.length + 1, "r.property_id");
    if (!recScope.denyAll) {
      if (recScope.sql) {
        recConds.push(recScope.sql);
        recParams.push(recScope.param);
      }
      const rec = await query(
        `SELECT r.id, r.tenant_name, r.cutoff_date, p.name AS property_name
           FROM recertifications r JOIN properties p ON p.id = r.property_id
          WHERE ${recConds.join(" AND ")}
          ORDER BY r.cutoff_date ASC LIMIT 8`,
        recParams
      );
      for (const r of rec.rows) {
        const cutoff = r.cutoff_date ? new Date(r.cutoff_date) : null;
        const cutoffStr =
          cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff.toISOString().slice(0, 10) : "unknown";
        items.push({
          id: `recert:${r.id}`,
          kind: "overdue_recertification",
          severity: "high",
          title: `Recert overdue: ${r.tenant_name ?? "tenant"}`,
          detail: `${r.property_name} · cutoff ${cutoffStr}`,
        });
      }
    }

    // Aggregate pipeline items — one line each when non-zero.
    const [screening, approvals, callbacks] = await Promise.all([
      this.screeningReview(req),
      this.pendingApprovals(req),
      this.voiceCallbacks(req),
    ]);
    if (screening > 0) {
      items.push({
        id: "agg:screening_review",
        kind: "screening_review",
        severity: "medium",
        title: `${screening} application${screening === 1 ? "" : "s"} in screening review`,
        detail: "Holds awaiting a manual screening decision",
      });
    }
    if (approvals > 0) {
      items.push({
        id: "agg:pending_approvals",
        kind: "pending_approvals",
        severity: "medium",
        title: `${approvals} application${approvals === 1 ? "" : "s"} awaiting approval`,
        detail: "Sitting in a tier review queue",
      });
    }
    if (callbacks > 0) {
      items.push({
        id: "agg:voice_callbacks",
        kind: "voice_callbacks",
        severity: "low",
        title: `${callbacks} voice intake callback${callbacks === 1 ? "" : "s"} requested`,
        detail: "Inbound Frank calls flagged for follow-up",
      });
    }

    const rank: Record<AttentionSeverity, number> = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  async getBriefing(req: AuthRequest, generatedAt: string): Promise<ManagerBriefing> {
    const [
      openWorkOrders,
      emergencyWorkOrders,
      overdueFollowUps,
      activeTurns,
      delinquency,
      screeningReview,
      pendingApprovals,
      voiceCallbacks,
      upcomingRecerts,
      attention,
      properties,
    ] = await Promise.all([
      this.openWorkOrders(req),
      this.emergencyWorkOrders(req),
      this.overdueFollowUps(req),
      this.activeTurns(req),
      this.delinquency(req),
      this.screeningReview(req),
      this.pendingApprovals(req),
      this.voiceCallbacks(req),
      this.upcomingRecerts(req),
      this.attention(req),
      this.propertySnapshot(req),
    ]);

    // Global is a role property (admin / asset / regional), NOT "empty
    // property_ids" — a scoped role with no properties is deny-all, not global.
    const global = isGlobalPropertyScope(req);
    return {
      generatedAt,
      scope: { global, propertyCount: global ? null : req.user?.propertyIds?.length ?? 0 },
      kpis: {
        openWorkOrders,
        emergencyWorkOrders,
        overdueFollowUps,
        activeTurns,
        delinquentHouseholds: delinquency.households,
        pastDueRent: delinquency.pastDue,
      },
      pipeline: { screeningReview, pendingApprovals, voiceCallbacks, upcomingRecerts },
      attention,
      properties,
    };
  }
}

export const managerBriefingService = new ManagerBriefingService();
