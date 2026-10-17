import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import type { OnboardingStep } from './api';
import { resetDnsZones } from './dns-zones';
import { loadSession } from './session';
import { createTestContext, fakeApi, ME, onboarding } from './test-utils';

const PROJECT = {
  id: 'p1',
  name: 'Loja',
  repository: 'acme/loja',
  status: 'active',
  mode: 'byo',
  role: 'owner',
  productionUrl: null,
  runtime: { status: 'ready', previewUrl: 'https://p.example', botUsername: null },
};

async function mountApp(path: string, projects: unknown[] = [PROJECT], step = 'done') {
  fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects } },
    'GET /api/onboarding': { body: onboarding({ step: step as OnboardingStep }) },
  });
  await loadSession(true);
  const context = await createTestContext(path);
  const wrapper = mount(App, { global: { plugins: [...context.plugins] }, attachTo: document.body });
  await flushPromises();
  return { ...context, wrapper };
}

describe('app shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDnsZones();
    document.body.innerHTML = '';
  });

  it('has the main bar, the landmarks and a title for the page', async () => {
    const { wrapper, missing } = await mountApp('/projects');
    await vi.waitFor(() => expect(wrapper.find('.project-card').exists()).toBe(true), { timeout: 10_000 });

    const nav = wrapper.get('nav[aria-label="Navegação principal"]');
    expect(nav.findAll('a').map((link) => [link.attributes('href'), link.attributes('title')])).toEqual([
      ['/projects', 'Projetos'],
      ['/account', 'Conta'],
    ]);
    expect(nav.get('[aria-current="page"]').attributes('href')).toBe('/projects');
    expect(wrapper.get('a.skip-link').attributes('href')).toBe('#main');
    expect(wrapper.find('main#main').exists()).toBe(true);
    expect(document.title).toBe('Projetos · bohr');
    expect(missing).toEqual([]);
  });

  it('shows the admin area in the main bar to admins', async () => {
    fakeApi({
      'GET /api/me': { body: { ...ME, role: 'admin' } },
      'GET /api/projects': { body: { projects: [PROJECT] } },
    });
    await loadSession(true);
    const context = await createTestContext('/projects');
    const wrapper = mount(App, { global: { plugins: [...context.plugins] }, attachTo: document.body });
    await flushPromises();

    const nav = wrapper.get('nav[aria-label="Navegação principal"]');
    expect(nav.findAll('a').map((link) => link.attributes('href'))).toEqual(['/projects', '/account', '/admin']);
    expect(nav.get('a[href="/admin"]').attributes('title')).toBe('Administração');
    // A short caption under the icon; the accessible name stays the full label
    expect(nav.get('a[href="/admin"] .bohr-main-bar-link__caption').text()).toBe('Admin');
    expect(nav.get('a[href="/admin"] .bohr-main-bar-link__label').text()).toBe('Administração');
  });

  it('shows the domains in the main bar to people who have one whose DNS bohr hosts', async () => {
    fakeApi({
      'GET /api/me': { body: ME },
      'GET /api/projects': { body: { projects: [PROJECT] } },
      'GET /api/dns/zones': { body: { zones: [{ name: 'example.com', canEdit: true, org: null }] } },
    });
    await loadSession(true);
    const context = await createTestContext('/projects');
    const wrapper = mount(App, { global: { plugins: [...context.plugins] }, attachTo: document.body });
    await flushPromises();

    const nav = wrapper.get('nav[aria-label="Navegação principal"]');
    expect(nav.findAll('a').map((link) => link.attributes('href'))).toEqual(['/projects', '/domains', '/account']);
    expect(nav.get('a[href="/domains"]').attributes('title')).toBe('Domínios');
  });

  it('navigates inside the app from the main bar', async () => {
    const { wrapper, router } = await mountApp('/projects');

    await wrapper.get('nav a[href="/account"]').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/account'), { timeout: 10_000 });
    await flushPromises();

    expect(wrapper.get('h1').text()).toContain('Conta');
    expect(wrapper.get('nav [aria-current="page"]').attributes('href')).toBe('/account');
  });

  it('sends a user without projects to the onboarding, until it is done', async () => {
    const { router } = await mountApp('/projects', [], 'cloudflare');

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('start'), { timeout: 10_000 });
  });

  it('shows the way to a new project to a user who finished the onboarding without projects', async () => {
    const { wrapper, router } = await mountApp('/projects', []);

    await vi.waitFor(() => expect(wrapper.find('[data-empty]').exists()).toBe(true), { timeout: 10_000 });
    expect(router.currentRoute.value.name).toBe('projects');
    expect(wrapper.get('[data-empty] a').attributes('href')).toBe('/projects/new');
  });
});
