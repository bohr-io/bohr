import { describe, expect, it, vi } from 'vitest';
import { errorMessage, type Fetch, fetchWithRetry, isRetryableStatus, parseRetryAfter } from '../src/http';
import { noSleep } from './helpers';

describe('parseRetryAfter', () => {
  it('reads delays in seconds', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('reads HTTP dates', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(parseRetryAfter('Sun, 11 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Sun, 11 Oct 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('ignores missing or invalid values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('fetchWithRetry', () => {
  it('retries 429 and 5xx but not other statuses', () => {
    expect([429, 500, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 409, 413].some(isRetryableStatus)).toBe(false);
  });

  it('returns a non-retryable response at once', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response('nope', { status: 404 }));
    const response = await fetchWithRetry('https://example.com/x', { method: 'POST' }, { fetch, sleep: noSleep });
    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps a huge Retry-After at 5 minutes', async () => {
    const sleep = vi.fn(noSleep);
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '86400' } }))
      .mockResolvedValueOnce(new Response('ok'));
    await fetchWithRetry('https://example.com/x', {}, { fetch, sleep });
    expect(sleep.mock.calls).toEqual([[300_000]]);
  });

  it('rejects with the network error after the last attempt', async () => {
    const sleep = vi.fn(noSleep);
    const fetch = vi.fn<Fetch>(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND example.com') });
    });
    await expect(fetchWithRetry('https://example.com/x?secret=no', {}, { fetch, sleep, attempts: 3 })).rejects.toThrow(
      'Request to example.com/x failed after 3 attempts: fetch failed (getaddrinfo ENOTFOUND example.com)',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('passes a timeout signal to every attempt', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response('ok'));
    await fetchWithRetry('https://example.com/x', { method: 'GET' }, { fetch });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('errorMessage', () => {
  it('includes the cause of "fetch failed"', () => {
    expect(errorMessage(new TypeError('fetch failed', { cause: new Error('ECONNRESET') }))).toBe(
      'fetch failed (ECONNRESET)',
    );
    expect(errorMessage('plain')).toBe('plain');
  });
});
