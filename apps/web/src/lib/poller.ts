// Runs a task again and again with setTimeout, one run at a time. The delay is read after every run,
// so callers can poll faster while something is happening.

export interface Poller {
  /** Starts polling: runs now, or after the first delay when `immediately` is false. */
  start(immediately?: boolean): void;
  stop(): void;
  /** Runs now (or right after the run in progress) and resolves when that run is done. */
  trigger(): Promise<void>;
  /** Re-reads the delay, e.g. when the page becomes visible. */
  reschedule(): void;
  readonly active: boolean;
}

export function createPoller(task: () => Promise<void>, delay: () => number): Poller {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let again = false;

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (active) timer = setTimeout(() => void run(), delay());
  }

  function run(): Promise<void> {
    if (inFlight !== null) {
      again = true;
      return inFlight;
    }
    clearTimeout(timer);
    inFlight = (async () => {
      try {
        await task();
      } catch {
        // The task records its own errors; polling goes on.
      }
      inFlight = null;
      if (again) {
        again = false;
        await run();
      } else {
        schedule();
      }
    })();
    return inFlight;
  }

  return {
    start(immediately = true) {
      if (active) return;
      active = true;
      if (immediately) void run();
      else if (inFlight === null) schedule();
    },
    stop() {
      active = false;
      again = false;
      clearTimeout(timer);
      timer = undefined;
    },
    trigger: run,
    reschedule() {
      if (inFlight === null) schedule();
    },
    get active() {
      return active;
    },
  };
}
