import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/api/client";
import { useT } from "@/i18n";
import { HF } from "@/styles/tokens";

/**
 * BP-03b — Waitlist position screen ("#12 of 38").
 *
 * Reads GET /api/applicants/properties/:slug/waitlist-summary. Falls back to
 * a placeholder shape if the endpoint is unreachable (which keeps the demo
 * working in offline mode).
 */
interface WaitlistSummary {
  position: number;
  totalQueue: number;
  movement?: { spotsThisMonth: number; direction: "up" | "down" | "flat" };
  estimatedWindow: string;
  placeholder?: boolean;
}

const FALLBACK: WaitlistSummary = {
  position: 12,
  totalQueue: 38,
  movement: { spotsThisMonth: 3, direction: "up" },
  estimatedWindow: "3–6 months",
};

export function WaitlistPosition() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? "donna-louise-2";
  const t = useT("waitlist");

  const [summary, setSummary] = useState<WaitlistSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<WaitlistSummary>(`/applicants/properties/${slug}/waitlist-summary`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(FALLBACK);
          setError(t("position.error"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  if (!summary) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
        aria-busy="true"
      >
        <p>{t("position.loading")}</p>
      </main>
    );
  }

  const movementKey =
    summary.movement?.direction === "up"
      ? "position.movement_up"
      : summary.movement?.direction === "down"
      ? "position.movement_down"
      : "position.movement_flat";

  return (
    <main
      className="min-h-screen px-6 py-10 flex flex-col items-center"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <section
        className="w-full max-w-md rounded-2xl px-8 py-10 text-center"
        style={{ background: HF.paper, boxShadow: HF.shadow.lg, borderRadius: HF.r.lg }}
        aria-labelledby="waitlist-position-heading"
      >
        <h1
          id="waitlist-position-heading"
          className="text-2xl font-semibold mb-6"
          style={{ fontFamily: HF.display }}
        >
          {t("position.title")}
        </h1>

        <div className="my-8">
          <p className="text-5xl font-bold" style={{ color: HF.accent, fontFamily: HF.display }}>
            #{summary.position}
          </p>
          <p className="mt-2 text-sm" style={{ color: HF.ink2 }}>
            {t("position.rank", { position: summary.position, total: summary.totalQueue })}
          </p>
        </div>

        {summary.movement && (
          <p
            className="inline-block px-3 py-1 rounded-full text-sm mb-4"
            style={{ background: HF.accentLo, color: HF.accent, borderRadius: HF.r.pill }}
          >
            {t(movementKey, { spots: summary.movement.spotsThisMonth })}
          </p>
        )}

        <p className="text-base font-medium mt-2" style={{ color: HF.ink }}>
          {t("position.estimated_wait", { window: summary.estimatedWindow })}
        </p>

        <p className="mt-6 text-sm" style={{ color: HF.ink3 }}>
          {t("position.subtitle")}
        </p>

        {error && (
          <p role="status" className="mt-4 text-xs" style={{ color: HF.ink3 }}>
            {error}
          </p>
        )}

        <Link
          to="/waitlist/faster-list"
          className="mt-8 inline-block px-6 py-3 rounded-lg text-white font-medium"
          style={{ background: HF.accent, borderRadius: HF.r.md }}
        >
          {/* English label kept short, no i18n key needed — link copy is universal */}
          Move up faster →
        </Link>
      </section>
    </main>
  );
}

export default WaitlistPosition;
