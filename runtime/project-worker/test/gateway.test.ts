import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { verifyBrokerRequest } from '@bohr/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearTokenCache } from '../src/broker';
import { deps } from '../src/deps';
import { anthropic, github, internal } from '../src/gateway';
import type { Project } from '../src/project';

let outbound: Request[] = [];
let brokerCalls = 0;

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const encoder = new TextEncoder();

// A git-receive-pack body: pkt-lines with the ref updates, a flush packet, then (fake) pack data
function pushBody(lines: string[]): Uint8Array {
  const packets = lines.map((line, index) => {
    const text = `${index === 0 ? `${line}\0report-status side-band-64k` : line}\n`;
    return `${(encoder.encode(text).length + 4).toString(16).padStart(4, '0')}${text}`;
  });
  return encoder.encode(`${packets.join('')}0000PACK-fake-pack-data`);
}

async function setRunning(running: boolean) {
  await runInDurableObject(env.PROJECT.getByName(env.PROJECT_ID), (project: Project) => {
    project.store.updateRequest('req_gateway_test', { status: running ? 'running' : 'succeeded' });
    if (project.store.request('req_gateway_test') === null) {
      project.store.insertRequest({
        id: 'req_gateway_test',
        kind: 'change',
        status: running ? 'running' : 'succeeded',
        text: 'test',
        author_key: 'tg:1001',
        author_name: 'Ana',
        source: 'web',
        chat_id: null,
        progress_message_id: null,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        summary: null,
        cost_usd: null,
        session_id: null,
        resume_session_id: null,
        head_sha: null,
        question: null,
        error: null,
        progress: null,
        cycle: 1,
        allow_workflow_edits: 0,
        auth: null,
      });
    }
  });
}

beforeEach(() => {
  outbound = [];
  brokerCalls = 0;
  clearTokenCache();
  deps.sleep = async () => {};
  deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === 'https://bohr.example.com/api/runtime/v1/github-token') {
      brokerCalls++;
      const body = await request.text();
      const valid = await verifyBrokerRequest(env.PROJECT_SECRET, request.headers, {
        method: 'POST',
        path: '/api/runtime/v1/github-token',
        body,
      });
      if (!valid) return new Response('bad signature', { status: 401 });
      return Response.json({
        token: 'ghs_test_token',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        repository: 'acme/store',
      });
    }
    outbound.push(request);
    return new Response('upstream');
  }) as typeof fetch;
});

describe('gateway', () => {
  it('swaps the placeholder for the real Anthropic key, and only for the API', async () => {
    await setRunning(true);
    const response = await anthropic(
      new Request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': 'sk-ant-bohr-placeholder',
          authorization: 'Bearer stolen',
          'anthropic-version': '2023-06-01',
        },
        body: '{"model":"claude-opus-5-5"}',
      }),
      env,
    );
    expect(await response.text()).toBe('upstream');
    expect(outbound[0]?.headers.get('x-api-key')).toBe('sk-ant-real-key-for-tests');
    expect(outbound[0]?.headers.has('authorization')).toBe(false);
    expect(outbound[0]?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(await outbound[0]?.text()).toBe('{"model":"claude-opus-5-5"}');

    expect((await anthropic(new Request('https://api.anthropic.com/admin'), env)).status).toBe(403);
    expect((await anthropic(new Request('https://api.anthropic.com/v1/files'), env)).status).toBe(403);
    const batch = new Request('https://api.anthropic.com/v1/messages/batches', { method: 'POST', body: '{}' });
    expect((await anthropic(batch, env)).status).toBe(403);
    expect((await anthropic(new Request('https://api.anthropic.com/v1/messages'), env)).status).toBe(403);
    expect((await anthropic(new Request('https://api.anthropic.com/v1/models'), env)).status).toBe(200);
    expect(outbound.at(-1)?.redirect).toBe('manual');
    expect((await anthropic(new Request('https://example.com/v1/messages'), env)).status).toBe(403);
    expect(
      (
        await anthropic(new Request('https://api.anthropic.com/v1/messages', { method: 'POST' }), {
          ...env,
          ANTHROPIC_API_KEY: '',
        })
      ).status,
    ).toBe(401);
  });

  it("sends the agent to the owner's compatible endpoint, with its key in both headers", async () => {
    await setRunning(true);
    const compatible = { ...env, AGENT_BASE_URL: 'https://llm.example.com/anthropic' };
    const post = (url: string) =>
      anthropic(new Request(url, { method: 'POST', headers: { 'x-api-key': 'sk-ant-bohr-placeholder' } }), compatible);
    expect(await (await post('https://llm.example.com/anthropic/v1/messages')).text()).toBe('upstream');
    expect(outbound[0]?.headers.get('x-api-key')).toBe('sk-ant-real-key-for-tests');
    expect(outbound[0]?.headers.get('authorization')).toBe('Bearer sk-ant-real-key-for-tests');
    // Outside its path prefix, on another host or on Anthropic's own API: refused
    expect((await post('https://llm.example.com/v1/messages')).status).toBe(403);
    expect((await post('https://llm.example.com/anthropic/v1/messages/batches')).status).toBe(403);
    expect((await post('https://api.anthropic.com/v1/messages')).status).toBe(403);
    expect(outbound).toHaveLength(1);
  });

  it("sends the owner's Claude subscription token as a bearer token, to the API and read-only account routes", async () => {
    await setRunning(true);
    const subscription = { ...env, AGENT_PROVIDER: 'subscription' as const, ANTHROPIC_API_KEY: 'sk-ant-oat01-real' };
    const response = await anthropic(
      new Request('https://api.anthropic.com/v1/messages?beta=true', {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-ant-oat01-bohr-placeholder',
          'x-api-key': 'sk-ant-bohr-placeholder',
          'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219',
          'anthropic-version': '2023-06-01',
        },
        body: '{}',
      }),
      subscription,
    );
    expect(await response.text()).toBe('upstream');
    expect(outbound[0]?.headers.get('authorization')).toBe('Bearer sk-ant-oat01-real');
    expect(outbound[0]?.headers.has('x-api-key')).toBe(false);
    expect(outbound[0]?.headers.get('anthropic-beta')).toBe('oauth-2025-04-20,claude-code-20250219');
    expect(outbound[0]?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(outbound[0]?.redirect).toBe('manual');

    const send = (path: string, method = 'GET') =>
      anthropic(new Request(`https://api.anthropic.com${path}`, { method }), subscription);
    for (const path of ['/api/oauth/profile', '/api/oauth/usage', '/api/claude_cli/bootstrap', '/v1/models']) {
      expect((await send(path)).status).toBe(200);
    }
    // Minting keys, uploads, organizations, metrics and writes stay out of reach
    expect((await send('/api/oauth/claude_cli/create_api_key', 'POST')).status).toBe(403);
    expect((await send('/api/oauth/file_upload', 'POST')).status).toBe(403);
    expect((await send('/api/oauth/organizations/org-1/code/repos/resync', 'POST')).status).toBe(403);
    expect((await send('/api/claude_code/metrics', 'POST')).status).toBe(403);
    expect((await send('/api/oauth/account/settings', 'POST')).status).toBe(403);
    expect((await send('/v1/files')).status).toBe(403);
    // The subscription only works with Anthropic, whatever base URL is left over
    const leftover = { ...subscription, AGENT_BASE_URL: 'https://llm.example.com/anthropic' };
    const elsewhere = new Request('https://llm.example.com/anthropic/v1/messages', { method: 'POST' });
    expect((await anthropic(elsewhere, leftover)).status).toBe(403);
    // Account routes are not open to API keys
    expect((await anthropic(new Request('https://api.anthropic.com/api/oauth/profile'), env)).status).toBe(403);
    expect(outbound).toHaveLength(5);

    await setRunning(false);
    expect((await send('/api/oauth/profile')).status).toBe(403);
    expect(outbound).toHaveLength(5);
  });

  it('keeps the Anthropic key away from the sandbox while no request runs', async () => {
    await setRunning(false);
    const response = await anthropic(new Request('https://api.anthropic.com/v1/messages', { method: 'POST' }), env);
    expect(response.status).toBe(403);
    expect(outbound).toHaveLength(0);
  });

  it('sends git requests again when GitHub answers 429 or 5xx, the same bytes, then gives up after 4 tries', async () => {
    await setRunning(true);
    const sleeps: number[] = [];
    deps.sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    const upstream = deps.fetch;
    const answers = [429, 503, 200];
    const bodies: string[] = [];
    deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.includes('/api/runtime/v1/github-token')) return upstream(input, init);
      bodies.push(await request.text());
      const status = answers.shift() ?? 429;
      return new Response('x', { status, headers: status === 429 ? { 'retry-after': '3' } : {} });
    }) as typeof fetch;

    const push = await github(
      new Request('https://github.com/acme/store.git/git-receive-pack', {
        method: 'POST',
        body: pushBody([`${OLD} ${NEW} refs/heads/homolog`]),
      }),
      env,
    );
    expect(push.status).toBe(200);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('PACK-fake-pack-data');
    // Retry-After when GitHub says it, else exponential
    expect(sleeps).toEqual([3000, 2000]);

    const limited = await github(
      new Request('https://github.com/acme/store.git/info/refs?service=git-upload-pack'),
      env,
    );
    expect(limited.status).toBe(429);
    expect(bodies).toHaveLength(7);
  });

  it('adds a repository token to git traffic for the project repository only', async () => {
    await setRunning(true);
    await github(new Request('https://github.com/acme/store.git/info/refs?service=git-upload-pack'), env);
    await github(
      new Request('https://github.com/ACME/Store.git/git-receive-pack', {
        method: 'POST',
        body: pushBody([`${OLD} ${NEW} refs/heads/homolog`]),
      }),
      env,
    );
    await github(
      new Request('https://github.com/someone/else.git/info/refs', { headers: { authorization: 'Basic eDp5' } }),
      env,
    );
    expect(outbound.map((request) => request.headers.get('authorization'))).toEqual([
      `Basic ${btoa('x-access-token:ghs_test_token')}`,
      `Basic ${btoa('x-access-token:ghs_test_token')}`,
      null,
    ]);
    expect(brokerCalls).toBe(1);
    expect((await github(new Request('http://github.com/acme/store.git/info/refs'), env)).status).toBe(403);
  });

  it('lets the sandbox push the work branch only, with the push body intact', async () => {
    await setRunning(true);
    const push = (lines: string[]) =>
      github(
        new Request('https://github.com/acme/store.git/git-receive-pack', { method: 'POST', body: pushBody(lines) }),
        env,
      );

    expect((await push([`${OLD} ${NEW} refs/heads/homolog`])).status).toBe(200);
    expect(new Uint8Array(await (outbound.at(-1)?.arrayBuffer() ?? new ArrayBuffer(0)))).toEqual(
      pushBody([`${OLD} ${NEW} refs/heads/homolog`]),
    );
    expect((await push([`${OLD} ${NEW} refs/heads/main`])).status).toBe(403);
    expect((await push([`${OLD} ${NEW} refs/heads/homolog`, `${OLD} ${NEW} refs/tags/v1`])).status).toBe(403);
    expect((await push([`${NEW} ${'0'.repeat(40)} refs/heads/homolog`])).status).toBe(403);
    const malformed = await github(
      new Request('https://github.com/acme/store.git/git-receive-pack', { method: 'POST', body: 'zzzz' }),
      env,
    );
    expect(malformed.status).toBe(400);
    expect(outbound).toHaveLength(1);
  });

  it('refuses pushes while no request runs, and still lets the preview fetch', async () => {
    await setRunning(false);
    const push = await github(
      new Request('https://github.com/acme/store.git/git-receive-pack', {
        method: 'POST',
        body: pushBody([`${OLD} ${NEW} refs/heads/homolog`]),
      }),
      env,
    );
    expect(push.status).toBe(403);
    const advertise = await github(
      new Request('https://github.com/acme/store.git/info/refs?service=git-receive-pack'),
      env,
    );
    expect(advertise.status).toBe(403);
    const fetchRefs = await github(
      new Request('https://github.com/acme/store.git/info/refs?service=git-upload-pack'),
      env,
    );
    expect(fetchRefs.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.redirect).toBe('manual');
  });

  it('forwards agent events to the project and rejects anything else', async () => {
    const at = new Date().toISOString();
    const response = await internal(
      new Request('http://bohr.internal/v1/agent/events', {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'preview.status', seq: 1, at, status: 'running', port: 5173 }] }),
      }),
      env,
    );
    expect(response.status).toBe(204);
    await runInDurableObject(env.PROJECT.getByName(env.PROJECT_ID), (project: Project) => {
      expect(project.store.get('preview_port')).toBe('5173');
    });
    const invalid = await internal(
      new Request('http://bohr.internal/v1/agent/events', { method: 'POST', body: '{"events":[{"type":"nope"}]}' }),
      env,
    );
    expect(invalid.status).toBe(400);
    expect((await internal(new Request('http://bohr.internal/other'), env)).status).toBe(404);
  });
});
