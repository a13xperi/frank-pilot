import { Link } from "react-router-dom";
import { useT } from "@/i18n";
import { HF } from "@/styles/tokens";

/**
 * BP-03b — "Three ways to move up the list" screen.
 *
 * Three priority-placement option cards. Each CTA routes to a doc-upload
 * stub (`/waitlist/faster-list/upload/:option`) which is intentionally
 * out of scope for BP-03b — a placeholder route returns the user to here.
 */
const OPTIONS = [
  { id: "referral", icon: "🏛" },
  { id: "veteran", icon: "🎖" },
  { id: "hardship", icon: "🆘" },
] as const;

export function WaitlistFasterList() {
  const t = useT("waitlist");

  return (
    <main
      className="min-h-screen px-6 py-10"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <section className="max-w-2xl mx-auto" aria-labelledby="faster-list-heading">
        <header className="mb-6 text-center">
          <h1
            id="faster-list-heading"
            className="text-2xl font-semibold mb-2"
            style={{ fontFamily: HF.display }}
          >
            {t("faster_list.title")}
          </h1>
          <p className="text-sm" style={{ color: HF.ink2 }}>
            {t("faster_list.subtitle")}
          </p>
        </header>

        <ul className="space-y-4" role="list">
          {OPTIONS.map((opt) => (
            <li key={opt.id}>
              <article
                className="rounded-2xl px-6 py-5"
                style={{
                  background: HF.paper,
                  boxShadow: HF.shadow.md,
                  borderRadius: HF.r.lg,
                  border: `1px solid ${HF.border}`,
                }}
                aria-labelledby={`faster-${opt.id}-title`}
              >
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="text-3xl shrink-0"
                    style={{ lineHeight: 1 }}
                  >
                    {opt.icon}
                  </span>
                  <div className="flex-1">
                    <h2
                      id={`faster-${opt.id}-title`}
                      className="text-lg font-medium mb-1"
                      style={{ fontFamily: HF.display }}
                    >
                      {t(`faster_list.${opt.id}.title`)}
                    </h2>
                    <p className="text-sm mb-4" style={{ color: HF.ink2 }}>
                      {t(`faster_list.${opt.id}.body`)}
                    </p>
                    <Link
                      to={`/waitlist/faster-list/upload/${opt.id}`}
                      className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
                      style={{
                        background: HF.accent,
                        color: HF.paper,
                        borderRadius: HF.r.md,
                      }}
                    >
                      {t(`faster_list.${opt.id}.cta`)}
                    </Link>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>

        <p className="text-center mt-8">
          <Link to="/waitlist/position" className="text-sm underline" style={{ color: HF.ink2 }}>
            ← Back to my spot
          </Link>
        </p>
      </section>
    </main>
  );
}

export default WaitlistFasterList;
