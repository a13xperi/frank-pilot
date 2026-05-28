// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TalkToFrankPill, __setVoiceDriverForTests } from '../TalkToFrankPill';
import { _rehydrateForTests, acceptAll } from '@/state/consent';
import type { StartVoiceSessionResult } from '@/api/client';

function renderPill() {
  return render(
    <MemoryRouter>
      <TalkToFrankPill />
    </MemoryRouter>,
  );
}

const okResult: StartVoiceSessionResult = {
  status: 'ok',
  signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?signed=stub',
  agentId: 'agent_test',
  sessionId: 'sess_test',
  maxDurationSecs: 600,
};

describe('TalkToFrankPill', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
    _rehydrateForTests();
    // Pre-accept consent so the pill isn't hidden behind the cookie banner.
    acceptAll();
    __setVoiceDriverForTests(null); // reset
  });

  afterEach(() => {
    vi.useRealTimers();
    __setVoiceDriverForTests(null);
  });

  it('renders the idle pill when consent has been recorded', () => {
    renderPill();
    expect(
      screen.getByRole('button', { name: /start a voice call with frank/i }),
    ).toBeInTheDocument();
  });

  it('hides while the cookie banner is still showing', () => {
    window.localStorage.clear();
    _rehydrateForTests(); // recordedAt back to null
    renderPill();
    expect(
      screen.queryByRole('button', { name: /talk to frank|start a voice call/i }),
    ).not.toBeInTheDocument();
  });

  it('hides forever when the API returns 503 (feature off / budget exhausted)', async () => {
    __setVoiceDriverForTests({
      mint: async () => ({ status: 'disabled' }),
      startSession: vi.fn(),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /start a voice call/i })).not.toBeInTheDocument();
    });
  });

  it('shows a transient hint on 429 and auto-dismisses after ~5s', async () => {
    __setVoiceDriverForTests({
      mint: async () => ({ status: 'rate_limited', retryAfterSecs: 60 }),
      startSession: vi.fn(),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/too many calls/i);
    });
    // Pill itself stays mounted.
    expect(screen.getByRole('button', { name: /start a voice call/i })).toBeInTheDocument();
    // Advance past the 5s auto-dismiss.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a transient hint on network/upstream error', async () => {
    __setVoiceDriverForTests({
      mint: async () => ({ status: 'error', message: 'upstream' }),
      startSession: vi.fn(),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/could not start/i);
    });
  });

  it('hands the signed URL to the SDK on a successful mint and transitions to live on connect', async () => {
    let onConnect: () => void = () => {};
    const startSession = vi.fn().mockImplementation(async (signedUrl, callbacks) => {
      expect(signedUrl).toBe(okResult.signedUrl);
      onConnect = callbacks.onConnect;
      return { endSession: vi.fn().mockResolvedValue(undefined) };
    });
    __setVoiceDriverForTests({
      mint: async () => okResult,
      startSession,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith(
        okResult.signedUrl,
        expect.objectContaining({
          onConnect: expect.any(Function),
          onDisconnect: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });
    // Simulate the SDK firing onConnect.
    await act(async () => {
      onConnect();
    });
    expect(
      screen.getByRole('button', { name: /end the voice call/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end the voice call/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('ends the live conversation when the button is clicked while live', async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    let onConnect: () => void = () => {};
    __setVoiceDriverForTests({
      mint: async () => okResult,
      startSession: async (_signedUrl, callbacks) => {
        onConnect = callbacks.onConnect;
        return { endSession };
      },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => expect(onConnect).toBeTruthy());
    await act(async () => {
      onConnect();
    });
    await user.click(screen.getByRole('button', { name: /end the voice call/i }));
    expect(endSession).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start a voice call/i }),
      ).toBeInTheDocument();
    });
  });

  it('returns to idle and surfaces an error hint when the SDK throws (mic denied / handshake fail)', async () => {
    __setVoiceDriverForTests({
      mint: async () => okResult,
      startSession: async () => {
        throw new Error('NotAllowedError');
      },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPill();
    await user.click(screen.getByRole('button', { name: /start a voice call/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/could not start/i);
    });
  });
});
