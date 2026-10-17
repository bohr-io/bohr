import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App.vue';
import type { OrgSummary } from '../../api';
import { orgs, resetOrgs, setContext } from '../../orgs';
import { loadSession } from '../../session';
import { createTestContext, type FakeRoute, fakeApi, ME, onboarding, projectSummary } from '../../test-utils';

const READY = { subscription: true, cloudflare: true, agent: true, installation: true };
const ACME: OrgSummary = { id: 'o_1', slug: 'acme', name: 'Acme Inc', avatarUrl: null, role: 'admin', status: READY };
const LUME: OrgSummary = { id: 'o_2', slug: 'lume', name: 'Café Lume', avatarUrl: null, role: 'member', status: READY };

const orgDetail = (org: OrgSummary) => ({
  body: {
    org: { ...org, githubLogin: org.slug, membersPermission: true },
    billing: { enabled: false, subscribed: false },
  },
});

async function mountApp(path: string, routes: Record<string, FakeRoute> = {}) {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/orgs': { body: { orgs: [LUME, ACME] } },
    'GET /api/projects': { body: { projects: [projectSummary()] } },
    'GET /api/onboarding': { body: onboarding({ step: 'done' }) },
    'GET /api/orgs/acme': orgDetail(ACME),
    'GET /api/orgs/lume': orgDetail(LUME),
    ...routes,
  });
  await loadSession(true);
  const context = await createTestContext(path);
  const wrapper = mount(App, { global: { plugins: [...context.plugins] }, attachTo: document.body });
  await flushPromises();
  return { ...context, wrapper, api };
}

type Wrapper = Awaited<ReturnType<typeof mountApp>>['wrapper'];

const toggle = (wrapper: Wrapper) => wrapper.get('[data-context-switcher] button');
const captions = (wrapper: Wrapper) =>
  wrapper.findAll('nav [aria-hidden="true"][class$="__caption"]').map((caption) => caption.text());
const barLinks = (wrapper: Wrapper) =>
  wrapper.findAll('nav[aria-label="Navegação principal"] .bohr-main-bar-link a').map((link) => link.attributes('href'));

describe('context switcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetOrgs();
    setContext(null);
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('switches between the personal account and the organizations, and the main bar follows', async () => {
    const { wrapper, router, missing } = await mountApp('/projects');

    expect(toggle(wrapper).attributes('aria-label')).toBe('Contexto: Pessoal. Trocar de contexto');
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
    await toggle(wrapper).trigger('click');
    await flushPromises();

    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true');
    const names = wrapper.findAll('[data-context] .context-switcher__name').map((name) => name.text());
    expect(names).toEqual(['Pessoal', 'Acme Inc', 'Café Lume', 'Nova organização']);
    expect(wrapper.get('[data-context="acme"]').text()).toContain('Admin');
    expect(wrapper.get('[data-context="personal"]').attributes('aria-current')).toBe('true');
    expect(wrapper.get('[data-context="new"]').attributes('href')).toBe('/orgs/new');

    await wrapper.get('[data-context="acme"]').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/orgs/acme'), { timeout: 10_000 });
    await flushPromises();

    expect(wrapper.find('[data-context]').exists()).toBe(false);
    expect(orgs.context).toBe('acme');
    expect(window.localStorage.getItem('bohr.context')).toBe('"acme"');
    expect(toggle(wrapper).attributes('aria-label')).toBe('Contexto: Acme Inc. Trocar de contexto');
    // The whole main bar follows: the organization's projects, members and settings
    expect(barLinks(wrapper)).toEqual(['/orgs/acme', '/orgs/acme/membros', '/orgs/acme/configuracoes', '/account']);
    expect(wrapper.get('nav a[href="/orgs/acme/configuracoes"]').attributes('title')).toBe(
      'Configurações da organização',
    );
    // Each icon has its name written under it, the context switcher the current context's
    expect(captions(wrapper)).toEqual(['Acme Inc', 'Projetos', 'Membros', 'Configurações', 'Conta']);

    await toggle(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-context="acme"]').attributes('aria-current')).toBe('true');
    await wrapper.get('[data-context="personal"]').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/projects'), { timeout: 10_000 });
    await flushPromises();

    expect(orgs.context).toBeNull();
    expect(barLinks(wrapper)).toEqual(['/projects', '/account']);
    expect(captions(wrapper)).toEqual(['Pessoal', 'Projetos', 'Conta']);
    expect(missing).toEqual([]);
  });

  it('closes with Escape, giving the focus back to its button', async () => {
    const { wrapper } = await mountApp('/projects');

    await toggle(wrapper).trigger('click');
    await flushPromises();
    await wrapper.get('[data-context="personal"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[data-context]').exists()).toBe(false);
    expect(document.activeElement).toBe(toggle(wrapper).element);
  });

  it('starts at the remembered organization, and the personal projects are the personal scope', async () => {
    setContext('acme');
    const { router, wrapper, api } = await mountApp('/');

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/orgs/acme'), { timeout: 10_000 });
    expect(wrapper.get('nav [aria-current="page"]').attributes('href')).toBe('/orgs/acme');

    // The Projects link of the personal scope lists only the personal projects, and is remembered
    await router.push('/projects');
    await flushPromises();
    expect(orgs.context).toBeNull();
    expect(api.callsTo('GET /api/projects').at(-1)?.query.get('scope')).toBe('personal');
    expect(barLinks(wrapper)).toEqual(['/projects', '/account']);
  });

  it("shows an organization member its members but not the admins' settings, and its Projects link works", async () => {
    const { router, wrapper } = await mountApp('/orgs/lume/membros', {
      'GET /api/orgs/lume/members': { body: { members: [] } },
    });
    await flushPromises();

    expect(barLinks(wrapper)).toEqual(['/orgs/lume', '/orgs/lume/membros', '/account']);
    expect(wrapper.get('nav [aria-current="page"]').attributes('href')).toBe('/orgs/lume/membros');

    await wrapper.get('nav a[href="/orgs/lume"]').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('org'), { timeout: 10_000 });
    await flushPromises();
    expect(wrapper.get('nav [aria-current="page"]').attributes('href')).toBe('/orgs/lume');
  });

  it("selects a project's organization when the project is opened from a link", async () => {
    const { wrapper } = await mountApp('/projects/p7/builds', {
      'GET /api/projects/p7': {
        body: {
          project: {
            id: 'p7',
            name: 'Site Acme',
            repository: 'acme/site',
            status: 'active',
            mode: 'byo',
            role: 'owner',
          },
          access: 'member',
          org: { slug: 'acme', name: 'Acme Inc' },
          hostnames: [],
          deployments: [],
          envVars: [],
        },
      },
    });
    await vi.waitFor(() => expect(orgs.context).toBe('acme'), { timeout: 10_000 });
    await flushPromises();

    expect(barLinks(wrapper).slice(0, 2)).toEqual(['/orgs/acme', '/orgs/acme/membros']);
  });

  it('forgets a remembered organization the user is no longer a member of', async () => {
    setContext('gone');
    const { router, wrapper } = await mountApp('/');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/projects'), { timeout: 10_000 });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/projects');
    expect(orgs.context).toBeNull();
    expect(wrapper.find('.project-card').exists()).toBe(true);
  });
});
