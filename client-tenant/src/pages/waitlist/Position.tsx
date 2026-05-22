import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api } from "@/api/client";
import { useTranslation } from "react-i18next";
import { HF } from "@/styles/tokens";

/**
 * Wedge #5 — Waitlist position screen ("#12 of 38").
 *
 * Reads GET /api/applicants/properties/:slug/waitlist-summary?bedrooms=N.
 * The server now requires ?bedrooms since position is per-tier-per-property.
 * Falls back to a placeholder shape if the endpoint is unreachable (keeps
 * the offline demo working).
 */
interface WaitlistSummary {
  position?: number;
  totalQueue: number;
  movement?: { spotsThisMonth: number; direction: "up" | "down" | "flat" } | null;
  estimatedWindow: string;
  enrolled?: boolean;
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
  const [searchParams] = useSearchParams();
  const slug = params.slug ?? "donna-louise-2";
  const { t } = useTranslation("waitlist");

  // Bedrooms tier comes from the URL (?bedrooms=N), set by WaitlistBanner or
  // the apply funnel. Default to 2BR as the most common tier when missing —
  // the server still returns a meaningful answer either way.
  const bedrooms = useMemo(() => {
    const raw = searchParams.get("bedrooms");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 6 ? n : 2;
  }, [searchParams]);

  const [summary, setSummary] = useState<WaitlistSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<WaitlistSummary>(
        `/applicants/properties/${slug}/waitlist-summary?bedrooms=${bedrooms}`
      )
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
  }, [slug, bedrooms, t]);

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
          {summary.position != null ? (
            <>
              <p
                className="text-5xl font-bold"
                style={{ color: HF.accent, fontFamily: HF.display }}
              >
                #{summary.position}
              </p>
              <p className="mt-2 text-sm" style={{ color: HF.ink2 }}>
                {t("position.rank", {
                  position: summary.position,
                  total: summary.totalQueue,
                })}
              </p>
            </>
          ) : (
            // Not-yet-enrolled callers still get a useful number — the queue
            // depth — so the screen never renders "#undefined".
            <>
              <p
                className="text-5xl font-bold"
                style={{ color: HF.accent, fontFamily: HF.display }}
              >
                {summary.totalQueue}
              </p>
              <p className="mt-2 text-sm" style={{ color: HF.ink2 }}>
                {t("position.queue_depth", { total: summary.totalQueue, defaultValue: "{{total}} on the waitlist" })}
              </p>
            </>
          )}
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
