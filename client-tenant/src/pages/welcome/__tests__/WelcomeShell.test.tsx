// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import axe from 'axe-core';
import { WelcomeShell } from '../WelcomeShell';
import { WELCOME_STATES } from '../WelcomeStates';

// Capture navigate calls from inside the shell.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

function renderAt(state: string) {
  return render(
    <MemoryRouter initialEntries={[`/welcome?state=${state}`]}>
      <Routes>
        <Route path="/welcome" element={<WelcomeShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WelcomeShell — smoke per state', () => {
  beforeEach(() => navigateSpy.mockReset());

  for (const state of WELCOME_STATES) {
    it(`renders without crashing in '${state}' state`, () => {
      renderAt(state);
      // Brand header always present.
      expect(screen.getAllByText(/Donna Louise 2/i).length).toBeGreaterThan(0);
    });
  }
});

describe('WelcomeShell — a11y (axe-core)', () => {
  for (const state of WELCOME_STATES) {
    it(`has no a11y violations in '${state}' state`, async () => {
      const { container } = renderAt(state);
      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
    });
  }
});

describe('WelcomeShell — disclosure + CTA navigates with correct query', () => {
  beforeEach(() => navigateSpy.mockReset());

  it('navigates to /apply with unitType + propertyId + state on accept', () => {
    renderAt('available');

    // Trigger primary CTA (mobile or desktop — both wired to the same handler).
    const ctaButtons = screen.getAllByRole('button', { name: /start application/i });
    fireEvent.click(ctaButtons[0]);

    // Disclosure dialog should now be open.
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Tick the acknowledgement checkbox.
    const ack = screen.getByRole('checkbox');
    fireEvent.click(ack);

    // Accept.
    const accept = screen.getByRole('button', { name: /accept & continue/i });
    fireEvent.click(accept);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const arg = navigateSpy.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\/apply\?/);
    expect(arg).toContain('step=intent');
    expect(arg).toContain('unitType=2BR');
    expect(arg).toContain('propertyId=donna-louise-2');
    expect(arg).toContain('state=available');
  });

  it('does not navigate when disclosure is cancelled', () => {
    renderAt('available');
    fireEvent.click(screen.getAllByRole('button', { name: /start application/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// Suppress unused-import lint for the helper re-export.
void useNavigate;
