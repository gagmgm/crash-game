import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../network/messages';

describe('message validation', () => {
  it('parses a valid server message', () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: 'ROUND_TICK',
        serverTimestamp: 1,
        roundId: 'round-1',
        elapsedMs: 100,
        multiplier: 1.01,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('ROUND_TICK');
  });

  it('rejects malformed, unknown and invalid messages without throwing', () => {
    expect(parseServerMessage('{not json').ok).toBe(false);
    expect(parseServerMessage('[]').ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ type: 'NOPE', serverTimestamp: 1 })).ok).toBe(false);
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'ROUND_TICK', serverTimestamp: 1, roundId: 'r', elapsedMs: 1 }),
      ).ok,
    ).toBe(false);
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'BALANCE_UPDATED',
          serverTimestamp: 1,
          balance: 10.5,
          currency: 'USD',
          version: 1,
        }),
      ).ok,
    ).toBe(false);
  });

  it('validates client commands (used by the mock server)', () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'PLACE_BET', requestId: 'a', roundId: 'r', amount: 100 }),
      ).ok,
    ).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'CASH_OUT', requestId: 'a' })).ok).toBe(false);
  });
});
