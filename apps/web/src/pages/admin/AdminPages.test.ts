import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedUser, ProjectRow, Telemetry } from '../../api';
import { loadSession } from '../../session';
import { ADMIN, type FakeRoute, fakeApi, mountAt } from '../../test-utils';

function user(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: 'u_2',
    name: 'Bruno Lima',
    email: 'bruno@example.com',
    role: 'user',
    createdAt: '2026-09-01T12:00:00.000Z',
    identities: [{ provider: 'github', username: 'bruno' }],
    projects: 1,
    subscription: 'active',
    orgs: [],
    ...overrides,
  };
}

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p9',
    name: 'Site do Bruno',
    repository: 'bruno/site',
    owner: { id: 'u_2', name: 'Bruno Lima', email: 'bruno@example.com' },
    mode: 'byo',
    status: 'active',
    createdAt: '2026-09-02T12:00:00.000Z',
    productionUrl: 'https://bruno.example.com',
    runtime: { status: 'error', version: '0.9.1', error: 'Container failed to start.' },
    ...overrides,
  };
}

const TELEMETRY: Telemetry = {
  available: true,
  enabled: false,
  forcedOff: false,
  instanceId: 'inst_123',
  lastSentAt: null,
  endpoint: 'https://telemetry.bohr.io/v1/ping',
  payload: { instanceId: 'inst_123', version: '2.0.0', projects: 4 },
};

async function mountAdmin(path: string, routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({ 'GET /api/me': { body: ADMIN }, 'GET /api/manage/telemetry': { body: TELEMETRY }, ...routes });
  await loadSession(true);
  const mounted = await mountAt(path);
  await flushPromises();
  return { ...mounted, api };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dialogButton = (text: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === text);

describe('admin area', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('shows the overview and updates the runtimes', async () => {
    const { wrapper, api, missing } = await mountAdmin('/admin', {
      'GET /api/manage/overview': {
        body: {
          users: 12,
          projects: 30,
          subscriptions: { active: 9 },
          runtimes: { ready: 20, provisioning: 1, pending: 2, error: 3 },
        },
      },
      'POST /api/manage/runtimes/update': { body: { version: '0.9.3', updating: ['p1', 'p2'] } },
    });

    expect(wrapper.get('[data-stat="users"]').text()).toContain('12');
    expect(wrapper.get('[data-runtime="error"]').text()).toContain('3');
    // The menu has telemetry, since this instance offers it.
    expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual([
      'Visão geral',
      'Usuários',
      'Projetos',
      'Organizações',
      'Telemetria',
    ]);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Atualizar runtimes')
      ?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/manage/runtimes/update')).toHaveLength(1);
    expect(wrapper.get('[data-notice="update"]').text()).toBe('Atualizando 2 runtimes para a versão 0.9.3.');
    expect(missing).toEqual([]);
  });

  it('lists, searches and pages the users', async () => {
    const { wrapper, api, router } = await mountAdmin('/admin/usuarios', {
      'GET /api/manage/users': (call) => ({
        body: {
          users:
            call.query.get('query') === 'bruno' ? [user()] : [user(), user({ id: 'u_1', name: 'Ana', role: 'admin' })],
          total: call.query.get('query') === 'bruno' ? 1 : 120,
        },
      }),
    });

    const rows = wrapper.findAll('[data-table="users"] tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.get('a').attributes('href')).toBe('/admin/usuarios/u_2');
    expect(rows[0]?.text()).toContain('GitHub: bruno');
    expect(rows[0]?.text()).toContain('Ativa');
    expect(rows[1]?.text()).toContain('Admin');
    expect(wrapper.text()).toContain('Página 1 de 3 · 120 no total');

    await wrapper.get('[data-page="next"]').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.query.page).toBe('2'), { timeout: 10_000 });
    await flushPromises();
    expect(api.callsTo('GET /api/manage/users').at(-1)?.query.get('page')).toBe('2');

    await wrapper.get('input[type="search"]').setValue('bruno');
    await wrapper.get('form[role="search"]').trigger('submit');
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ q: 'bruno' }), { timeout: 10_000 });
    await flushPromises();

    const last = api.callsTo('GET /api/manage/users').at(-1);
    expect(last?.query.get('query')).toBe('bruno');
    expect(last?.query.get('page')).toBe('1');
    expect(wrapper.findAll('[data-table="users"] tbody tr')).toHaveLength(1);
  });

  it('lists the projects with their owner, status and runtime', async () => {
    const { wrapper } = await mountAdmin('/admin/projetos', {
      'GET /api/manage/projects': {
        body: {
          projects: [
            project(),
            project({ id: 'p10', status: 'suspended', runtime: null, org: { slug: 'acme', name: 'Acme Inc' } }),
          ],
          total: 2,
        },
      },
    });

    const rows = wrapper.findAll('[data-table="projects"] tbody tr');
    expect(rows[0]?.get('a').attributes('href')).toBe('/projects/p9');
    expect(rows[0]?.find('a[href="/admin/usuarios/u_2"]').exists()).toBe(true);
    expect(rows[0]?.text()).toContain('Erro');
    expect(rows[0]?.text()).toContain('v0.9.1');
    expect(rows[0]?.text()).toContain('Container failed to start.');
    expect(rows[1]?.text()).toContain('Suspenso');
    expect(rows[1]?.text()).toContain('Só publica');
    // Projects of an organization carry its badge.
    expect(rows[0]?.find('[data-org-badge]').exists()).toBe(false);
    expect(rows[1]?.get('[data-org-badge]').text()).toBe('Organização: Acme Inc');
    expect(wrapper.find('[data-page="next"]').exists()).toBe(false);
  });

  it('shows a user, changes their role and deletes their account', async () => {
    const { wrapper, api, router } = await mountAdmin('/admin/usuarios/u_2', {
      'GET /api/manage/users/u_2': {
        body: {
          user: user(),
          projects: [project()],
          orgs: [{ id: 'o_1', slug: 'acme', name: 'Acme Inc', role: 'admin' }],
          connections: {
            githubInstallations: [{ id: 41001, account: 'bruno' }],
            cloudflare: [{ id: 'cf_1', accountId: 'abc', accountName: 'Bruno' }],
            telegram: null,
            agent: { configured: true },
          },
        },
      },
      'PUT /api/manage/users/u_2/role': [
        { body: { user: user({ role: 'admin' }) } },
        { status: 409, body: { error: 'This is the last admin; make someone else an admin first.' } },
      ],
      'DELETE /api/manage/users/u_2': { body: { warnings: [] } },
      'GET /api/manage/users': { body: { users: [], total: 0 } },
    });

    expect(wrapper.text()).toContain('Bruno Lima');
    expect(wrapper.get('[data-card="connections"]').text()).toContain('bruno');
    expect(wrapper.get('[data-fact="orgs"]').text()).toContain('Acme Inc (Admin)');
    expect(wrapper.find('[data-table="projects"]').exists()).toBe(true);

    await wrapper.get('[data-action="role"]').trigger('click');
    await flushPromises();
    expect(api.callsTo('PUT /api/manage/users/u_2/role')[0]?.body).toEqual({ role: 'admin' });
    expect(wrapper.get('[data-action="role"]').text()).toBe('Remover admin');

    await wrapper.get('[data-action="role"]').trigger('click');
    await flushPromises();
    expect(useToast().toasts.map((toast) => toast.message)).toContain('A instância precisa de pelo menos um admin.');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Excluir conta')
      ?.trigger('click');
    await flushPromises();
    const input = dialog()?.querySelector<HTMLInputElement>('input[name="confirm"]');
    if (input) {
      input.value = 'EXCLUIR';
      input.dispatchEvent(new Event('input'));
    }
    await flushPromises();
    dialogButton('Excluir conta')?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/manage/users/u_2')[0]?.body).toEqual({ deleteSites: false });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('admin-users'), { timeout: 10_000 });
  });

  it('shows the telemetry payload and turns it on', async () => {
    const { wrapper, api } = await mountAdmin('/admin/telemetria', {
      'PUT /api/manage/telemetry': { body: { ...TELEMETRY, enabled: true } },
    });

    expect(JSON.parse(wrapper.get('[data-payload]').text())).toEqual(TELEMETRY.payload);
    expect(wrapper.find('a[href="https://github.com/bohr-io/bohr#telemetry"]').exists()).toBe(true);

    await wrapper.get('input[role="switch"]').setValue(true);
    await flushPromises();

    expect(api.callsTo('PUT /api/manage/telemetry')[0]?.body).toEqual({ enabled: true });
    expect(wrapper.get('[data-card="telemetry"]').text()).toContain('Ligada');
  });

  it('says when the operator turned telemetry off for good, and keeps the switch off', async () => {
    const { wrapper } = await mountAdmin('/admin/telemetria', {
      'GET /api/manage/telemetry': { body: { ...TELEMETRY, forcedOff: true } },
    });

    expect(wrapper.get('[data-notice="forced-off"]').text()).toContain('BOHR_TELEMETRY=off');
    expect(wrapper.get('input[role="switch"]').attributes('disabled')).toBeDefined();
  });

  it('hides telemetry on bohr.io Cloud', async () => {
    const { wrapper } = await mountAdmin('/admin/projetos', {
      'GET /api/manage/telemetry': { body: { ...TELEMETRY, available: false } },
      'GET /api/manage/projects': { body: { projects: [], total: 0 } },
    });

    expect(wrapper.findAll('nav a').map((link) => link.text())).not.toContain('Telemetria');
    expect(wrapper.find('[data-empty]').text()).toBe('Nenhum projeto encontrado.');
  });

  it('lists and searches the organizations, with their members, projects and subscription', async () => {
    const { wrapper, api, router, missing } = await mountAdmin('/admin/orgs', {
      'GET /api/manage/orgs': (call) => ({
        body: {
          orgs: [
            { id: 'o_1', slug: 'acme', name: 'Acme Inc', members: 4, projects: 2, subscription: 'active' },
            ...(call.query.get('query') === 'acme'
              ? []
              : [{ id: 'o_2', slug: 'lume', name: 'Café Lume', members: 1, projects: 0, subscription: null }]),
          ],
          total: call.query.get('query') === 'acme' ? 1 : 2,
        },
      }),
      'GET /api/manage/users': {
        body: { users: [user({ orgs: [{ slug: 'acme', name: 'Acme Inc' }] })], total: 1 },
      },
    });

    const rows = wrapper.findAll('[data-table="orgs"] tbody tr');
    expect(rows.map((row) => row.attributes('data-org'))).toEqual(['acme', 'lume']);
    expect(rows[0]?.text()).toContain('Acme Inc');
    expect(rows[0]?.get('a').attributes('href')).toBe('https://github.com/acme');
    expect(rows[0]?.text()).toContain('Ativa');
    expect(rows[1]?.text()).toContain('—');
    expect(wrapper.get('nav [aria-current="page"]').text()).toBe('Organizações');

    await wrapper.get('input[type="search"]').setValue('acme');
    await wrapper.get('form[role="search"]').trigger('submit');
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ q: 'acme' }), { timeout: 10_000 });
    await flushPromises();
    expect(api.callsTo('GET /api/manage/orgs').at(-1)?.query.get('query')).toBe('acme');
    expect(wrapper.findAll('[data-table="orgs"] tbody tr')).toHaveLength(1);

    // The users list shows the organizations of each user.
    await router.push('/admin/usuarios');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.find('[data-table="users"]').exists()).toBe(true), { timeout: 10_000 });
    expect(wrapper.get('[data-table="users"] [data-org-badge]').text()).toBe('Acme Inc');
    expect(missing).toEqual([]);
  });
});
