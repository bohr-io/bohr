import { type ContainerHost, cloudflareContainer } from './container';
import type { Env } from './env';
import { githubRepo, type RepoApi } from './repo';

/** External effects of the project Worker, swapped for fakes in tests. */
export const deps = {
  fetch: ((input, init) => fetch(input, init)) as typeof fetch,
  container: (ctx: DurableObjectState, env: Env): ContainerHost => cloudflareContainer(ctx, env),
  repo: (env: Env): RepoApi => githubRepo(env, deps.fetch),
  now: () => new Date(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  /** When an alarm set `delayMs` from now should fire; tests push it out of reach and fire alarms by hand. */
  alarmAt: (delayMs: number) => Date.now() + delayMs,
  /** Ends this Durable Object's instance: the next request starts it again on the Worker's current code. */
  restartObject: (ctx: DurableObjectState) => ctx.abort('bohr: runtime update'),
};
