import { type AgentEvent, agentEventBatchSchema } from '@bohr/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventLog, EventPusher } from '../src/events';
import { waitFor } from './helpers';

const progress = (text: string) => ({ type: 'job.progress' as const, jobId: 'req_0123456789', text });

describe('EventLog', () => {
  it('numbers events from 1 and timestamps them', () => {
    const log = new EventLog(1000, () => new Date('2026-10-11T12:00:00.000Z'));
    expect(log.lastSeq).toBe(0);
    const first = log.emit(progress('a'));
    const second = log.emit({ type: 'preview.status', status: 'running', port: 8080 });
    expect(first).toEqual({ ...progress('a'), seq: 1, at: '2026-10-11T12:00:00.000Z' });
    expect(second.seq).toBe(2);
    expect(log.lastSeq).toBe(2);
    expect(agentEventBatchSchema.safeParse({ events: [first, second] }).success).toBe(true);
  });

  it('returns the events after a seq and forgets the oldest beyond its capacity', () => {
    const log = new EventLog(3);
    for (const text of ['a', 'b', 'c', 'd', 'e']) log.emit(progress(text));
    expect(log.after(0).map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(log.after(4).map((event) => event.seq)).toEqual([5]);
    expect(log.after(5)).toEqual([]);
    expect(log.lastSeq).toBe(5);
  });

  it('tells subscribers about every event until they unsubscribe', () => {
    const log = new EventLog();
    const seen: number[] = [];
    const unsubscribe = log.subscribe((event) => seen.push(event.seq));
    log.emit(progress('a'));
    unsubscribe();
    log.emit(progress('b'));
    expect(seen).toEqual([1]);
  });
});

/** A receiver that records the batches it accepted; `respond` decides each answer. */
function receiver(
  respond: (attempt: number) => Response | Promise<Response> = () => new Response(null, { status: 204 }),
) {
  const batches: AgentEvent[][] = [];
  let attempts = 0;
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    attempts += 1;
    const response = await respond(attempts);
    if (response.ok) {
      const batch = agentEventBatchSchema.parse(JSON.parse(String(init?.body)));
      batches.push(batch.events as AgentEvent[]);
    }
    return response;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, batches, calls: fetch };
}

describe('EventPusher', () => {
  it('sends events that arrive close together in one batch', async () => {
    const { fetch, batches, calls } = receiver();
    const log = new EventLog();
    const pusher = new EventPusher({ url: 'http://bohr.internal/v1/agent/events', fetch, intervalMs: 30 });
    log.subscribe((event) => pusher.push(event));
    log.emit(progress('a'));
    log.emit(progress('b'));
    log.emit(progress('c'));
    await waitFor(() => batches.length === 1, 5000, 'the batch');
    expect(batches[0]?.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(calls.mock.calls[0]?.[0]).toBe('http://bohr.internal/v1/agent/events');
    expect(calls.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(pusher.pendingCount).toBe(0);
  });

  it('splits large backlogs into batches of at most 100, in order', async () => {
    const { fetch, batches } = receiver();
    const log = new EventLog();
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 10 });
    log.subscribe((event) => pusher.push(event));
    for (let index = 0; index < 250; index++) log.emit(progress(`line ${index}`));
    await waitFor(() => batches.flat().length === 250, 5000, 'all events');
    expect(batches.every((batch) => batch.length <= 100)).toBe(true);
    expect(batches.flat().map((event) => event.seq)).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
  });

  it('keeps failed batches and retries them with backoff, without losing order', async () => {
    const { fetch, batches, calls } = receiver((attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      if (attempt === 2) return new Response('busy', { status: 503 });
      return new Response(null, { status: 204 });
    });
    const log = new EventLog();
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 5, initialBackoffMs: 20 });
    log.subscribe((event) => pusher.push(event));
    const started = Date.now();
    log.emit(progress('a'));
    await waitFor(() => calls.mock.calls.length >= 1, 5000, 'the first attempt');
    log.emit(progress('b'));
    await waitFor(() => batches.length > 0 && pusher.pendingCount === 0, 5000, 'delivery');
    // Two failures: waits of 20 ms and 40 ms before the attempt that worked.
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(batches.flat().map((event) => event.seq)).toEqual([1, 2]);
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it('caps the wait between retries', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const attempts: number[] = [];
      const { fetch } = receiver(() => {
        attempts.push(Date.now() - start);
        return new Response('down', { status: 502 });
      });
      const pusher = new EventPusher({
        url: 'http://x/events',
        fetch,
        intervalMs: 1,
        initialBackoffMs: 10,
        maxBackoffMs: 40,
      });
      pusher.push({ ...progress('a'), seq: 1, at: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(1 + 10 + 20 + 40 + 40 + 40);
      pusher.stop();
      // The first try after the batching interval, then waits of 10, 20 and 40 ms, and 40 ms from then on.
      expect(attempts).toEqual([1, 11, 31, 71, 111, 151]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a batch the receiver refuses and carries on with the next', async () => {
    const { fetch, batches } = receiver((attempt) =>
      attempt === 1 ? new Response('bad', { status: 400 }) : new Response(null, { status: 200 }),
    );
    const log = new EventLog();
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 5 });
    log.subscribe((event) => pusher.push(event));
    log.emit(progress('refused'));
    await waitFor(() => pusher.pendingCount === 0, 5000, 'the refusal');
    log.emit(progress('accepted'));
    await waitFor(() => batches.length === 1, 5000, 'the next batch');
    expect(batches[0]?.map((event) => event.seq)).toEqual([2]);
  });

  it('flushes what is pending on demand', async () => {
    const { fetch, batches } = receiver();
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 60_000 });
    pusher.push({ ...progress('a'), seq: 1, at: new Date().toISOString() });
    await pusher.flush(2000);
    expect(batches.flat().map((event) => event.seq)).toEqual([1]);
  });

  it('gives up flushing at the deadline when the receiver is down', async () => {
    const { fetch } = receiver(() => new Response('down', { status: 503 }));
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 60_000 });
    pusher.push({ ...progress('a'), seq: 1, at: new Date().toISOString() });
    const started = Date.now();
    await pusher.flush(300);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(pusher.pendingCount).toBe(1);
    pusher.stop();
  });

  it('keeps at most maxPending undelivered events', async () => {
    const { fetch } = receiver(() => new Response('down', { status: 503 }));
    const pusher = new EventPusher({ url: 'http://x/events', fetch, intervalMs: 60_000, maxPending: 5 });
    for (let seq = 1; seq <= 8; seq++) pusher.push({ ...progress(String(seq)), seq, at: new Date().toISOString() });
    expect(pusher.pendingCount).toBe(5);
    pusher.stop();
  });
});
