import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the low-level client so we assert on the request path the helper builds,
// without touching fetch. Mirrors how the helper is the only seam over api.get.
vi.mock('../client', () => ({
  api: { get: vi.fn() },
}));

import { api } from '../client';
import { fetchVoicePrefill, type VoicePrefillResponse } from '../voiceIntake';

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;

describe('fetchVoicePrefill', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('hits the applicant prefill endpoint for the conversation id', async () => {
    const payload: VoicePrefillResponse = {
      conversationId: 'conv_123',
      language: 'en',
      prefill: {
        firstName: 'Sarah',
        lastName: 'Lee',
        phone: '+17025550123',
        currentCity: 'Henderson',
        householdSize: 3,
        monthlyIncome: 2400,
        consentRecording: true,
      },
    };
    mockGet.mockResolvedValueOnce(payload);

    const res = await fetchVoicePrefill('conv_123');

    expect(mockGet).toHaveBeenCalledWith('/voice/intakes/conv_123/prefill');
    expect(res).toEqual(payload);
  });

  it('url-encodes the conversation id so a stray handle cannot break the path', async () => {
    mockGet.mockResolvedValueOnce({ conversationId: 'a/b?c', language: null, prefill: {} });

    await fetchVoicePrefill('a/b?c');

    expect(mockGet).toHaveBeenCalledWith('/voice/intakes/a%2Fb%3Fc/prefill');
  });

  it('propagates a rejection so the caller can fall back to the blank form', async () => {
    mockGet.mockRejectedValueOnce(new Error('Not found'));
    await expect(fetchVoicePrefill('conv_missing')).rejects.toThrow('Not found');
  });
});
