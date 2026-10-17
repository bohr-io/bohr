import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings, OrgDetail, OrgMember, OrgStatus } from '../api';
import { orgs, resetOrgs, setContext } from '../orgs';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt, projectSummary } from '../test-utils';

const READY: OrgStatus = { subscription: true, cloudflare: true, agent: true, installation: true };
const NONE: AgentSettings = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  effort: null,
  keyHint: null,
};
const TOKEN = 'a'.repeat(40);
const KEY = `sk-ant-api03-${'x'.repeat(30)}`;

function org(overrides: Partial<OrgDetail['org']> = {}, billing: Partial<OrgDetail['billing']> = {}): OrgDetail {
  return {
    org: {
      id: 'o_1',
      slug: 'acme',
      name: 'Acme Inc',
      avatarUrl: null,
      githubLogin: 'Acme',
      role: 'admin',
      status: READY,
      membersPermission: true,
      ...overrides,
    },
    billing: { enabled: true, subscribed: true, ...billing },
  };
}

function member(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    githubUserId: 1,
    githubLogin: 'ana',
    name: 'Ana Lima',
    email: 'ana@example.com',
    userId: 'u_1',
    role: 'admin',
    status: 'active',
    source: 'github',
    ...overrides,
  };
}

const MEMBERS = [
  member(),
  member({ githubUserId: 2, githubLogin: 'bruno', name: 'Bruno', email: null, userId: 'u_2', role: 'member' }),
  member({
    githubUserId: 3,
    githubLogin: 'carla',
    name: null,
    email: null,
    userId: null,
    role: 'member',
    status: 'pending',
  }),
];

async function mountOrg(path: string, routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/orgs': { body: { orgs: [org().org] } },
    'GET /api/projects': { body: { projects: [] } },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(path);
  await flushPromises();
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountOrg>>['wrapper'];

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dialogButton = (text: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === text);
const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);
const row = (wrapper: Wrapper, login: string) => wrapper.get(`[data-member="${login}"]`);
/** happy-dom does not match attribute selectors whose value has "=" in it. */
const hasLink = (wrapper: Wrapper, href: string) =>
  wrapper.findAll('a').some((link) => link.attributes('href') === href);

describe('organization pages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useToast().clear();
    resetOrgs();
    setContext(null);
    document.body.innerHTML = '';
  });

  it("lists the organization's projects and remembers it as the context", async () => {
    const { wrapper, api, missing } = await mountOrg('/orgs/acme', {
      'GET /api/orgs/acme': { body: org() },
      'GET /api/projects': (call) => ({
        body: { projects: call.query.get('org') === 'acme' ? [projectSummary({ id: 'p7', name: 'Site Acme' })] : [] },
      }),
    });

    expect(wrapper.get('h1').text()).toContain('Acme Inc');
    expect(wrapper.get('a[href="https://github.com/Acme"]').text()).toBe('github.com/Acme');
    expect(wrapper.find('[data-setup]').exists()).toBe(false);
    expect(wrapper.findAll('.project-card').map((card) => card.find('h2').text())).toEqual(['Site Acme']);
    expect(api.callsTo('GET /api/projects')[0]?.query.get('org')).toBe('acme');
    expect(hasLink(wrapper, '/projects/new?org=acme')).toBe(true);
    // Its pages are in the main bar (App.vue), not in a menu of the page
    expect(wrapper.find('.project-nav').exists()).toBe(false);
    expect(orgs.context).toBe('acme');
    expect(missing).toEqual([]);
  });

  it('says when the organization does not exist or the user is not a member', async () => {
    setContext('nope');
    const { wrapper } = await mountOrg('/orgs/nope', {
      'GET /api/orgs/nope': { status: 404, body: { error: 'Not found.' } },
    });

    expect(wrapper.get('[data-card="not-found"]').text()).toContain('Organização não encontrada');
    expect(orgs.context).toBeNull();
  });

  it('walks an admin through the setup: subscription, Cloudflare and agent', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const unpaid = org(
      { status: { ...READY, subscription: false, cloudflare: false, agent: false } },
      { subscribed: false },
    );
    const { wrapper, api, missing } = await mountOrg('/orgs/acme', {
      'GET /api/orgs/acme': { body: unpaid },
      'POST /api/orgs/acme/billing/checkout': { body: { url: 'https://checkout.stripe.com/c/pay/cs_org' } },
    });

    expect(wrapper.get('[data-setup] [data-view]').attributes('data-view')).toBe('subscription');
    expect(wrapper.findAll('.wizard-progress__label').map((label) => label.text())).toEqual([
      'Assinatura',
      'Cloudflare',
      'Agente',
    ]);
    // Without the subscription and Cloudflare, there is no way to a new project yet.
    expect(hasLink(wrapper, '/projects/new?org=acme')).toBe(false);

    await button(wrapper, 'Assinar')?.trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/orgs/acme/billing/checkout')).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_org');
    expect(missing).toEqual([]);
  });

  it('connects the Cloudflare account and the agent of the organization, then hides the setup', async () => {
    const paid = { ...READY, cloudflare: false, agent: false };
    const { wrapper, api } = await mountOrg('/orgs/acme', {
      'GET /api/orgs/acme': [
        { body: org({ status: paid }) },
        { body: org({ status: { ...paid, cloudflare: true } }) },
        { body: org() },
      ],
      'GET /api/orgs/acme/cloudflare': {
        body: { connections: [], tokenTemplateUrl: 'https://dash.cloudflare.com/profile/api-tokens?org' },
      },
      'POST /api/orgs/acme/cloudflare': {
        body: { status: 'choose_account', accounts: [{ id: 'acc_1', name: 'Acme Cloudflare' }] },
      },
      'POST /api/orgs/acme/cloudflare/account': {
        body: { status: 'connected', connectionId: 'cf_9', accountName: 'Acme Cloudflare' },
      },
      'GET /api/orgs/acme/agent': { body: { agent: NONE } },
      'PUT /api/orgs/acme/agent': {
        body: {
          agent: { ...NONE, configured: true, provider: 'anthropic', keyHint: '…xxxx' },
          projects: { applied: 0, failed: 0 },
        },
      },
    });
    const view = () => wrapper.get('[data-setup] [data-view]').attributes('data-view');

    expect(view()).toBe('cloudflare');
    expect(hasLink(wrapper, 'https://dash.cloudflare.com/profile/api-tokens?org')).toBe(true);
    await wrapper.get('[data-setup] input[type="password"]').setValue(TOKEN);
    await wrapper.get('[data-setup] form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/orgs/acme/cloudflare')[0]?.body).toEqual({ token: TOKEN });

    expect(wrapper.get('[data-setup]').text()).toContain('Acme Cloudflare');
    await wrapper.get('[data-setup] form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/orgs/acme/cloudflare/account')[0]?.body).toEqual({ accountId: 'acc_1' });

    await vi.waitFor(() => expect(view()).toBe('agent'), { timeout: 10_000 });
    await flushPromises();
    await wrapper.get('[data-setup] input[type="password"]').setValue(KEY);
    await wrapper.get('[data-setup] form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('PUT /api/orgs/acme/agent')[0]?.body).toMatchObject({ provider: 'anthropic', apiKey: KEY });
    expect(api.callsTo('PUT /api/me/agent')).toHaveLength(0);

    await vi.waitFor(() => expect(wrapper.find('[data-setup]').exists()).toBe(false), { timeout: 10_000 });
    expect(hasLink(wrapper, '/projects/new?org=acme')).toBe(true);
  });

  it('tells members that an admin still has to set the organization up', async () => {
    const { wrapper } = await mountOrg('/orgs/acme', {
      'GET /api/orgs/acme': { body: org({ role: 'member', status: { ...READY, cloudflare: false } }) },
    });

    expect(wrapper.find('[data-setup]').exists()).toBe(false);
    expect(wrapper.find('[data-notice="not-ready"]').exists()).toBe(true);
  });

  it('lets admins change roles, remove members and sync with GitHub', async () => {
    const { wrapper, api, missing } = await mountOrg('/orgs/acme/membros', {
      'GET /api/orgs/acme': { body: org({ membersPermission: false }) },
      'GET /api/orgs/acme/members': [
        { body: { members: MEMBERS } },
        { body: { members: [MEMBERS[0], { ...MEMBERS[1], role: 'admin', source: 'bohr' }, MEMBERS[2]] } },
      ],
      'PUT /api/orgs/acme/members/2': {
        body: { members: [MEMBERS[0], { ...MEMBERS[1], role: 'admin', source: 'bohr' }, MEMBERS[2]] },
      },
      'PUT /api/orgs/acme/members/1': {
        status: 409,
        body: { error: "This is the organization's last admin; make someone else an admin before demoting them." },
      },
      'DELETE /api/orgs/acme/members/3': { body: { members: MEMBERS.slice(0, 2) } },
      'POST /api/orgs/acme/members/sync': {
        body: { members: MEMBERS.slice(0, 2), added: 1, removed: 0, updated: 2, membersPermission: true },
      },
    });

    // Without Members: read, only the installer was imported.
    expect(wrapper.get('[data-notice="permission"]').text()).toContain('Members: read');
    expect(wrapper.findAll('[data-member]').map((entry) => entry.attributes('data-member'))).toEqual([
      'ana',
      'bruno',
      'carla',
    ]);
    expect(row(wrapper, 'ana').text()).toContain('Você');
    expect(row(wrapper, 'carla').get('[data-status]').text()).toBe('Pendente');
    expect(row(wrapper, 'bruno').get('[data-role]').text()).toBe('Membro');

    await row(wrapper, 'bruno').get('[data-action="role"]').trigger('click');
    await flushPromises();
    expect(api.callsTo('PUT /api/orgs/acme/members/2')[0]?.body).toEqual({ role: 'admin' });
    expect(row(wrapper, 'bruno').get('[data-role]').text()).toBe('Admin');
    expect(row(wrapper, 'bruno').get('[data-source]').text()).toBe('Alterado na bohr');

    await row(wrapper, 'ana').get('[data-action="role"]').trigger('click');
    await flushPromises();
    expect(useToast().toasts.map((toast) => toast.message)).toContain(
      'A organização precisa de pelo menos um admin. Torne outra pessoa admin primeiro.',
    );

    await row(wrapper, 'carla').get('[data-action="remove"]').trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Remover carla?');
    dialogButton('Remover')?.click();
    await flushPromises();
    expect(api.callsTo('DELETE /api/orgs/acme/members/3')).toHaveLength(1);

    await wrapper.get('[data-action="sync"]').trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/orgs/acme/members/sync')).toHaveLength(1);
    expect(useToast().toasts.map((toast) => toast.message)).toContain(
      'Membros sincronizados: 1 adicionados, 0 removidos, 2 atualizados.',
    );
    expect(wrapper.findAll('[data-member]')).toHaveLength(2);
    expect(missing).toEqual([]);
  });

  it('shows why the instance sent the user back to the new organization page (?error=)', async () => {
    const { wrapper, router, missing } = await mountOrg(
      `/orgs/new?error=${encodeURIComponent('The GitHub App was installed on a personal account, not on an organization.')}`,
      {},
    );

    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Não foi possível criar a organização: The GitHub App was installed on a personal account, not on an organization.',
    );
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({}), { timeout: 10_000 });
    expect(missing).toEqual([]);
  });

  it('shows the members without actions to members', async () => {
    const { wrapper } = await mountOrg('/orgs/acme/membros', {
      'GET /api/orgs/acme': { body: org({ role: 'member' }) },
      'GET /api/orgs/acme/members': { body: { members: MEMBERS } },
    });

    expect(wrapper.findAll('[data-member]')).toHaveLength(3);
    expect(wrapper.find('[data-action="role"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="remove"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="sync"]').exists()).toBe(false);
    expect(wrapper.find('[data-notice="permission"]').exists()).toBe(false);
  });

  it('deletes the organization from its settings after the slug is typed', async () => {
    setContext('acme');
    const { wrapper, api, router, missing } = await mountOrg('/orgs/acme/configuracoes', {
      'GET /api/orgs/acme': { body: org() },
      'GET /api/orgs/acme/cloudflare': {
        body: {
          connections: [{ id: 'cf_1', accountId: 'acc_1', accountName: 'Acme Cloudflare', projects: 2 }],
          tokenTemplateUrl: 'https://dash.cloudflare.com/profile/api-tokens',
        },
      },
      'GET /api/orgs/acme/agent': {
        body: { agent: { ...NONE, configured: true, provider: 'anthropic', keyHint: '…a1b2' } },
      },
      'DELETE /api/orgs/acme': { body: { warnings: [] } },
      'GET /api/onboarding': { body: { step: 'done' } },
    });

    expect(wrapper.get('[data-card="general"]').text()).toContain('Acme Inc');
    expect(wrapper.get('[data-card="cloudflare"]').text()).toContain('Acme Cloudflare');
    // How many of the organization's projects run in the account
    expect(wrapper.get('[data-card="cloudflare"]').text()).toContain('Projetos: 2');
    expect(wrapper.find('[data-card="billing"] [data-action="portal"]').exists()).toBe(true);

    await wrapper.get('[data-action="delete-org"]').trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Excluir Acme Inc?');
    expect(dialogButton('Excluir organização')?.disabled).toBe(true);

    const input = dialog()?.querySelector<HTMLInputElement>('input[type="text"]');
    const sites = dialog()?.querySelector<HTMLInputElement>('input[name="deleteSites"]');
    if (input === null || input === undefined || sites === null || sites === undefined) throw new Error('No fields.');
    input.value = 'acm';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    expect(dialogButton('Excluir organização')?.disabled).toBe(true);
    input.value = 'acme';
    input.dispatchEvent(new Event('input'));
    sites.click();
    await flushPromises();
    expect(dialogButton('Excluir organização')?.disabled).toBe(false);

    dialogButton('Excluir organização')?.click();
    await flushPromises();
    expect(api.callsTo('DELETE /api/orgs/acme')[0]?.body).toEqual({ confirm: 'acme', deleteSites: true });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('projects'), { timeout: 10_000 });
    expect(orgs.context).toBeNull();
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Organização Acme Inc excluída.');
    expect(missing).toEqual([]);
  });
});
