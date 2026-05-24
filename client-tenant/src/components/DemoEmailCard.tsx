import { Mail } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { isDemoMode } from '@/lib/demoSession';

// Faithful "the email arrived" card, shown in place of a raw devLink whenever
// the server echoes a magic-link (dev / demo / staging — never on a closed
// prod). During a usability walkthrough the inbox isn't real, so we render the
// sign-in email *inline* and let the tester click it exactly as they would in
// Gmail. This keeps the auth step in the test instead of dead-ending people
// who'll never receive a message.
//
// Copy is intentionally hardcoded English: this is a test-only affordance, so
// it stays out of the i18n parity gate.
export function DemoEmailCard({
  email,
  onOpen,
}: {
  email: string;
  onOpen: () => void;
}) {
  const demo = isDemoMode();
  return (
    <div
      className="text-left"
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.md,
        overflow: 'hidden',
        boxShadow: HF.shadow.sm,
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}
      >
        <Mail className="h-4 w-4" style={{ color: HF.sage }} />
        <span className="text-xs font-semibold" style={{ color: HF.ink2 }}>
          {demo ? 'Demo inbox' : 'Dev inbox'}
        </span>
      </div>
      <div className="px-4 py-3 space-y-1">
        <div className="text-sm font-semibold" style={{ color: HF.ink }}>
          Your sign-in link
        </div>
        <div className="text-xs" style={{ color: HF.ink3 }}>
          Frank Housing &lt;no-reply@frankhousing.com&gt; → {email}
        </div>
      </div>
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full px-4 py-2 text-center text-sm font-semibold"
          style={{ background: HF.accent, color: HF.paper, borderRadius: HF.r.sm }}
        >
          Open the link
        </button>
        <p className="mt-2 text-center text-xs" style={{ color: HF.ink3 }}>
          {demo
            ? "We didn't actually email you — tap above to continue, just like clicking the link in your inbox."
            : 'Email delivery is off in this environment.'}
        </p>
      </div>
    </div>
  );
}
