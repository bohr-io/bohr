import { env as testEnv } from 'cloudflare:workers';
import { expect } from 'vitest';
import worker from '../src/index';
import type { RouteRecord } from '../src/routes';

export type FakeWorker = (request: Request) => Response | Promise<Response>;

export interface FakeDispatcher {
  namespace: DispatchNamespace;
  /** Requests that reached a customer Worker, with the script name. */
  calls: { script: string; request: Request }[];
}

/**
 * Stands in for the Workers for Platforms namespace, which Miniflare does not
 * simulate. Unknown scripts throw like the real binding does.
 */
export function fakeDispatcher(workers: Record<string, FakeWorker> = {}): FakeDispatcher {
  const scripts = new Map(Object.entries(workers));
  const calls: FakeDispatcher['calls'] = [];
  const namespace = {
    get(script: string) {
      const handler = scripts.get(script);
      if (handler === undefined) throw new Error('Worker not found.');
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const request = new Request(input, init);
          calls.push({ script, request });
          return handler(request);
        },
      };
    },
  };
  return { namespace: namespace as unknown as DispatchNamespace, calls };
}

/** A customer Worker that answers with its script name and the request path. */
export const echo =
  (script: string): FakeWorker =>
  (request) => {
    const url = new URL(request.url);
    return new Response(`${script} ${request.method} ${url.pathname}${url.search}`);
  };

/** The test env from cloudflare:workers with a fake dispatch namespace. */
export function makeEnv(dispatcher: FakeDispatcher, routes: KVNamespace = testEnv.ROUTES): Env {
  return { ...testEnv, ROUTES: routes, DISPATCHER: dispatcher.namespace };
}

/** KV wrapper that records which keys were read. */
export function recordingKv(): { kv: KVNamespace; reads: string[] } {
  const reads: string[] = [];
  const kv = {
    get(key: string) {
      reads.push(key);
      return testEnv.ROUTES.get(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, reads };
}

export function call(env: Env, url: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(url, init), env);
}

let counter = 0;
/** Unique DNS label, so module-level caches never leak between tests. */
export function uniqueLabel(prefix = 't'): string {
  counter += 1;
  return `${prefix}${counter}x${crypto.randomUUID().slice(0, 8)}`;
}

export const SCRIPT = 'p3k9x0a7qd2m-main';

export function route(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return { v: 1, projectId: 'p3k9x0a7qd2m', script: SCRIPT, suspended: false, ...overrides };
}

export async function putRoute(key: string, value: RouteRecord | string): Promise<void> {
  await testEnv.ROUTES.put(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function basicHeader(username: string, password: string): string {
  return `Basic ${toBase64(new TextEncoder().encode(`${username}:${password}`))}`;
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
}
