import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import type { Build } from '../api';
import { loadSession } from '../session';
import {
  chatEntry,
  conversation,
  type FakeRoute,
  fakeApi,
  ME,
  mountAt,
  projectState,
  projectSummary as summary,
} from '../test-utils';

function build(overrides: Partial<Build> = {}): Build {
  return {
    id: 101,
    number: 7,
    workflow: 'Deploy',
    title: 'Botão verde',
    branch: 'main',
    commit: 'abc1234def5678',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:03:00.000Z',
    url: 'https://github.com/acme/loja/actions/runs/101',
    ...overrides,
  };
}

const AGENT = '/api/projects/p1/agent';
const NO_AGENT = { configured: false, provider: null, baseUrl: null, model: null, effort: null, keyHint: null };
const ACME = { slug: 'acme', name: 'Acme Inc' };

/** GET /api/projects/:id as the instance answers it: access and org inside project and at the top level. */
function projectDetail(access: 'member' | 'admin', org: typeof ACME | null = null) {
  return {
    body: {
      project: {
        id: 'p1',
        name: 'Loja',
        repository: 'acme/loja',
        productionBranch: 'main',
        status: 'active',
        mode: 'byo',
        role: 'owner',
        access,
        org,
      },
      access,
      org,
      hostnames: [],
      deployments: [],
      envVars: [],
    },
  };
}

async function mountProject(routes: Record<string, FakeRoute | FakeRoute[]>, path = '/projects/p1') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects: [summary()] } },
    [`GET ${AGENT}/state`]: { body: projectState() },
    [`GET ${AGENT}/messages`]: conversation([chatEntry(1, { kind: 'system', text: 'Projeto criado.' })]).route,
    [`GET ${AGENT}/members`]: {
      body: {
        members: [
          { key: 'u:u_1', name: 'Ana Lima', role: 'owner', joinedAt: '2026-10-01T10:00:00.000Z' },
          { key: 'tg:42', name: 'Bia', role: 'member', joinedAt: '2026-10-02T10:00:00.000Z' },
        ],
      },
    },
    'GET /api/projects/p1/move': {
      body: { move: { status: 'available' }, connections: [{ id: 'c1', accountId: 'acc-1', accountName: 'Acme' }] },
    },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(path);
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountProject>>['wrapper'];

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dialogButton = (text: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === text);
const navLinks = (wrapper: Wrapper) => wrapper.findAll('.project-nav__link').map((link) => link.text());
const current = (wrapper: Wrapper) => wrapper.get('.project-nav [aria-current="page"]').text();
const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

/** Follows a link and waits for the sub-page it opens. */
async function go(wrapper: Wrapper, text: string, within = '') {
  const router = (wrapper.vm as unknown as { $router: Router }).$router;
  const before = router.currentRoute.value.fullPath;
  const scope = within === '' ? wrapper : wrapper.get(within);
  await scope
    .findAll('a')
    .find((anchor) => anchor.text() === text)
    ?.trigger('click');
  await vi.waitFor(() => expect(router.currentRoute.value.fullPath).not.toBe(before), { timeout: 10_000 });
  await flushPromises();
  await flushPromises();
}

describe('project page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('tells an instance admin they are looking at a project of someone else', async () => {
    const admin = await mountProject({
      'GET /api/projects': { body: { projects: [] } },
      'GET /api/projects/p1': projectDetail('admin'),
    });
    await flushPromises();
    expect(admin.wrapper.get('[data-banner="admin"]').text()).toBe('Você está vendo este projeto como administrador');
    admin.wrapper.unmount();

    const member = await mountProject({ 'GET /api/projects/p1': projectDetail('member') });
    await flushPromises();
    expect(member.wrapper.find('[data-banner="admin"]').exists()).toBe(false);
  });

  it("shows the organization of an organization's project, and reads it from the organization's list", async () => {
    const { wrapper, api } = await mountProject({
      'GET /api/projects': (call) => ({
        body: { projects: call.query.get('org') === 'acme' ? [summary({ org: ACME })] : [] },
      }),
      'GET /api/projects/p1': projectDetail('member', ACME),
    });
    await flushPromises();

    const badge = wrapper.get('[data-org-badge]');
    expect(badge.text()).toBe('Organização: Acme Inc');
    expect(badge.attributes('href')).toBe('/orgs/acme');
    expect(wrapper.get('.project__back').attributes('href')).toBe('/orgs/acme');
    expect(api.callsTo('GET /api/projects').map((call) => call.query.get('org'))).toEqual([null, 'acme']);
  });

  // One sub-page per test: mounting several in a row is slow on CI runners.
  it('lays the project out like bohr v1: a header, a menu and the overview', async () => {
    const { wrapper, missing } = await mountProject({
      [`GET ${AGENT}/state`]: {
        body: projectState({
          homolog: {
            status: 'pending',
            version: 4,
            headSha: 'abc',
            changes: [{ requestId: 'r1', summary: 'Botão verde' }],
          },
        }),
      },
    });

    expect(wrapper.get('h1').text()).toContain('Visão geral');
    expect(wrapper.findAll('.project-header__crumb').map((crumb) => crumb.text())).toEqual(['acme', 'loja']);
    expect(wrapper.get('a[href="https://github.com/acme/loja"]').attributes('target')).toBe('_blank');
    expect(wrapper.find('a[href="https://loja.example.com"]').exists()).toBe(true);
    expect(navLinks(wrapper)).toEqual(['Visão geral', 'Versões', 'Builds', 'Membros', 'Configurações']);
    expect(current(wrapper)).toBe('Visão geral');
    // The overview sums the project up; the chat is not here.
    expect(wrapper.get('[data-card="preview"]').text()).toContain('Botão verde');
    expect(wrapper.get('[data-card="preview"]').text()).toContain('versão 4');
    expect(wrapper.find('.chat').exists()).toBe(false);
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('keeps the agent page, with the chat, at its address though the menu no longer lists it', async () => {
    const { wrapper, router } = await mountProject({}, '/projects/p1/agente');

    expect(router.currentRoute.value.name).toBe('project-agent');
    expect(wrapper.get('h1').text()).toContain('Agente');
    expect(navLinks(wrapper)).not.toContain('Agente');
    expect(wrapper.find('.chat').exists()).toBe(true);
    wrapper.unmount();
  });

  it("opens the preview's old sub-page in the overview's full-screen view, on the preview", async () => {
    const { wrapper, router } = await mountProject({}, '/projects/p1/homologacao?chat=1');

    expect(router.currentRoute.value.name).toBe('project-site');
    expect(router.currentRoute.value.query).toEqual({ chat: '1', deploy: 'preview' });
    await flushPromises();
    expect(wrapper.get('.site-stage').classes()).toContain('is-full');
    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe(
      'https://loja-preview.example.workers.dev',
    );
    expect(current(wrapper)).toBe('Visão geral');
    wrapper.unmount();
  });

  it('lists the members in their own sub-page', async () => {
    const { wrapper } = await mountProject({}, '/projects/p1/membros');

    expect(current(wrapper)).toBe('Membros');
    expect(wrapper.text()).toContain('Bia');
    expect(wrapper.find('.chat').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens the sub-pages of the old ?tab= links', async () => {
    const { router, wrapper } = await mountProject({}, '/projects/p1?tab=members');
    expect(router.currentRoute.value.name).toBe('project-members');
    wrapper.unmount();

    const settings = await mountProject({}, '/projects/p1?tab=settings&x=1');
    expect(settings.router.currentRoute.value.name).toBe('project-settings-agent');
    expect(settings.router.currentRoute.value.query).toEqual({ x: '1' });
    settings.wrapper.unmount();
  });

  it('replaces the menu with the settings menu, which leads back to the overview', async () => {
    const { wrapper, router } = await mountProject({}, '/projects/p1/configuracoes');

    expect(router.currentRoute.value.name).toBe('project-settings-general');
    expect(wrapper.get('h1').text()).toContain('Configurações');
    expect(navLinks(wrapper)).toEqual([
      'Voltar',
      'Geral',
      'Domínios',
      'Variáveis de ambiente',
      'Autenticação',
      'Agente',
    ]);
    expect(current(wrapper)).toBe('Geral');
    expect(wrapper.text()).toContain('acme/loja');

    await go(wrapper, 'Agente');
    expect(router.currentRoute.value.name).toBe('project-settings-agent');
    expect(wrapper.find('.settings').exists()).toBe(true);

    await go(wrapper, 'Voltar', '.project-nav');
    expect(router.currentRoute.value.name).toBe('project');
    expect(navLinks(wrapper)).toContain('Visão geral');
    wrapper.unmount();
  });

  it('asks before discarding the preview', async () => {
    const { wrapper, api } = await mountProject({
      [`GET ${AGENT}/state`]: {
        body: projectState({
          homolog: {
            status: 'pending',
            version: 4,
            headSha: 'abc',
            changes: [{ requestId: 'r1', summary: 'Botão verde' }],
          },
        }),
      },
      [`POST ${AGENT}/decisions`]: { body: { message: 'Ana descartou as mudanças.' } },
    });

    // The overview's preview card decides, as the chat does
    expect(wrapper.get('[data-card="preview"]').text()).toContain('Botão verde');
    await wrapper
      .findAll('[data-preview-decision] button')
      .find((candidate) => candidate.text() === 'Descartar')
      ?.trigger('click');
    await flushPromises();
    expect(api.callsTo(`POST ${AGENT}/decisions`)).toHaveLength(0);
    expect(dialog()?.textContent).toContain('Descartar as mudanças?');

    dialogButton('Descartar')?.click();
    await flushPromises();
    expect(api.callsTo(`POST ${AGENT}/decisions`)[0]?.body).toEqual({ action: 'discard', version: 4 });
    wrapper.unmount();
  });

  it.each([
    // The instance hides projects from non-members...
    ['the instance', { status: 404, body: { error: 'Project not found.' } }, 'não aparece entre os seus'],
    // ...and the project Worker answers for members the instance still lists.
    ['the project', { status: 403, body: { error: 'not_a_member' } }, 'ainda não participa'],
  ])('lets someone with an invite code join when %s refuses them', async (_, refusal, text) => {
    let member = false;
    const { wrapper, api } = await mountProject(
      {
        'GET /api/projects': () => ({ body: { projects: member ? [summary({ role: 'member' })] : [] } }),
        [`GET ${AGENT}/state`]: () => (member ? { body: projectState() } : refusal),
        [`GET ${AGENT}/messages`]: () => (member ? { body: { messages: [], last: 0 } } : refusal),
        [`POST ${AGENT}/join`]: () => {
          member = true;
          return { body: { joined: true } };
        },
      },
      '/projects/p1?code=K7P2-9QXM',
    );

    expect(wrapper.text()).toContain(text);
    expect(wrapper.find('.project-nav').exists()).toBe(false);
    const input = wrapper.get('input');
    expect((input.element as HTMLInputElement).value).toBe('K7P2-9QXM');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(api.callsTo(`POST ${AGENT}/join`)[0]?.body).toEqual({ code: 'K7P2-9QXM' });
    await vi.waitFor(() => expect(wrapper.find('[data-card="preview"]').exists()).toBe(true), { timeout: 10_000 });
    expect(wrapper.find('.project-nav').exists()).toBe(true);
    wrapper.unmount();
  });

  it('turns the agent on by itself when the owner opens a project migrated from v1', async () => {
    const { wrapper, api } = await mountProject(
      {
        'GET /api/projects': { body: { projects: [summary({ mode: 'managed', runtime: null })] } },
        'POST /api/projects/p1/runtime/enable': { status: 201, body: { started: true } },
        'GET /api/projects/p1/runtime': {
          body: { status: 'ready', error: null, previewUrl: 'https://p.example', botUsername: null, version: '1' },
        },
        'GET /api/me/agent': { body: { agent: NO_AGENT } },
      },
      '/projects/p1/agente',
    );

    // The menu is there (without an agent item: the chat opens beside the site); the agent page, reached by its
    // address, sets the runtime up, with no button to press, instead of the chat.
    expect(navLinks(wrapper)).not.toContain('Agente');
    expect(wrapper.find('.chat').exists()).toBe(false);
    expect(api.callsTo(`GET ${AGENT}/state`)).toHaveLength(0);
    expect(button(wrapper, 'Ativar o agente')).toBeUndefined();
    expect(api.callsTo('POST /api/projects/p1/runtime/enable')).toHaveLength(1);
    // Without agent settings, the activation points to them instead of asking for a key.
    await vi.waitFor(() => expect(wrapper.find('[data-phase="agent"]').exists()).toBe(true), { timeout: 10_000 });
    expect(wrapper.get('[data-phase="agent"] a').attributes('href')).toBe('/account/agente');
    wrapper.unmount();

    // A failure leaves a button to try again
    const overview = await mountProject({
      'GET /api/projects': { body: { projects: [summary({ mode: 'managed', runtime: null })] } },
      'POST /api/projects/p1/runtime/enable': { status: 500, body: { error: 'Internal error.' } },
    });
    expect(button(overview.wrapper, 'Ativar o agente')).toBeDefined();
    expect(overview.wrapper.get('[data-card="agent"]').text()).toContain('Só deploys');
    overview.wrapper.unmount();
  });

  it('sends the owner of a project hosted by bohr to the subscription when it is not paid for', async () => {
    const { wrapper } = await mountProject({
      'GET /api/projects': { body: { projects: [summary({ mode: 'managed', runtime: null })] } },
      'POST /api/projects/p1/runtime/enable': {
        status: 402,
        body: { error: 'Hosting with bohr needs an active subscription.' },
      },
    });

    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('precisa de uma assinatura ativa');
    expect(wrapper.get('a[href="/billing"]').text()).toBe('Ver a assinatura');
    wrapper.unmount();
  });

  it('says why the agent waits when the Cloudflare account cannot run Containers, and checks again', async () => {
    const { wrapper, api } = await mountProject({
      'GET /api/projects': { body: { projects: [summary({ mode: 'byo', runtime: null })] } },
      'POST /api/projects/p1/runtime/enable': [
        {
          status: 422,
          body: {
            error: "The agent's sandbox is a Cloudflare Container: the account needs the Workers Paid plan.",
            code: 'containers_unavailable',
          },
        },
        { status: 201, body: { started: true } },
      ],
      'GET /api/projects/p1/runtime': {
        body: { status: 'provisioning', error: null, previewUrl: null, botUsername: null, version: null },
      },
    });
    await flushPromises();

    const notice = wrapper.get('[data-notice="containers"]');
    expect(wrapper.text()).toContain('O agente precisa do plano Workers Paid');
    expect(notice.text()).toContain('Containers: Edit');
    // The panel's own words, not the instance's (nor Cloudflare's) error
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("The agent's sandbox");

    await button(wrapper, 'Verificar de novo')?.trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/projects/p1/runtime/enable')).toHaveLength(2);
    expect(wrapper.find('[data-notice="containers"]').exists()).toBe(false);
    expect(wrapper.find('[data-phase="provisioning"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers the owner of a project hosted by bohr to move it, on the overview and in the settings', async () => {
    const deployOnly = await mountProject({
      'GET /api/projects': { body: { projects: [summary({ mode: 'managed', runtime: null })] } },
    });
    expect(deployOnly.wrapper.find('[data-move="available"]').exists()).toBe(true);
    expect(deployOnly.wrapper.text()).toContain('Hospedado pela bohr');
    deployOnly.wrapper.unmount();

    const settings = await mountProject(
      { 'GET /api/projects': { body: { projects: [summary({ mode: 'managed' })] } } },
      '/projects/p1/configuracoes/hospedagem',
    );
    expect(navLinks(settings.wrapper)).toContain('Hospedagem');
    expect(current(settings.wrapper)).toBe('Hospedagem');
    expect(settings.wrapper.find('[data-move="available"]').exists()).toBe(true);
    settings.wrapper.unmount();
  });

  it('does not offer the move to members, nor for projects in the owner’s account', async () => {
    const member = await mountProject({
      'GET /api/projects': { body: { projects: [summary({ mode: 'managed', runtime: null, role: 'member' })] } },
    });
    expect(member.wrapper.find('[data-move]').exists()).toBe(false);
    expect(member.wrapper.text()).toContain('Só o dono do projeto pode ativar o agente.');
    expect(button(member.wrapper, 'Ativar o agente')).toBeUndefined();
    expect(member.api.callsTo('GET /api/projects/p1/move')).toHaveLength(0);
    member.wrapper.unmount();

    const own = await mountProject({}, '/projects/p1/configuracoes/hospedagem');
    expect(navLinks(own.wrapper)).not.toContain('Hospedagem');
    expect(own.wrapper.find('[data-move]').exists()).toBe(false);
    expect(own.wrapper.text()).toContain('rodam na sua conta da Cloudflare');
    expect(own.api.callsTo('GET /api/projects/p1/move')).toHaveLength(0);
    own.wrapper.unmount();
  });

  it('lets the owner invite and remove members', async () => {
    const { wrapper, api } = await mountProject(
      {
        [`POST ${AGENT}/invites`]: { body: { code: 'K7P2-9QXM', expiresAt: '2026-10-12T12:00:00.000Z' } },
        [`DELETE ${AGENT}/members/tg%3A42`]: { body: { revoked: true } },
      },
      '/projects/p1/membros',
    );

    await button(wrapper, 'Gerar código de convite')?.trigger('click');
    await flushPromises();
    expect(wrapper.get('.invite__code').text()).toBe('K7P2-9QXM');

    await wrapper
      .findAll('button')
      .find((candidate) => candidate.attributes('aria-label') === 'Remover Bia')
      ?.trigger('click');
    await flushPromises();
    dialogButton('Remover')?.click();
    await flushPromises();

    expect(api.callsTo(`DELETE ${AGENT}/members/tg%3A42`)).toHaveLength(1);
    wrapper.unmount();
  });

  it('shows members the member list only', async () => {
    const { wrapper } = await mountProject(
      { [`GET ${AGENT}/state`]: { body: projectState({ you: { key: 'tg:42', role: 'member' } }) } },
      '/projects/p1/membros',
    );

    expect(wrapper.text()).toContain('Ana Lima');
    expect(button(wrapper, 'Gerar código de convite')).toBeUndefined();
    expect(button(wrapper, 'Remover')).toBeUndefined();
    wrapper.unmount();
  });

  it('lists what blocks the project on its overview: the agent, a failed setup and no builds yet', async () => {
    const { wrapper, api } = await mountProject({
      'GET /api/projects': {
        body: { projects: [summary({ runtime: { status: 'error', previewUrl: null, botUsername: null } })] },
      },
      'GET /api/me/agent': { body: { agent: NO_AGENT } },
      'GET /api/projects/p1/builds': { body: { builds: [] } },
      'GET /api/projects/p1/runtime': {
        body: {
          status: 'error',
          error: 'Containers are not enabled.',
          previewUrl: null,
          botUsername: null,
          version: null,
        },
      },
      'POST /api/projects/p1/runtime/retry': { body: { started: true } },
    });

    const checklist = () => wrapper.get('[data-card="checklist"]');
    await vi.waitFor(() =>
      expect(
        checklist()
          .findAll('[data-item]')
          .map((item) => item.attributes('data-item')),
      ).toEqual(['agentMissing', 'runtimeError', 'noBuilds']),
    );
    expect(checklist().get('a[href="/account/agente"]').text()).toBe('Configurar o agente');
    expect(checklist().find('a[href="/projects/p1/builds"]').exists()).toBe(true);
    await vi.waitFor(() => expect(checklist().text()).toContain('Containers are not enabled.'), { timeout: 10_000 });

    await checklist()
      .findAll('button')
      .find((candidate) => candidate.text() === 'Tentar de novo')
      ?.trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/projects/p1/runtime/retry')).toHaveLength(1);
    wrapper.unmount();
  });

  it('offers the owner to prepare a repository the agent never prepared', async () => {
    const state = projectState();
    const { wrapper, api } = await mountProject({
      [`GET ${AGENT}/state`]: { body: { ...state, project: { ...state.project, importStatus: 'failed' } } },
      'GET /api/me/agent': { body: { agent: { ...NO_AGENT, configured: true, provider: 'subscription' } } },
      'GET /api/projects/p1/builds': { body: { builds: [build()] } },
      'POST /api/projects/p1/runtime/import': { body: { started: true } },
    });

    const checklist = () => wrapper.get('[data-card="checklist"]');
    await vi.waitFor(
      () =>
        expect(
          checklist()
            .findAll('[data-item]')
            .map((item) => item.attributes('data-item')),
        ).toEqual(['notPrepared']),
      { timeout: 10_000 },
    );
    expect(checklist().text()).toContain('Repositório não preparado');
    expect(checklist().text()).toContain('A última preparação não terminou.');

    await checklist()
      .findAll('button')
      .find((candidate) => candidate.text() === 'Preparar repositório')
      ?.trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/projects/p1/runtime/import')).toHaveLength(1);
    wrapper.unmount();
  });

  it('says the repository is being prepared, and where to follow it, while the import runs', async () => {
    const state = projectState();
    const { wrapper } = await mountProject({
      [`GET ${AGENT}/state`]: { body: { ...state, project: { ...state.project, importStatus: 'running' } } },
      'GET /api/me/agent': { body: { agent: { ...NO_AGENT, configured: true, provider: 'subscription' } } },
      'GET /api/projects/p1/builds': { body: { builds: [] } },
    });

    const checklist = () => wrapper.get('[data-card="checklist"]');
    await vi.waitFor(
      () =>
        expect(
          checklist()
            .findAll('[data-item]')
            .map((item) => item.attributes('data-item')),
        ).toEqual(['preparing']),
      { timeout: 10_000 },
    );
    expect(checklist().text()).toContain('Preparando o repositório');
    expect(checklist().find('a').attributes('href')).toBe('/projects/p1/agente');
    wrapper.unmount();
  });

  it("checks an organization's project against the organization's agent, and links to its settings", async () => {
    const { wrapper, api } = await mountProject({
      'GET /api/projects': (call) => ({
        body: { projects: call.query.get('org') === 'acme' ? [summary({ org: ACME })] : [] },
      }),
      'GET /api/projects/p1': projectDetail('member', ACME),
      'GET /api/orgs/acme/agent': { body: { agent: NO_AGENT } },
      'GET /api/me/agent': { body: { agent: { ...NO_AGENT, configured: true, provider: 'anthropic' } } },
      'GET /api/projects/p1/builds': { body: { builds: [build()] } },
    });

    const checklist = () => wrapper.get('[data-card="checklist"]');
    await vi.waitFor(() => expect(checklist().find('[data-item="agentMissing"]').exists()).toBe(true), {
      timeout: 10_000,
    });
    expect(checklist().text()).toContain('nas configurações da organização');
    expect(checklist().get('a[href="/orgs/acme/configuracoes"]').text()).toBe('Configurar o agente');
    expect(api.callsTo('GET /api/me/agent')).toEqual([]);
    wrapper.unmount();
  });

  it('shows no checklist when nothing blocks the project', async () => {
    const { wrapper, api } = await mountProject({
      'GET /api/me/agent': { body: { agent: { ...NO_AGENT, configured: true, provider: 'anthropic' } } },
      'GET /api/projects/p1/builds': { body: { builds: [build()] } },
    });

    await vi.waitFor(() => expect(api.callsTo('GET /api/projects/p1/builds')).toHaveLength(1), { timeout: 10_000 });
    await flushPromises();
    expect(wrapper.find('[data-card="checklist"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('the overview’s site, as in bohr v1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  const stage = (wrapper: Wrapper) => wrapper.get('.site-stage');
  const bar = (wrapper: Wrapper) => wrapper.get('[data-site-bar]');
  const routeOf = (wrapper: Wrapper) => (wrapper.vm as unknown as { $router: Router }).$router.currentRoute.value;

  it('shows production tilted beside its last deploy, and opens it full screen with the bar, in the same frame', async () => {
    const { wrapper } = await mountProject({
      'GET /api/projects/p1/builds': {
        body: { builds: [build({ branch: 'feature' }), build({ id: 102, title: 'Rodapé novo' })] },
      },
    });

    const card = wrapper.get('[data-card="production"]');
    const frame = card.get('iframe');
    expect(frame.attributes('src')).toBe('https://loja.example.com');
    expect(frame.attributes('tabindex')).toBe('-1');
    await vi.waitFor(() => expect(card.text()).toContain('Rodapé novo'), { timeout: 10_000 });
    expect(card.text()).toContain('Produção');
    expect(card.get('a[href="https://github.com/acme/loja/commit/abc1234def5678"]').text()).toBe('abc1234');
    expect(card.find('a[href="/projects/p1/builds?run=102"]').exists()).toBe(false);
    // The bar waits above the screen, out of reach
    expect(bar(wrapper).attributes('inert')).toBeDefined();

    // The tilted preview is a button: Enter, Space or a click opens it
    await card.get('button[aria-label="Ver loja.example.com em tela cheia"]').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project-site'), { timeout: 10_000 });
    await flushPromises();
    expect(routeOf(wrapper).path).toBe('/projects/p1/site');
    expect(stage(wrapper).classes()).toContain('is-full');
    expect(wrapper.get('[data-card="production"] iframe').element).toBe(frame.element);
    expect(frame.attributes('tabindex')).toBeUndefined();
    expect(bar(wrapper).attributes('inert')).toBeUndefined();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Fechar a visualização');
    // The rest of the overview lies under the view
    expect(wrapper.get('.overview__rest').attributes('inert')).toBeDefined();
    // None of v1's editing tools
    const labels = bar(wrapper)
      .findAll('button, a')
      .map((control) => control.attributes('aria-label') ?? control.text());
    expect(labels).toEqual([
      'Fechar a visualização',
      'Computador',
      'Tablet',
      'Celular',
      'Chat',
      'Abrir https://loja.example.com em nova aba',
      'Abrir o repositório acme/loja no GitHub',
      'Fechar a visualização',
    ]);

    // Escape closes it, back on the overview with the preview button focused
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project'), { timeout: 10_000 });
    await flushPromises();
    expect(stage(wrapper).classes()).not.toContain('is-full');
    expect(document.activeElement?.classList.contains('site-stage__open')).toBe(true);
    expect(wrapper.get('[data-card="production"] iframe').element).toBe(frame.element);

    // So does the bar's close button
    await card.get('.site-stage__open').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project-site'), { timeout: 10_000 });
    await bar(wrapper).findAll('button').at(-1)?.trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project'), { timeout: 10_000 });
    wrapper.unmount();
  });

  it('opens from a link with the chat beside it, switches to the preview and keeps both in the URL', async () => {
    const { wrapper } = await mountProject({}, '/projects/p1/site?chat=1');

    await vi.waitFor(() => expect(wrapper.find('[data-chat-drawer] .chat').exists()).toBe(true), { timeout: 10_000 });
    expect(stage(wrapper).classes()).toEqual(expect.arrayContaining(['is-full', 'has-chat', 'is-instant']));
    const drawer = wrapper.get('[data-chat-drawer]');
    expect(drawer.classes()).toContain('is-docked');
    expect(drawer.text()).toContain('Projeto criado.');
    // The agent page's chat, on the project page's feed: one conversation
    expect(wrapper.findAll('.chat')).toHaveLength(1);

    await bar(wrapper).get('select').setValue('preview');
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({ deploy: 'preview', chat: '1' }), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe(
      'https://loja-preview.example.workers.dev',
    );

    // Escape in the chat closes only the chat; the bar's button opens it again
    await drawer.trigger('keydown', { key: 'Escape' });
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({ deploy: 'preview' }), { timeout: 10_000 });
    expect(routeOf(wrapper).name).toBe('project-site');
    await flushPromises();
    expect(wrapper.find('[data-chat-drawer]').exists()).toBe(false);
    await bar(wrapper).get('[data-site-chat]').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({ deploy: 'preview', chat: '1' }), {
      timeout: 10_000,
    });

    // Closing goes back to the overview, which shows production again
    await bar(wrapper).get('.site-bar__logo').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project'), { timeout: 10_000 });
    expect(routeOf(wrapper).query).toEqual({});
    await flushPromises();
    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe('https://loja.example.com');
    wrapper.unmount();
  });

  it('switches the view to the preview when the chat opens beside it', async () => {
    const { wrapper } = await mountProject({}, '/projects/p1/site');
    await flushPromises();
    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe('https://loja.example.com');

    await bar(wrapper).get('[data-site-chat]').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({ deploy: 'preview', chat: '1' }), {
      timeout: 10_000,
    });
    await flushPromises();
    expect(bar(wrapper).get('select').element.value).toBe('preview');
    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe(
      'https://loja-preview.example.workers.dev',
    );

    // Production can still be chosen with the chat open; closing the chat keeps it
    await bar(wrapper).get('select').setValue('production');
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({ chat: '1' }), { timeout: 10_000 });
    await bar(wrapper).get('[data-site-chat]').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).query).toEqual({}), { timeout: 10_000 });
    wrapper.unmount();
  });

  it('says beside the selector whether the preview is the same as production or has changes', async () => {
    const same = await mountProject({}, '/projects/p1/site');
    await flushPromises();
    expect(bar(same.wrapper).get('[data-preview-diff]').text()).toBe('Igual à produção');
    expect(bar(same.wrapper).get('[data-preview-diff]').attributes('title')).toBeUndefined();
    same.wrapper.unmount();

    const changed = await mountProject(
      {
        [`GET ${AGENT}/state`]: {
          body: projectState({
            homolog: {
              status: 'pending',
              version: 4,
              headSha: 'abc',
              changes: [
                { requestId: 'r1', summary: 'Botão verde' },
                { requestId: 'r2', summary: 'Rodapé novo' },
              ],
            },
          }),
        },
      },
      '/projects/p1/site',
    );
    await flushPromises();
    const diff = bar(changed.wrapper).get('[data-preview-diff]');
    expect(diff.text()).toBe('Com 2 alterações');
    expect(diff.classes()).toContain('is-pending');
    expect(diff.attributes('title')).toBe(['• Botão verde', '• Rodapé novo'].join(String.fromCharCode(10)));
    changed.wrapper.unmount();
  });

  it('opens the preview from its card, and says why there is none yet', async () => {
    const { wrapper } = await mountProject({});
    await flushPromises();
    await wrapper.get('[data-open-preview]').trigger('click');
    await vi.waitFor(() => expect(routeOf(wrapper).name).toBe('project-site'), { timeout: 10_000 });
    expect(routeOf(wrapper).query).toEqual({ deploy: 'preview' });
    wrapper.unmount();

    const state = projectState();
    const unset = await mountProject({
      [`GET ${AGENT}/state`]: { body: { ...state, project: { ...state.project, previewState: 'not_configured' } } },
    });
    await flushPromises();
    expect(bar(unset.wrapper).find('[data-preview-diff]').exists()).toBe(false);
    await unset.wrapper.get('[data-open-preview]').trigger('click');
    await flushPromises();
    expect(routeOf(unset.wrapper).name).toBe('project');
    expect(useToast().toasts.map((toast) => toast.message)).toContain(
      'A homologação ainda não está configurada: o agente prepara isso ao importar o repositório.',
    );
    unset.wrapper.unmount();
  });

  it('turns the agent on in the chat panel of a project that only deploys and has nothing deployed yet', async () => {
    const { wrapper, api } = await mountProject(
      {
        'GET /api/projects': {
          body: { projects: [summary({ mode: 'managed', runtime: null, productionUrl: null })] },
        },
        'POST /api/projects/p1/runtime/enable': { status: 201, body: { started: true } },
        'GET /api/projects/p1/runtime': {
          body: { status: 'ready', error: null, previewUrl: 'https://p.example', botUsername: null, version: '1' },
        },
        'GET /api/me/agent': { body: { agent: NO_AGENT } },
      },
      '/projects/p1?chat=1',
    );

    expect(wrapper.get('[data-site-empty]').text()).toContain('Nada publicado ainda');
    expect(wrapper.find('[data-card="production"] iframe').exists()).toBe(false);
    const drawer = wrapper.get('[data-chat-drawer]');
    expect(drawer.classes()).not.toContain('is-docked');
    await vi.waitFor(() => expect(drawer.find('[data-phase="agent"]').exists()).toBe(true), { timeout: 10_000 });
    // Only the panel sets the runtime up
    expect(api.callsTo('POST /api/projects/p1/runtime/enable')).toHaveLength(1);
    expect(wrapper.findAll('.activation')).toHaveLength(1);

    await drawer.get('button[aria-label="Fechar o chat"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[data-chat-drawer]').exists()).toBe(false), { timeout: 10_000 });
    expect(routeOf(wrapper).query).toEqual({});
    wrapper.unmount();
  });

  it('offers no chat to members of a project that only deploys', async () => {
    const { wrapper } = await mountProject(
      { 'GET /api/projects': { body: { projects: [summary({ role: 'member', runtime: null })] } } },
      '/projects/p1?chat=1',
    );

    expect(wrapper.get('[data-card="production"] iframe').attributes('src')).toBe('https://loja.example.com');
    expect(wrapper.find('[data-overview-chat]').exists()).toBe(false);
    expect(wrapper.find('[data-chat-drawer]').exists()).toBe(false);
    expect(wrapper.find('[data-site-chat]').exists()).toBe(false);
    wrapper.unmount();
  });
});
