import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings, Connections } from '../api';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt } from '../test-utils';

const AGENT: AgentSettings = {
  configured: true,
  provider: 'anthropic',
  baseUrl: null,
  model: null,
  effort: null,
  keyHint: '…a1b2',
};

function connections(overrides: Partial<Connections> = {}): Connections {
  return {
    identities: [{ provider: 'email', username: 'ana@example.com', canRemove: false }],
    githubInstallations: [
      { id: 41001, account: 'ana', projects: 2 },
      { id: 41002, account: 'acme', projects: 0 },
    ],
    cloudflare: [{ id: 'cf_1', accountId: 'abc123', accountName: 'Ana', projects: 0 }],
    telegram: { username: 'ana_tg' },
    agent: AGENT,
    subscription: null,
    ...overrides,
  };
}

async function mountAccount(routes: Record<string, FakeRoute | FakeRoute[]> = {}, path = '/account') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/me/connections': { body: connections() },
    'GET /api/billing': { status: 404, body: { error: 'Not found.' } },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(path);
  await flushPromises();
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountAccount>>['wrapper'];

const card = (wrapper: Wrapper, name: string) => wrapper.get(`[data-card="${name}"]`);
const buttonIn = (element: ReturnType<Wrapper['get']>, text: string) =>
  element.findAll('button').find((candidate) => candidate.text() === text);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dialogButton = (text: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === text);
const toasts = () => useToast().toasts.map((toast) => toast.message);

describe('account page: connected accounts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('lists the sign-in methods, GitHub App installations, Cloudflare accounts, Telegram and the agent', async () => {
    const { wrapper, missing } = await mountAccount();

    expect(wrapper.text()).toContain('Contas conectadas');
    const signIn = card(wrapper, 'sign-in');
    // GitHub sign-in is not connected: linking it goes through /auth/github and comes back here.
    expect(signIn.get('[data-provider="github"] a').attributes('href')).toBe('/auth/github?link=1&redirect=%2Faccount');
    // The only way to sign in cannot be removed.
    const email = signIn.get('[data-provider="email"]');
    expect(email.text()).toContain('ana@example.com');
    expect(email.get('button').attributes('disabled')).toBeDefined();
    expect(email.get('[title]').attributes('title')).toContain('única forma de entrar');

    expect(card(wrapper, 'github-app').text()).toContain('ana');
    expect(card(wrapper, 'github-app').text()).toContain('Projetos: 2');
    expect(card(wrapper, 'cloudflare').text()).toContain('abc123');
    expect(card(wrapper, 'telegram').text()).toContain('@ana_tg');
    expect(card(wrapper, 'agent').text()).toContain('…a1b2');
    expect(card(wrapper, 'agent').get('a').attributes('href')).toBe('/account/agente');
    expect(missing).toEqual([]);
  });

  it('shows the 409 of a GitHub App installation that projects still use', async () => {
    const { wrapper, api } = await mountAccount({
      'DELETE /api/me/github-installations/41001': {
        status: 409,
        body: { projects: ['Loja', 'Blog'], error: 'These projects use this installation: Loja, Blog.' },
      },
    });

    await buttonIn(card(wrapper, 'github-app'), 'Desconectar')?.trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('desinstala o app do GitHub da conta ana');
    dialogButton('Desconectar')?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/me/github-installations/41001')).toHaveLength(1);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      'These projects use this installation: Loja, Blog.',
    );
  });

  it('disconnects a Cloudflare account and says to delete its API token too', async () => {
    const { wrapper, api } = await mountAccount({
      'GET /api/me/connections': [{ body: connections() }, { body: connections({ cloudflare: [] }) }],
      'DELETE /api/me/cloudflare/cf_1': {
        body: { ...connections({ cloudflare: [] }), hint: 'Delete the API token "bohr" in the Cloudflare dashboard.' },
      },
    });

    await buttonIn(card(wrapper, 'cloudflare'), 'Desconectar')?.trigger('click');
    await flushPromises();
    dialogButton('Desconectar')?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/me/cloudflare/cf_1')).toHaveLength(1);
    expect(dialog()).toBeNull();
    expect(card(wrapper, 'cloudflare').get('[data-notice="cloudflare"]').text()).toContain(
      'Delete the API token "bohr" in the Cloudflare dashboard.',
    );
  });

  it('removes a sign-in method, Telegram and the agent after asking', async () => {
    const both = connections({
      identities: [
        { provider: 'github', username: 'ana', canRemove: true },
        { provider: 'email', username: 'ana@example.com', canRemove: true },
      ],
    });
    const { wrapper, api } = await mountAccount({
      'GET /api/me/connections': { body: both },
      'DELETE /api/me/identities/github': { body: connections() },
      'DELETE /api/me/identities/telegram': { body: connections({ telegram: null }) },
      'DELETE /api/me/agent': { body: { agent: { ...AGENT, configured: false } } },
    });

    await card(wrapper, 'sign-in').get('[data-provider="github"] button').trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Remover o login com GitHub?');
    dialogButton('Remover')?.click();
    await flushPromises();

    await buttonIn(card(wrapper, 'telegram'), 'Desconectar')?.trigger('click');
    await flushPromises();
    dialogButton('Desconectar')?.click();
    await flushPromises();

    await buttonIn(card(wrapper, 'agent'), 'Desconectar')?.trigger('click');
    await flushPromises();
    dialogButton('Desconectar')?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/me/identities/github')).toHaveLength(1);
    expect(api.callsTo('DELETE /api/me/identities/telegram')).toHaveLength(1);
    expect(api.callsTo('DELETE /api/me/agent')).toHaveLength(1);
    expect(toasts()).toContain('Login com GitHub removido.');
  });

  it('adds an email sign-in with a code, and says when the address belongs to another account', async () => {
    const { wrapper, api } = await mountAccount({
      'POST /api/me/email/start': { body: { sent: true } },
      'POST /api/me/email/verify': [
        { status: 409, body: { error: 'This email belongs to another account.' } },
        { body: { identity: { provider: 'email', username: 'ana@acme.com' } } },
      ],
      'GET /api/me/connections': {
        body: connections({ identities: [{ provider: 'github', username: 'ana', canRemove: false }] }),
      },
    });

    await buttonIn(card(wrapper, 'sign-in'), 'Adicionar e-mail')?.trigger('click');
    const form = wrapper.get('[data-form="add-email"]');
    await form.get('input[type="email"]').setValue('ana@acme.com');
    await form.get('form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/me/email/start')[0]?.body).toEqual({ email: 'ana@acme.com' });

    await wrapper.get('[data-form="add-email"] input[name="code"]').setValue('123456');
    await flushPromises();
    expect(wrapper.get('[data-form="add-email"] [role="alert"]').text()).toBe(
      'Este e-mail já pertence a outra conta da bohr.',
    );

    await wrapper.get('[data-form="add-email"] input[name="code"]').setValue('654321');
    await flushPromises();
    expect(api.callsTo('POST /api/me/email/verify')[1]?.body).toEqual({ email: 'ana@acme.com', code: '654321' });
    expect(toasts()).toContain('Agora você também entra com ana@acme.com.');
    expect(wrapper.find('[data-form="add-email"]').exists()).toBe(false);
  });

  it('shows the error of linking GitHub as a toast', async () => {
    const { router } = await mountAccount({}, '/account?error=That%20GitHub%20account%20is%20linked%20elsewhere.');

    expect(toasts()).toContain('Não foi possível conectar o GitHub. Detalhe: That GitHub account is linked elsewhere.');
    await vi.waitFor(() => expect(router.currentRoute.value.query.error).toBeUndefined(), { timeout: 10_000 });
  });
});

describe('account page: deleting the account', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('asks for the typed word, deletes everything and says goodbye', async () => {
    const { wrapper, api, router } = await mountAccount({
      'DELETE /api/me': { body: { warnings: ['site Worker loja: not found'] } },
      'GET /api/instance': { body: { setup: { githubApp: true, platformBot: false }, billing: false } },
      'GET /auth/methods': { body: { github: true, email: true } },
    });

    await buttonIn(card(wrapper, 'danger'), 'Excluir conta')?.trigger('click');
    await flushPromises();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('desinstalado');
    expect(text).toContain('Os repositórios no GitHub nunca são alterados.');
    expect(text).toContain('Os bots dos projetos continuam no Telegram.');
    expect(dialogButton('Excluir conta')?.disabled).toBe(true);

    const checkbox = dialog()?.querySelector<HTMLInputElement>('input[name="deleteSites"]');
    checkbox?.click();
    const input = dialog()?.querySelector<HTMLInputElement>('input[name="confirm"]');
    if (input) {
      input.value = 'excluir';
      input.dispatchEvent(new Event('input'));
    }
    await flushPromises();
    expect(dialogButton('Excluir conta')?.disabled).toBe(false);
    dialogButton('Excluir conta')?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/me')[0]?.body).toEqual({ confirm: true, deleteSites: true });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'), { timeout: 10_000 });
    await flushPromises();
    await vi.waitFor(() => expect(document.querySelector('[data-notice="farewell"]')).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(document.querySelector('[data-notice="farewell"]')?.textContent).toContain('site Worker loja: not found');
  });
});
