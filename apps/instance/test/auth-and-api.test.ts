import { beforeEach, describe, expect, it } from 'vitest';
import { deps } from '../src/deps';
import type { FakeCloudflare } from './fake-cloudflare';
import { baseMetadata, call, finalize, importProject, resetStorage, startSession, useFakes } from './helpers';

let cloudflare: FakeCloudflare;

// Answers GitHub's token exchange and profile endpoints for the given account
function fakeGithub(profile: { id: number; login: string }) {
  deps.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_test' });
    if (url === 'https://api.github.com/user') return Response.json({ ...profile, name: null, email: null });
    return new Response('unexpected', { status: 500 });
  };
}

// Runs the OAuth round trip and returns the session cookie
async function signIn(profile: { id: number; login: string }) {
  fakeGithub(profile);
  const start = await call('/auth/github?redirect=/projects');
  expect(start.status).toBe(302);
  const location = new URL(start.headers.get('Location') ?? '');
  expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
  const state = location.searchParams.get('state') ?? '';
  const stateCookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

  const callback = await call(`/auth/github/callback?code=abc&state=${state}`, { headers: { Cookie: stateCookie } });
  expect(callback.status).toBe(302);
  expect(callback.headers.get('Location')).toBe('/projects');
  const sessionCookie = callback.headers.getSetCookie().find((cookie) => cookie.startsWith('__Host-bohr_session='));
  expect(sessionCookie).toContain('HttpOnly');
  return (sessionCookie ?? '').split(';')[0] ?? '';
}

beforeEach(async () => {
  await resetStorage();
  cloudflare = useFakes();
  cloudflare.zones.set('example.com', 'zone-example');
});

describe('GitHub sign-in', () => {
  it('refuses a callback whose state does not match the cookie', async () => {
    fakeGithub({ id: 1001, login: 'alice' });
    const start = await call('/auth/github');
    const stateCookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const callback = await call('/auth/github/callback?code=abc&state=forged', { headers: { Cookie: stateCookie } });
    expect(callback.status).toBe(401);
  });

  it('ignores redirects to other origins', async () => {
    fakeGithub({ id: 1001, login: 'alice' });
    const start = await call('/auth/github?redirect=//evil.example/');
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
    const stateCookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const callback = await call(`/auth/github/callback?code=abc&state=${state}`, { headers: { Cookie: stateCookie } });
    expect(callback.headers.get('Location')).toBe('/');
  });

  it('links an imported account and lists its projects', async () => {
    const { project } = await importProject();
    const cookie = await signIn({ id: 1001, login: 'alice' });

    const me = (await (await call('/api/me', { headers: { Cookie: cookie } })).json()) as {
      identities: { username: string }[];
    };
    expect(me.identities).toEqual([{ provider: 'github', username: 'alice' }]);

    const list = (await (await call('/api/projects', { headers: { Cookie: cookie } })).json()) as {
      projects: { id: string; role: string; productionUrl: string }[];
    };
    expect(list.projects).toEqual([
      expect.objectContaining({ id: project?.projectId, role: 'owner', productionUrl: 'https://store.example.com' }),
    ]);

    const logout = await call('/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(logout.status).toBe(204);
    expect((await call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

describe('project API', () => {
  it('lets only the owner change variables, and only with JSON', async () => {
    const { project } = await importProject();
    const owner = await signIn({ id: 1001, login: 'alice' });
    const member = await signIn({ id: 1002, login: 'bob' });
    const path = `/api/projects/${project?.projectId}/env`;
    const body = JSON.stringify({ key: 'GREETING', value: 'hello', isSecret: false });

    const form = await call(path, { method: 'PUT', headers: { Cookie: owner, 'Content-Type': 'text/plain' }, body });
    expect(form.status).toBe(415);

    const asMember = await call(path, {
      method: 'PUT',
      headers: { Cookie: member, 'Content-Type': 'application/json' },
      body,
    });
    expect(asMember.status).toBe(403);

    const asOwner = await call(path, {
      method: 'PUT',
      headers: { Cookie: owner, 'Content-Type': 'application/json' },
      body,
    });
    expect(asOwner.status).toBe(200);

    const detail = (await (
      await call(`/api/projects/${project?.projectId}`, { headers: { Cookie: member } })
    ).json()) as {
      envVars: { key: string; value: string | null; isSecret: boolean }[];
    };
    expect(detail.envVars).toContainEqual(expect.objectContaining({ key: 'GREETING', value: 'hello' }));
    expect(detail.envVars).toContainEqual(expect.objectContaining({ key: 'STRIPE_KEY', isSecret: true, value: null }));
  });

  it('hides projects from people who are not members', async () => {
    const { project } = await importProject();
    const stranger = await signIn({ id: 9999, login: 'mallory' });
    const response = await call(`/api/projects/${project?.projectId}`, { headers: { Cookie: stranger } });
    expect(response.status).toBe(404);
  });

  it('publishes a stored deployment again, and refuses when its assets are gone', async () => {
    const { project } = await importProject();
    const hash = 'd'.repeat(32);
    const session = await startSession('Acme/store', 'main', { '/index.html': { hash, size: 5 } });
    const first = await finalize(session.token, String(session.body.sessionId), {
      ...baseMetadata,
      assetsCompletionToken: 'completion-jwt',
    });
    const member = await signIn({ id: 1002, login: 'bob' });
    const path = `/api/projects/${project?.projectId}/deployments/${first.body.deploymentId}/redeploy`;

    const missing = await call(path, {
      method: 'POST',
      headers: { Cookie: member, 'Content-Type': 'application/json' },
    });
    expect(missing.status).toBe(409);

    cloudflare.storedAssets.add(hash);
    const again = await call(path, { method: 'POST', headers: { Cookie: member, 'Content-Type': 'application/json' } });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { deploymentId: string };
    expect(body.deploymentId).not.toBe(first.body.deploymentId);
    expect(cloudflare.scripts.get(`${project?.projectId}-main`)?.modules['index.js']?.text).toContain('hi');
  });
});
