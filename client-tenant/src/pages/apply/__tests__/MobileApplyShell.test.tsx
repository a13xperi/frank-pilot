/**
 * Wedge #7 — mobile-first apply shell.
 *
 * Asserts that with `MOBILE_APPLY_ENABLED=true` AND a `< md` viewport
 * (matchMedia('(max-width: 767.98px)').matches === true) the Apply page
 * renders the mobile shell:
 *   - sticky CTA bar (data-testid="mobile-apply-cta-bar")
 *   - progress strip (data-testid="mobile-apply-progress")
 *   - the legacy desktop horizontal stepper is NOT rendered
 *
 * Also covers two regressions:
 *   - tap-target sizing: StepCTA portals to the sticky bar with `size=lg`
 *     and `block=true`, so the rendered <button> carries the lg padding
 *     (py: 14) and `w-full` class (HF token-driven, ≥46px tall)
 *   - input attributes: the StepIntent income field carries
 *     inputMode="numeric" + autoComplete="off"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Apply } from '../../Apply';
import { StepIntent } from '../steps/StepIntent';
import { MobileApplyShell } from '../MobileApplyShell';
import { StepCTA } from '../StepCTA';
import { ApplyProvider } from '../ApplyContext';
import { renderWithApply, makeState, mockFetch } from './helpers';

// Minimal harness — MobileApplyShell needs ApplyProvider for
// useApplyProgress(). Wraps a single StepCTA whose render targets the
// sticky bar slot via the portal context.
function MobileApplyShellRoute() {
  return (
    <ApplyProvider value={makeState({ step: 'intent' })}>
      <MobileApplyShell>
        <StepCTA tone="primary">Continue</StepCTA>
      </MobileApplyShell>
    </ApplyProvider>
  );
}

// Force mobile flag on. flags.ts caches import.meta.env at module load,
// so module-mock is the only way to flip it after the test loads.
vi.mock('@/lib/flags', () => ({
  useFlag: (name: string) => {
    // Mobile shell on; pin payment wizard off so the integration walk
    // routes through Step2Details (legacy path) for unit-claim regression
    // simplicity — though this suite doesn't drive that flow.
    if (name === 'MOBILE_APPLY_ENABLED') return true;
    if (name === 'PAYMENT_WIZARD_ENABLED') return false;
    return true;
  },
}));

// jsdom has no matchMedia. Stub it so useIsMobile can read the mobile
// breakpoint deterministically. The factory lets each test flip mobile.
let MOBILE = true;
function installMatchMedia() {
  const make = (query: string): MediaQueryList => ({
    matches: query.includes('767.98px') ? MOBILE : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (q: string) => make(q),
  });
}

function installFetchStub() {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ applications: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
}

function renderApply(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/apply" element={<Apply />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Wedge #7 — MobileApplyShell rendering', () => {
  beforeEach(() => {
    MOBILE = true;
    installMatchMedia();
    installFetchStub();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts the mobile shell when flag on AND viewport < md', () => {
    renderApply('/apply');
    expect(screen.getByTestId('mobile-apply-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-apply-cta-bar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-apply-progress')).toBeInTheDocument();
  });

  it('renders the progress count strip (n/total)', () => {
    renderApply('/apply');
    // step=1 (Register), total=7 (canonical apply tower).
    const count = screen.getByTestId('mobile-apply-progress-count');
    expect(count.textContent).toMatch(/^\d+\/\d+$/);
  });

  it('renders a progressbar role with valuemin/valuemax/valuenow', () => {
    renderApply('/apply');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar.getAttribute('aria-valuemax')).toMatch(/^\d+$/);
    expect(bar.getAttribute('aria-valuenow')).toMatch(/^\d+$/);
  });

  it('does NOT render the desktop horizontal stepper (StepIndicator)', () => {
    renderApply('/apply');
    // StepIndicator renders a <nav> (role=navigation). The mobile shell
    // ships its own progress strip (header data-testid="mobile-apply-progress")
    // instead of importing StepIndicator — so there should be zero <nav>
    // elements in the mobile branch.
    const navs = document.querySelectorAll('nav');
    expect(navs.length).toBe(0);
  });

  it('falls back to desktop layout when viewport >= md (flag still on)', () => {
    MOBILE = false;
    installMatchMedia();
    renderApply('/apply');
    expect(screen.queryByTestId('mobile-apply-shell')).not.toBeInTheDocument();
    // Desktop branch mounts <StepIndicator> twice (aside + above the card),
    // each of which renders a <nav>. We just need ≥1 <nav> to confirm we
    // dropped back to the legacy layout.
    const navs = document.querySelectorAll('nav');
    expect(navs.length).toBeGreaterThan(0);
  });
});

describe('Wedge #7 — tap-target sizing via StepCTA on mobile shell', () => {
  beforeEach(() => {
    MOBILE = true;
    installMatchMedia();
    installFetchStub();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // StepCTA portals its <CTA> into the shell's footer slot when wrapped
  // by <MobileApplyShell>. Mount a minimal harness so we can probe the
  // button without driving the whole wizard. (Step1Register intentionally
  // uses inline <CTA> — wedge #13 collision — so it won't portal.)
  function renderShellWithStepCta() {
    return render(
      <MemoryRouter>
        <MobileApplyShellRoute />
      </MemoryRouter>,
    );
  }

  it('StepCTA in the sticky bar renders with HF lg size + block (w-full)', () => {
    renderShellWithStepCta();
    const bar = screen.getByTestId('mobile-apply-cta-bar');
    const button = bar.querySelector('button');
    expect(button).not.toBeNull();
    expect(button!.className).toMatch(/w-full/);
    // size=lg → padding "14px 20px".
    expect(button!.getAttribute('style') ?? '').toMatch(/padding:\s*14px\s+20px/);
  });

  it('StepCTA carries data-variant="mobile" inside the shell', () => {
    renderShellWithStepCta();
    const bar = screen.getByTestId('mobile-apply-cta-bar');
    const button = bar.querySelector('button');
    expect(button?.getAttribute('data-variant')).toBe('mobile');
  });
});

describe('Wedge #7 — touch-optimized input attributes', () => {
  beforeEach(() => {
    MOBILE = true;
    installMatchMedia();
    mockFetch({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('StepIntent income field has inputMode="numeric" and autoComplete="off"', () => {
    renderWithApply(<StepIntent />, { state: makeState({ step: 'intent' }) });
    // Income input is the one labeled with the income copy. We probe
    // by name attribute / labelled-by to be resilient to i18n: it's
    // the only <input inputmode="numeric"> on the intent step.
    const numericInputs = document.querySelectorAll('input[inputmode="numeric"]');
    expect(numericInputs.length).toBeGreaterThan(0);
    // Income field also has autocomplete="off" per wedge #7 spec.
    const income = Array.from(numericInputs).find(
      (el) => el.getAttribute('autocomplete') === 'off',
    );
    expect(income).toBeTruthy();
  });
});
