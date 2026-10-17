// Test helpers: the app's i18n and router on an in-memory history, and a fake instance API behind a
// stubbed fetch. No network.
import type { ChatEntry, ProjectState } from '@bohr/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import type { Onboarding, ProjectSummary } from './api';
import { createWebI18n } from './i18n';
import type { LocaleCode } from './i18n/locales';
import { authGuard, routes } from './router';

/** i18n like main.ts; missing keys are collected instead of silently falling back. */
export function createTestI18n(locale: LocaleCode = 'pt-BR') {
  const missing: string[] = [];
  const i18n = createWebI18n(locale);
  i18n.global.setMissingHandler((missingLocale, key) => {
    missing.push(`${missingLocale}:${key}`);
    return key;
  });
  return { i18n, missing };
}

/** Router, i18n and the auth guard wired like main.ts, already at `path`. */
export async function createTestContext(path: string) {
  const { i18n, missing } = createTestI18n();
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach(authGuard);
  await router.push(path);
  await router.isReady();
  return { i18n, router, missing, plugins: [router, i18n] as const };
}

/** The app's pages as App.vue shows them (a RouterView), at `path`. */
export async function mountAt(path: string) {
  const context = await createTestContext(path);
  const Root = defineComponent({ render: () => h(RouterView) });
  const wrapper = mount(Root, { global: { plugins: [...context.plugins] }, attachTo: document.body });
  await flushPromises();
  await flushPromises();
  return { ...context, wrapper };
}

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  /** Parsed JSON body, or undefined without one. */
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
}

export type FakeRoute = FakeReply | ((call: ApiCall) => FakeReply);

/**
 * Stubs fetch with routes keyed "METHOD /path". A list of replies is used in order, the last one
 * repeating. Unknown routes answer 404, like the instance.
 */
export function fakeApi(routes: Record<string, FakeRoute | FakeRoute[]>) {
  const calls: ApiCall[] = [];
  const used = new Map<string, number>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://bohr.test');
    const method = init?.method ?? 'GET';
    const call: ApiCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = `${method} ${url.pathname}`;
    const entry = routes[key];
    if (entry === undefined) return json(404, { error: `No fake for ${key}.` });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const route = list[Math.min(index, list.length - 1)] as FakeRoute;
    const reply = typeof route === 'function' ? route(call) : route;
    return json(reply.status ?? 200, reply.body ?? null);
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    calls,
    /** Calls to "METHOD /path". */
    callsTo: (key: string) => calls.filter((call) => `${call.method} ${call.path}` === key),
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Fixtures

/** GET /api/me as the instance answers it: the role at the top level and, for older clients, in user. */
export const ME = {
  user: { id: 'u_1', name: 'Ana Lima', email: 'ana@example.com', role: 'user' },
  identities: [{ provider: 'github', username: 'ana' }],
  role: 'user',
};

/** ME as an instance admin. */
export const ADMIN = { ...ME, user: { ...ME.user, role: 'admin' }, role: 'admin' };

export function projectSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    name: 'Loja',
    repository: 'acme/loja',
    status: 'active',
    mode: 'byo',
    role: 'owner',
    productionUrl: 'https://loja.example.com',
    runtime: { status: 'ready', previewUrl: 'https://loja-preview.example.dev', botUsername: 'loja_bot' },
    org: null,
    ...overrides,
  };
}

export function onboarding(overrides: Partial<Onboarding> = {}): Onboarding {
  return {
    step: 'cloudflare',
    cloudflare: { connections: [], tokenTemplateUrl: 'https://dash.cloudflare.com/profile/api-tokens?template' },
    github: { installUrl: 'https://github.com/apps/bohr-test/installations/new?state=abc' },
    pendingAccounts: [],
    telegram: { username: 'bohr_platform_bot', canManageBots: true },
    billing: { enabled: false, subscribed: false },
    agent: { configured: true },
    ...overrides,
  };
}

export function projectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    project: {
      id: 'p1',
      name: 'Loja',
      repository: 'acme/loja',
      productionBranch: 'main',
      productionUrl: 'https://loja.example.com',
      previewUrl: 'https://loja-preview.example.workers.dev',
      agentEnabled: true,
    },
    you: { key: 'u:u_1', role: 'owner' },
    homolog: { status: 'clean', version: 0, headSha: null, changes: [] },
    current: null,
    queue: [],
    releases: [],
    settings: { model: 'claude-opus-5-5', maxBudgetUsd: 5, maxTurns: 200, locale: 'pt-BR' },
    ...overrides,
  };
}

export function chatEntry(seq: number, overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    seq,
    at: '2026-10-11T12:00:00.000Z',
    kind: 'agent',
    requestId: null,
    author: null,
    text: `Mensagem ${seq}`,
    actions: [],
    options: [],
    ...overrides,
  };
}

/** A conversation the fake GET /messages serves like the runtime: seq > after, up to limit, plus `last`. */
export function conversation(initial: ChatEntry[] = []) {
  const entries = [...initial];
  return {
    entries,
    add(entry: ChatEntry) {
      entries.push(entry);
    },
    route: (call: ApiCall): FakeReply => {
      const after = Number(call.query.get('after') ?? 0);
      const limit = Number(call.query.get('limit') ?? 100);
      return {
        body: {
          messages: entries.filter((entry) => entry.seq > after).slice(0, limit),
          last: entries.reduce((max, entry) => Math.max(max, entry.seq), 0),
        },
      };
    },
  };
}
