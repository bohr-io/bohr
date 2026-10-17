import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt, onboarding } from '../test-utils';

const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test';
const READY = { status: 'ready', error: null, previewUrl: 'https://p.example', botUsername: null, version: '1' };

async function mountNewProject(routes: Record<string, FakeRoute | FakeRoute[]>, path = '/projects/new') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/instance': {
      body: {
        setup: { githubApp: true, platformBot: true },
        billing: false,
        telegramBot: null,
        githubAppSlug: 'bohr-test',
      },
    },
    'GET /api/onboarding': { body: onboarding({ step: 'done', github: { installUrl: null } }) },
    'GET /api/repositories': {
      body: {
        repositories: [
          { id: 1, fullName: 'acme/loja', defaultBranch: 'main', private: true },
          { id: 2, fullName: 'acme/site', defaultBranch: 'trunk', private: false },
        ],
      },
    },
    'GET /api/projects/p1/runtime': { body: READY },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(path);
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountNewProject>>['wrapper'];

const view = (wrapper: Wrapper) => wrapper.get('[data-view]').attributes('data-view');
const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

describe('new project page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('sends users who did not finish the onboarding to it', async () => {
    const { router, wrapper } = await mountNewProject({
      'GET /api/onboarding': { body: onboarding({ step: 'github' }) },
    });

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('start'), { timeout: 10_000 });
    wrapper.unmount();
  });

  it('creates the project from a repository, follows its setup and offers the optional bot', async () => {
    const { wrapper, api, router, missing } = await mountNewProject({
      'POST /api/projects': { status: 201, body: { projectId: 'p1' } },
    });

    expect(view(wrapper)).toBe('repository');
    // Without the onboarding's link, the GitHub App's own page gives access to more repositories.
    expect(wrapper.get('a[href="https://github.com/apps/bohr-test/installations/new"]').attributes('target')).toBe(
      '_blank',
    );
    expect(wrapper.find('[data-notice="agent"]').exists()).toBe(false);

    await wrapper.get('input[type="text"]').setValue('site');
    expect(wrapper.findAll('.repositories__name').map((name) => name.text())).toEqual(['acme/site']);
    await wrapper.get('input[type="radio"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.callsTo('POST /api/projects')[0]?.body).toEqual({
      repository: 'acme/site',
      name: 'site',
      productionBranch: 'trunk',
      locale: 'pt-BR',
    });
    // The runtime is ready on the first check: straight to the optional bot.
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ project: 'p1', step: 'bot' }), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(view(wrapper)).toBe('bot');
    expect(wrapper.findAll('.wizard-progress__item.is-done')).toHaveLength(2);

    await button(wrapper, 'Pular e abrir o projeto')?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('project'), { timeout: 10_000 });
    expect(router.currentRoute.value.params.id).toBe('p1');
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('resumes from the query and connects a BotFather bot', async () => {
    const { wrapper, api, router } = await mountNewProject(
      { 'POST /api/projects/p1/runtime/telegram-bot': { body: { username: 'loja_bot' } } },
      '/projects/new?project=p1&step=bot',
    );

    expect(view(wrapper)).toBe('bot');
    await wrapper.get('input[type="password"]').setValue(`123456789:${'A'.repeat(35)}`);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.callsTo('POST /api/projects/p1/runtime/telegram-bot')[0]?.body).toEqual({
      token: `123456789:${'A'.repeat(35)}`,
    });
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Bot @loja_bot conectado.');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('project'), { timeout: 10_000 });
    wrapper.unmount();
  });

  it('shows the setup while the runtime is not ready, and points to the agent settings', async () => {
    const { wrapper } = await mountNewProject(
      {
        'GET /api/onboarding': { body: onboarding({ step: 'done', agent: { configured: false } }) },
        'GET /api/projects/p1/runtime': {
          body: { status: 'provisioning', error: null, previewUrl: null, botUsername: null, version: null },
        },
      },
      '/projects/new?project=p1',
    );

    expect(view(wrapper)).toBe('provisioning');
    expect(wrapper.get('[data-notice="agent"]').text()).toContain('O agente ainda não está configurado');
    expect(wrapper.get('[data-notice="agent"] a').attributes('href')).toBe('/account/agente');
    wrapper.unmount();
  });

  it('says why the agent waits when the Cloudflare account cannot run Containers, and opens the project', async () => {
    const { wrapper, api, router } = await mountNewProject({
      'POST /api/projects': { status: 201, body: { projectId: 'p1', runtime: false } },
    });

    await wrapper.get('input[type="radio"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ project: 'p1', agent: 'unavailable' }), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(view(wrapper)).toBe('unavailable');
    // Nothing to follow: no runtime is being set up
    expect(api.callsTo('GET /api/projects/p1/runtime')).toHaveLength(0);
    const notice = wrapper.get('[data-notice="agent-unavailable"]');
    expect(notice.text()).toContain('O agente precisa do plano Workers Paid');
    expect(notice.text()).toContain('Containers: Edit');

    await button(wrapper, 'Abrir o projeto')?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('project'), { timeout: 10_000 });
    expect(router.currentRoute.value.params.id).toBe('p1');
    wrapper.unmount();
  });

  it('offers the subscription when creating a project needs one', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { wrapper, api } = await mountNewProject({
      'POST /api/projects': { status: 402, body: { error: 'bohr.io Cloud needs an active subscription.' } },
      'POST /api/onboarding/subscription': { body: { status: 'payment_required', checkoutUrl: CHECKOUT } },
    });

    await wrapper.get('input[type="radio"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('precisa de uma assinatura ativa');
    await button(wrapper, 'Assinar o bohr.io Cloud')?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/onboarding/subscription')).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith(CHECKOUT);
    wrapper.unmount();
  });

  describe('from a template', () => {
    const TEMPLATES = {
      templates: [
        {
          slug: 'waitlist',
          repository: 'bohr-io/template-waitlist',
          database: true,
          locales: {
            'pt-BR': { name: 'Lista de espera', description: 'Coleta e-mails.' },
            en: { name: 'Waitlist', description: 'Collects emails.' },
            es: { name: 'Lista de espera', description: 'Recoge correos.' },
          },
          tags: ['marketing', 'unknown-tag'],
        },
        {
          slug: 'menu',
          repository: 'bohr-io/template-menu',
          database: true,
          locales: {
            'pt-BR': { name: 'Cardápio digital', description: 'O cardápio pelo QR code.' },
            en: { name: 'Digital menu', description: 'The menu from a QR code.' },
            es: { name: 'Menú digital', description: 'La carta con un QR.' },
          },
          tags: ['restaurant'],
        },
      ],
    };
    const ORG = (slug: string, ready: boolean) => ({
      id: `o_${slug}`,
      slug,
      name: slug === 'acme' ? 'Acme Inc' : 'Beta',
      avatarUrl: null,
      role: 'member',
      status: { subscription: true, cloudflare: ready, agent: true, installation: true },
    });

    it('creates the project from a template through GitHub, owned by the user or one of their organizations', async () => {
      const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
      const { wrapper, api, router, missing } = await mountNewProject({
        'GET /api/templates': { body: TEMPLATES },
        'GET /api/orgs': { body: { orgs: [ORG('acme', true), ORG('beta', false)] } },
        'POST /api/templates/projects': { body: { url: 'https://github.com/login/oauth/authorize?state=s' } },
      });

      await wrapper.get('[data-source] [data-option="template"]').trigger('click');
      await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ source: 'template' }));
      await flushPromises();
      expect(wrapper.findAll('.templates__name').map((name) => name.text())).toEqual([
        'Lista de espera',
        'Cardápio digital',
      ]);
      // Known tags are translated; others show as they are
      expect(wrapper.get('[data-template="waitlist"]').text()).toContain('Marketing');
      expect(wrapper.get('[data-template="waitlist"]').text()).toContain('unknown-tag');
      expect(wrapper.find('.wizard-progress').text()).toContain('Modelo');

      await wrapper.get('[data-template="menu"] input').setValue(true);
      // Only organizations ready for projects can own one
      expect(wrapper.findAll('select option').map((option) => option.text())).toEqual([
        'Minha conta pessoal',
        'Acme Inc',
      ]);
      await wrapper.get('input[type="text"]').setValue('cardapio da casa');
      await wrapper.get('form').trigger('submit');
      expect(wrapper.get('[role="alert"]').text()).toContain('Use só letras, números');
      expect(api.callsTo('POST /api/templates/projects')).toHaveLength(0);

      await wrapper.get('input[type="text"]').setValue('cardapio');
      await wrapper.get('select').setValue('acme');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(api.callsTo('POST /api/templates/projects')[0]?.body).toEqual({
        template: 'menu',
        name: 'cardapio',
        org: 'acme',
        private: true,
        locale: 'pt-BR',
      });
      expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=s');
      expect(missing).toEqual([]);
      wrapper.unmount();
    });

    it('brings the form back with the error GitHub came back with, and links to the token for D1', async () => {
      const { wrapper, missing } = await mountNewProject(
        {
          'GET /api/templates': { body: TEMPLATES },
          'GET /api/orgs': { body: { orgs: [] } },
        },
        `/projects/new?template=menu&error=${encodeURIComponent('The Cloudflare token cannot create D1 databases.')}&code=d1_permission`,
      );
      await flushPromises();

      expect(wrapper.get('[data-template="menu"] input').element).toHaveProperty('checked', true);
      expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('cardapio');
      const notice = wrapper.get('[data-notice="template-error"]');
      expect(notice.text()).toContain('“D1: Edit”');
      expect(notice.get('a').attributes('href')).toBe('https://dash.cloudflare.com/profile/api-tokens');
      expect(missing).toEqual([]);
      wrapper.unmount();
    });

    it('explains a D1 refusal before going to GitHub', async () => {
      const { wrapper } = await mountNewProject(
        {
          'GET /api/templates': { body: TEMPLATES },
          'GET /api/orgs': { body: { orgs: [] } },
          'POST /api/templates/projects': {
            status: 403,
            body: { error: 'The Cloudflare token cannot create D1 databases.', code: 'd1_permission' },
          },
        },
        '/projects/new?source=template',
      );
      await flushPromises();
      await wrapper.get('[data-template="waitlist"] input').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.get('[data-notice="template-error"]').text()).toContain('adicione a permissão “D1: Edit”');
      wrapper.unmount();
    });

    it('shows the admin password once while the project is set up', async () => {
      const { wrapper, api, router } = await mountNewProject(
        {
          'POST /api/templates/password': [
            { body: { password: 'senha-forte-123', url: 'https://cardapio.ana.workers.dev' } },
            { status: 404, body: { error: 'The password was already shown.' } },
          ],
        },
        '/projects/new?project=p1&template=menu',
      );
      await flushPromises();

      const notice = wrapper.get('[data-notice="admin-password"]');
      expect(notice.get('[data-password]').text()).toBe('senha-forte-123');
      expect(notice.get('a').attributes('href')).toBe('https://cardapio.ana.workers.dev');
      expect(notice.text()).toContain('ADMIN_PASSWORD');
      // The runtime is ready: on to the bot, with the password still on the page
      await vi.waitFor(
        () => expect(router.currentRoute.value.query).toEqual({ project: 'p1', step: 'bot', template: 'menu' }),
        { timeout: 10_000 },
      );
      await flushPromises();
      expect(wrapper.find('[data-notice="admin-password"]').exists()).toBe(true);
      expect(api.callsTo('POST /api/templates/password')).toHaveLength(1);
      wrapper.unmount();

      // After a reload, only how to change it
      const again = await mountNewProject(
        { 'POST /api/templates/password': { status: 404, body: { error: 'The password was already shown.' } } },
        '/projects/new?project=p1&template=menu&step=bot',
      );
      await flushPromises();
      expect(again.wrapper.get('[data-notice="admin-password-gone"]').text()).toContain('ADMIN_PASSWORD');
      again.wrapper.unmount();
    });
  });

  describe('in an organization', () => {
    const READY = { subscription: true, cloudflare: true, agent: true, installation: true };
    const orgDetail = (role: 'admin' | 'member', status: Partial<typeof READY> = {}) => ({
      body: {
        org: {
          id: 'o_1',
          slug: 'acme',
          name: 'Acme Inc',
          avatarUrl: null,
          githubLogin: 'acme',
          role,
          status: { ...READY, ...status },
          membersPermission: true,
        },
        billing: { enabled: true, subscribed: status.subscription !== false },
      },
    });

    it("creates the project from one of the organization's repositories, inside the organization", async () => {
      const { wrapper, api, router, missing } = await mountNewProject(
        {
          'GET /api/orgs/acme': orgDetail('member'),
          'GET /api/repositories': (call) => ({
            body: {
              repositories:
                call.query.get('org') === 'acme'
                  ? [{ id: 9, fullName: 'acme/site-institucional', defaultBranch: 'main', private: true }]
                  : [],
            },
          }),
          'POST /api/projects': { status: 201, body: { projectId: 'p1' } },
        },
        '/projects/new?org=acme',
      );

      expect(view(wrapper)).toBe('repository');
      expect(wrapper.get('[data-org]').text()).toContain('Na organização Acme Inc');
      expect(wrapper.get('[data-org] a').attributes('href')).toBe('/orgs/acme');
      // The organization's setup, not the personal onboarding.
      expect(api.callsTo('GET /api/onboarding')).toHaveLength(0);
      expect(api.callsTo('GET /api/repositories')[0]?.query.get('org')).toBe('acme');
      expect(wrapper.findAll('.repositories__name').map((name) => name.text())).toEqual(['acme/site-institucional']);

      await wrapper.get('input[type="radio"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(api.callsTo('POST /api/projects')[0]?.body).toEqual({
        repository: 'acme/site-institucional',
        org: 'acme',
        name: 'site-institucional',
        productionBranch: 'main',
        locale: 'pt-BR',
      });
      // The member follows the setup (GET /runtime is open to members), then goes to the project: connecting the
      // Telegram bot is for the project's owners, the organization's admins (403 for a member).
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/projects/p1'), { timeout: 10_000 });
      expect(missing).toEqual([]);
      wrapper.unmount();
    });

    it("offers the bot step to the organization's admins, who own its projects", async () => {
      const { wrapper, router } = await mountNewProject(
        {
          'GET /api/orgs/acme': orgDetail('admin'),
          'GET /api/repositories': {
            body: { repositories: [{ id: 9, fullName: 'acme/site', defaultBranch: 'main', private: true }] },
          },
          'POST /api/projects': { status: 201, body: { projectId: 'p1' } },
        },
        '/projects/new?org=acme',
      );

      await wrapper.get('input[type="radio"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      await vi.waitFor(
        () => expect(router.currentRoute.value.query).toEqual({ org: 'acme', project: 'p1', step: 'bot' }),
        { timeout: 10_000 },
      );
      wrapper.unmount();
    });

    it('sends admins to the setup of an organization that is not ready, and tells members to wait', async () => {
      const admin = await mountNewProject(
        { 'GET /api/orgs/acme': orgDetail('admin', { cloudflare: false }) },
        '/projects/new?org=acme',
      );
      await vi.waitFor(() => expect(admin.router.currentRoute.value.path).toBe('/orgs/acme'), { timeout: 10_000 });
      admin.wrapper.unmount();

      const member = await mountNewProject(
        { 'GET /api/orgs/acme': orgDetail('member', { subscription: false }) },
        '/projects/new?org=acme',
      );
      expect(member.wrapper.get('[data-notice="org-not-ready"]').text()).toContain(
        'A organização ainda não está pronta',
      );
      expect(member.api.callsTo('GET /api/repositories')).toHaveLength(0);
      member.wrapper.unmount();
    });

    it("points admins to the organization's agent settings when the agent is missing", async () => {
      const { wrapper } = await mountNewProject(
        { 'GET /api/orgs/acme': orgDetail('admin', { agent: false }) },
        '/projects/new?org=acme',
      );

      expect(wrapper.get('[data-notice="agent"] a').attributes('href')).toBe('/orgs/acme/configuracoes');
      wrapper.unmount();
    });
  });
});
