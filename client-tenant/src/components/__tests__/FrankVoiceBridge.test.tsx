// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HousingChatWidget } from '../HousingChatWidget';
import { TalkToFrankPill, __setVoiceDriverForTests } from '../TalkToFrankPill';
import { _rehydrateForTests, acceptAll } from '@/state/consent';
import { wantsHuman, requestFrankVoice, FRANK_START_VOICE_EVENT } from '@/lib/frankVoiceBridge';

vi.mock('@/api/client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, askHousingQa: vi.fn(async () => ({ answer: 'ok' })) };
});

// Render the chat + pill together — the bridge is the contract between them.
function renderBoth() {
  return render(
    <MemoryRouter>
      <HousingChatWidget />
      <TalkToFrankPill />
    </MemoryRouter>,
  );
}

describe('frankVoiceBridge helpers', () => {
  it('wantsHuman matches person/stuck intent, not ordinary questions', () => {
    expect(wantsHuman('can I talk to a person')).toBe(true);
    expect(wantsHuman("I'm stuck on the form")).toBe(true);
    expect(wantsHuman('I need a real person')).toBe(true);
    expect(wantsHuman('call me please')).toBe(true);
    expect(wantsHuman('what documents do I need?')).toBe(false);
    expect(wantsHuman('senior housing in Henderson')).toBe(false);
  });

  it('requestFrankVoice dispatches the start-voice event', () => {
    const spy = vi.fn();
    window.addEventListener(FRANK_START_VOICE_EVENT, spy);
    requestFrankVoice();
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(FRANK_START_VOICE_EVENT, spy);
  });
});

describe('in-app Frank bridge (chat → live voice)', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView (the chat auto-scrolls on new msgs).
    Element.prototype.scrollIntoView = vi.fn();
    window.localStorage.clear();
    _rehydrateForTests();
    acceptAll(); // clear the cookie banner so both surfaces render
    __setVoiceDriverForTests(null);
  });
  afterEach(() => __setVoiceDriverForTests(null));

  it('the chat header "Talk to Frank" button starts a live voice session via the pill', async () => {
    const mint = vi.fn(async () => ({ status: 'rate_limited' as const, retryAfterSecs: 60 }));
    __setVoiceDriverForTests({ mint, startSession: vi.fn() });
    const user = userEvent.setup();
    renderBoth();

    // Open the chat panel, then hand off to Frank.
    await user.click(screen.getByRole('button', { name: /ask about housing/i }));
    await user.click(screen.getByRole('button', { name: /talk to frank by voice/i }));

    // The pill received the bridge event and tried to mint a session.
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
  });

  it('surfaces the voice nudge when the visitor asks for a person, and it hands off', async () => {
    const mint = vi.fn(async () => ({ status: 'rate_limited' as const, retryAfterSecs: 60 }));
    __setVoiceDriverForTests({ mint, startSession: vi.fn() });
    const user = userEvent.setup();
    renderBoth();

    await user.click(screen.getByRole('button', { name: /ask about housing/i }));
    const input = screen.getByRole('textbox', { name: /ask a question/i });
    await user.type(input, 'I need to talk to a person{Enter}');

    // The nudge CTA appears…
    const nudge = await screen.findByText(/get frank on the line/i);
    expect(nudge).toBeInTheDocument();

    // …and clicking the nudge's button bridges to the pill. (Both the header and
    // the nudge expose the same accessible name, so target the last one.)
    const buttons = screen.getAllByRole('button', { name: /talk to frank by voice/i });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mint).toHaveBeenCalled());
  });
});
