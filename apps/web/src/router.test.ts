import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { INSTANCE_PATHS } from './build-config';
import { authGuard, createAppRouter, isStaleChunkError, routes, scrollBehavior } from './router';
import { loadSession } from './session';
import { fakeApi, ME } from './test-utils';

async function routerAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach(authGuard);
  await router.push(path);
  await router.isReady();
  return router;
}

describe('routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends signed-out visitors to the sign-in page, keeping where they were going', async () => {
    fakeApi({ 'GET /api/me': { status: 401, body: { error: 'Not signed in.' } } });
    await loadSession(true);

    const router = await routerAt('/projects/p1?tab=members');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/projects/p1?tab=members');
  });

  it('lets signed-in users through', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);

    const router = await routerAt('/account');

    expect(router.currentRoute.value.name).toBe('account');
  });

  it('opens the admin area to admins only', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);

    const user = await routerAt('/admin/usuarios?q=ana');
    expect(user.currentRoute.value.name).toBe('projects');
    expect((await routerAt('/admin/telemetria')).currentRoute.value.name).toBe('projects');

    fakeApi({ 'GET /api/me': { body: { ...ME, role: 'admin' } } });
    await loadSession(true);

    expect((await routerAt('/admin')).currentRoute.value.name).toBe('admin');
    expect((await routerAt('/admin/usuarios/u_2')).currentRoute.value.params.userId).toBe('u_2');
    expect((await routerAt('/admin/projetos')).currentRoute.value.name).toBe('admin-projects');
    expect((await routerAt('/admin/orgs')).currentRoute.value.name).toBe('admin-orgs');
  });

  it('opens the sign-in and 404 pages without a session', async () => {
    fakeApi({ 'GET /api/me': { status: 401, body: { error: 'Not signed in.' } } });
    await loadSession(true);

    expect((await routerAt('/login')).currentRoute.value.name).toBe('login');
    expect((await routerAt('/nowhere/at/all')).currentRoute.value.name).toBe('not-found');
  });

  it('opens the organization pages, /orgs/new before an organization called "new"', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);

    expect((await routerAt('/orgs/new')).currentRoute.value.name).toBe('org-new');
    const members = (await routerAt('/orgs/acme/membros')).currentRoute.value;
    expect([members.name, members.params.slug]).toEqual(['org-members', 'acme']);
    expect((await routerAt('/orgs/acme')).currentRoute.value.name).toBe('org');
    expect((await routerAt('/orgs/acme/configuracoes')).currentRoute.value.name).toBe('org-settings');
    expect((await routerAt('/projects/new?org=acme')).currentRoute.value.query.org).toBe('acme');
  });

  it('starts at the projects', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);

    expect((await routerAt('/')).currentRoute.value.name).toBe('projects');
  });

  it('opens the overview’s site in full screen without scrolling the page under it', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);

    const site = (await routerAt('/projects/p1/site?deploy=preview&chat=1')).currentRoute.value;
    expect([site.name, site.params.id, site.query]).toEqual(['project-site', 'p1', { deploy: 'preview', chat: '1' }]);

    const overview = (await routerAt('/projects/p1')).currentRoute.value;
    const builds = (await routerAt('/projects/p1/builds')).currentRoute.value;
    expect(scrollBehavior(site, overview, null)).toBe(false);
    expect(scrollBehavior(overview, site, null)).toBe(false);
    expect(scrollBehavior(builds, overview, null)).toEqual({ top: 0 });
  });

  it('leaves the paths the instance Worker answers alone', () => {
    const paths = routes.map((route) => route.path).filter((path) => !path.startsWith('/:'));
    for (const path of paths) {
      for (const reserved of INSTANCE_PATHS) expect(path === reserved || path.startsWith(`${reserved}/`)).toBe(false);
    }
  });
});

describe('pages whose code went stale with a deploy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('recognizes the errors of a module that is gone, and nothing else', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/a-1.js'))).toBe(
      true,
    );
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/a-1.css'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('loads the destination from the server once, not over and over', async () => {
    fakeApi({ 'GET /api/me': { body: ME } });
    await loadSession(true);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const router = createAppRouter(createMemoryHistory());
    router.addRoute({
      path: '/stale',
      component: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/a-1.js')),
    });

    await router.push('/stale').catch(() => {});
    await router.push('/stale').catch(() => {});
    expect(assign.mock.calls).toEqual([['/stale']]);
  });
});
