import type { AgentEvent } from '@bohr/shared';
import { type Logger, silentLogger } from './log';
import { errorMessage } from './text';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the log numbers and timestamps it. */
export type EventInput = DistributiveOmit<AgentEvent, 'seq' | 'at'>;

export type EventListener = (event: AgentEvent) => void;

/** Numbers every event (seq is global across jobs and starts at 1) and keeps the most recent ones. */
export class EventLog {
  private readonly events: AgentEvent[] = [];
  private readonly listeners = new Set<EventListener>();
  private seq = 0;

  constructor(
    private readonly capacity = 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get lastSeq(): number {
    return this.seq;
  }

  emit(input: EventInput): AgentEvent {
    this.seq += 1;
    const event = { ...input, seq: this.seq, at: this.now().toISOString() } as AgentEvent;
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Buffered events with a seq greater than `seq`, oldest first. */
  after(seq: number): AgentEvent[] {
    return this.events.filter((event) => event.seq > seq);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface EventPusherOptions {
  url: string;
  fetch?: typeof fetch;
  /** Wait before sending, so events that arrive close together go in one request. */
  intervalMs?: number;
  maxBatch?: number;
  /** Older undelivered events are dropped beyond this; the project Worker can still read them from GET /events. */
  maxPending?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  timeoutMs?: number;
  log?: Logger;
}

type Delivery = 'delivered' | 'refused' | 'retry';

/**
 * Delivers events to the project Worker in order, one request at a time. Failed batches stay queued and are
 * retried with exponential backoff, so a slow or absent receiver never holds up the job that produced them.
 */
export class EventPusher {
  private pending: AgentEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<boolean> | undefined;
  private failures = 0;
  private stopped = false;
  private readonly fetch: typeof fetch;
  private readonly intervalMs: number;
  private readonly maxBatch: number;
  private readonly maxPending: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly log: Logger;

  constructor(private readonly options: EventPusherOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.intervalMs = options.intervalMs ?? 500;
    this.maxBatch = options.maxBatch ?? 100;
    this.maxPending = options.maxPending ?? 1000;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.log = options.log ?? silentLogger;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  push(event: AgentEvent): void {
    if (this.stopped) return;
    this.pending.push(event);
    if (this.pending.length > this.maxPending) {
      const dropped = this.pending.splice(0, this.pending.length - this.maxPending);
      this.log.warn('dropped undelivered events', { count: dropped.length, upToSeq: dropped.at(-1)?.seq });
    }
    this.schedule(this.nextDelayMs(true));
  }

  /** Sends what is pending now, retrying until it is delivered or `timeoutMs` passes. */
  async flush(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.length > 0 && Date.now() < deadline) {
      clearTimeout(this.timer);
      this.timer = undefined;
      const delivered = await withDeadline(this.send(), deadline);
      if (delivered === false) await withDeadline(sleep(250), deadline);
    }
    this.schedule(this.nextDelayMs(this.failures === 0));
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number): void {
    if (this.timer || this.inFlight || this.stopped || this.pending.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.send().then((delivered) => this.schedule(this.nextDelayMs(delivered)));
    }, delayMs);
    this.timer.unref?.();
  }

  private nextDelayMs(lastDelivered: boolean): number {
    if (!lastDelivered) return Math.min(this.initialBackoffMs * 2 ** Math.max(0, this.failures - 1), this.maxBackoffMs);
    return this.pending.length >= this.maxBatch ? 0 : this.intervalMs;
  }

  /** Resolves true when the oldest batch left the queue (delivered, or refused for good). */
  private send(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    const batch = this.pending.slice(0, this.maxBatch);
    const last = batch.at(-1);
    if (!last) return Promise.resolve(true);
    // The promise settles after `finally` ran, so whoever awaits it sees inFlight cleared.
    this.inFlight = this.post(batch)
      .then((delivery) => {
        if (delivery === 'retry') {
          this.failures += 1;
          return false;
        }
        this.failures = 0;
        this.pending = this.pending.filter((event) => event.seq > last.seq);
        return true;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async post(events: AgentEvent[]): Promise<Delivery> {
    const range = { fromSeq: events[0]?.seq, toSeq: events.at(-1)?.seq };
    try {
      const response = await this.fetch(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return 'delivered';
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        this.log.warn('event delivery failed; will retry', { ...range, status: response.status });
        return 'retry';
      }
      // The same payload cannot succeed later; the receiver can still read these events from GET /events.
      this.log.error('event batch refused', { ...range, status: response.status });
      return 'refused';
    } catch (error) {
      this.log.warn('event delivery failed; will retry', { ...range, error: errorMessage(error) });
      return 'retry';
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with the promise's value, or undefined once the deadline passes. */
async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
