import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { requestMagicLink } from "@/api/auth";
import { useT } from "@/i18n";
import { HF } from "@/styles/tokens";

/**
 * BP-03b — Magic-link-sent confirmation page.
 *
 * Reads `?email=...` from query, falls back to sessionStorage `pendingEmail`
 * (Lane D's StepRegister stashes it there).
 */
function readEmail(params: URLSearchParams): string | null {
  const q = params.get("email");
  if (q) return q;
  try {
    return sessionStorage.getItem("pendingEmail");
  } catch {
    return null;
  }
}

export function MagicLinkSent() {
  const [search] = useSearchParams();
  const t = useT("waitlist");
  const email = readEmail(search);

  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    if (!email || resending) return;
    setResending(true);
    setResendError(null);
    try {
      await requestMagicLink(email);
      setResentAt(Date.now());
    } catch (e) {
      setResendError((e as Error).message);
    } finally {
      setResending(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <section
        className="w-full max-w-md text-center rounded-2xl px-8 py-10"
        style={{ background: HF.paper, boxShadow: HF.shadow.lg, borderRadius: HF.r.lg }}
        aria-labelledby="magic-link-sent-heading"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex items-center justify-center"
          style={{
            width: 64,
            height: 64,
            borderRadius: HF.r.pill,
            background: HF.accentLo,
            fontSize: 32,
          }}
        >
          ✉️
        </div>
        <h1
          id="magic-link-sent-heading"
          className="text-2xl font-semibold mb-3"
          style={{ fontFamily: HF.display }}
        >
          {t("magic_link_sent.title")}
        </h1>
        <p className="text-base mb-2" style={{ color: HF.ink2 }}>
          {t("magic_link_sent.body", { email: email ?? "your inbox" })}
        </p>
        <p className="text-sm mb-6" style={{ color: HF.ink3 }}>
          {t("magic_link_sent.expires")}
        </p>

        <div
          className="rounded-lg p-4 mb-4"
          style={{ background: HF.cream, borderRadius: HF.r.md }}
        >
          <p className="text-sm mb-2" style={{ color: HF.ink2 }}>
            {t("magic_link_sent.resend_prompt")}
          </p>
          <button
            type="button"
            onClick={handleResend}
            disabled={!email || resending}
            className="px-5 py-2 rounded-lg font-medium disabled:opacity-50"
            style={{ background: HF.accent, color: HF.paper, borderRadius: HF.r.md }}
            aria-disabled={!email || resending}
          >
            {resending ? "…" : t("magic_link_sent.resend_cta")}
          </button>
          {resentAt && (
            <p role="status" className="text-sm mt-3" style={{ color: HF.accent }}>
              {t("magic_link_sent.resend_sent")}
            </p>
          )}
          {resendError && (
            <p role="alert" className="text-sm mt-3 text-red-600">
              {resendError}
            </p>
          )}
        </div>

        <Link to="/apply" className="text-sm underline" style={{ color: HF.ink3 }}>
          {t("magic_link_sent.wrong_email")}
        </Link>
      </section>
    </main>
  );
}

export default MagicLinkSent;
