import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession, setFarewell } from '../session';
import { createTestContext, type FakeRoute, fakeApi, ME } from '../test-utils';
import LoginPage from './LoginPage.vue';

const SIGNED_OUT = { status: 401, body: { error: 'Not signed in.' } };

interface MountOptions {
  instance?: unknown;
  methods?: unknown;
  me?: FakeRoute | FakeRoute[];
  path?: string;
  routes?: Record<string, FakeRoute | FakeRoute[]>;
}

async function mountLogin(options: MountOptions = {}) {
  const api = fakeApi({
    'GET /api/me': options.me ?? SIGNED_OUT,
    'GET /api/instance': { body: options.instance ?? instance() },
    'GET /auth/methods': { body: options.methods ?? { github: true, email: true } },
    ...options.routes,
  });
  await loadSession(true).catch(() => null);
  const context = await createTestContext(options.path ?? '/login?redirect=%2Fprojects%2Fp1');
  const wrapper = mount(LoginPage, { global: { plugins: [...context.plugins] }, attachTo: document.body });
  await flushPromises();
  return { ...context, wrapper, api };
}

const instance = (overrides: object = {}) => ({
  setup: { githubApp: true, platformBot: true },
  billing: false,
  telegramBot: 'bohr_platform_bot',
  githubAppSlug: 'bohr-test',
  ...overrides,
});

type Wrapper = Awaited<ReturnType<typeof mountLogin>>['wrapper'];

const button = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((item) => item.text() === text);

async function askForCode(wrapper: Wrapper, email = 'ana@example.com') {
  await wrapper.get('input[type="email"]').setValue(email);
  await wrapper.get('[data-method="email"] form').trigger('submit');
  await flushPromises();
}

describe('sign-in page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  it('offers GitHub and email, and no Telegram sign-in', async () => {
    const { wrapper, missing } = await mountLogin();
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));

    expect(wrapper.get('h1').text()).toContain('Peça mais,');
    expect(hrefs).toContain('/auth/github?redirect=%2Fprojects%2Fp1');
    expect(hrefs.some((href) => href?.includes('telegram') || href?.includes('t.me'))).toBe(false);
    expect(wrapper.text()).not.toContain('Telegram');
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(button(wrapper, 'Receber código por e-mail')).toBeDefined();
    expect(missing).toEqual([]);
  });

  it('shows only the methods the instance offers', async () => {
    const emailOnly = await mountLogin({ methods: { github: false, email: true } });
    expect(emailOnly.wrapper.findAll('a').some((link) => link.attributes('href')?.startsWith('/auth/github'))).toBe(
      false,
    );
    expect(emailOnly.wrapper.find('input[type="email"]').exists()).toBe(true);
    emailOnly.wrapper.unmount();

    const githubOnly = await mountLogin({ methods: { github: true, email: false } });
    expect(githubOnly.wrapper.find('input[type="email"]').exists()).toBe(false);
    expect(githubOnly.wrapper.find('a[href^="/auth/github"]').exists()).toBe(true);
  });

  it('falls back to GitHub when the instance does not say which methods it has', async () => {
    const { wrapper } = await mountLogin({ routes: { 'GET /auth/methods': { status: 500, body: {} } } });

    expect(wrapper.find('a[href^="/auth/github"]').exists()).toBe(true);
    expect(wrapper.find('input[type="email"]').exists()).toBe(false);
  });

  it('points an instance that is not set up yet to /setup', async () => {
    const { wrapper } = await mountLogin({
      instance: instance({ setup: { githubApp: false, platformBot: false }, telegramBot: null }),
    });

    expect(wrapper.get('a[href="/setup"]').text()).toBe('Abrir a configuração');
    const github = wrapper.findAll('a').find((link) => link.text().includes('Entrar com GitHub'));
    expect(github?.attributes('aria-disabled')).toBe('true');
    expect(github?.attributes('href')).toBeUndefined();
  });

  it('ignores redirects to other sites', async () => {
    const { wrapper } = await mountLogin({ path: '/login?redirect=https%3A%2F%2Fevil.example.com' });

    expect(wrapper.findAll('a').map((link) => link.attributes('href'))).toContain('/auth/github?redirect=%2Fprojects');
  });

  it('sends a signed-in user straight on', async () => {
    const { router } = await mountLogin({ me: { body: ME }, path: '/login?redirect=%2Faccount' });

    // The account page is loaded lazily, so the navigation ends a little later.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/account'), { timeout: 10_000 });
  });

  it('signs in with a code sent by email, pasted with spaces', async () => {
    const { wrapper, api, router } = await mountLogin({
      me: [SIGNED_OUT, { body: ME }],
      routes: {
        'POST /auth/email/start': { body: { sent: true } },
        'POST /auth/email/verify': { body: { redirect: '/projects/p1' } },
      },
    });

    await askForCode(wrapper, ' ana@example.com ');

    expect(api.callsTo('POST /auth/email/start')[0]?.body).toEqual({
      email: 'ana@example.com',
      redirect: '/projects/p1',
      locale: 'pt-BR',
    });
    expect(wrapper.text()).toContain('Enviamos um código de 6 dígitos para ana@example.com');
    const code = wrapper.get('input[name="code"]');
    expect(code.attributes('autocomplete')).toBe('one-time-code');
    expect(code.attributes('inputmode')).toBe('numeric');
    const resend = wrapper.get('[data-action="resend"]');
    expect(resend.attributes('disabled')).toBeDefined();
    expect(resend.text()).toBe('Reenviar código em 60 s');
    // Only in the demo.
    expect(wrapper.find('[data-hint="demo"]').exists()).toBe(false);

    await code.setValue('123 456');
    await flushPromises();

    expect(api.callsTo('POST /auth/email/verify')[0]?.body).toEqual({ email: 'ana@example.com', code: '123456' });
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/projects/p1'), { timeout: 10_000 });
    expect(api.callsTo('GET /api/me')).toHaveLength(2);
  });

  it('says how many attempts are left after a wrong code', async () => {
    const { wrapper } = await mountLogin({
      routes: {
        'POST /auth/email/start': { body: { sent: true } },
        'POST /auth/email/verify': { status: 400, body: { error: 'Wrong code.', attemptsLeft: 2 } },
      },
    });

    await askForCode(wrapper);
    await wrapper.get('input[name="code"]').setValue('111111');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Código incorreto. Tentativas restantes: 2.');
    expect((wrapper.get('input[name="code"]').element as HTMLInputElement).value).toBe('');
  });

  it('goes back to the address when the code expired', async () => {
    const { wrapper } = await mountLogin({
      routes: {
        'POST /auth/email/start': { body: { sent: true } },
        'POST /auth/email/verify': { status: 410, body: { error: 'The code expired.' } },
      },
    });

    await askForCode(wrapper);
    await wrapper.get('input[name="code"]').setValue('999999');
    await flushPromises();

    expect(wrapper.find('input[name="code"]').exists()).toBe(false);
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('O código venceu ou foi digitado errado vezes demais.');
  });

  it('explains an invalid address and too many attempts', async () => {
    const { wrapper, api } = await mountLogin({
      routes: {
        'POST /auth/email/start': [
          { status: 400, body: { error: 'Invalid email.' } },
          { status: 429, body: { error: 'Too many requests.' } },
        ],
      },
    });

    await askForCode(wrapper, 'not-an-email');
    expect(wrapper.get('[role="alert"]').text()).toBe('Digite um endereço de e-mail válido.');
    expect(api.callsTo('POST /auth/email/start')).toHaveLength(0);

    await askForCode(wrapper, 'ana@example');
    // No dot after the @: refused before calling the instance.
    expect(api.callsTo('POST /auth/email/start')).toHaveLength(0);

    await askForCode(wrapper, 'ana@example.com');
    expect(wrapper.get('[role="alert"]').text()).toBe('Digite um endereço de e-mail válido.');
    await askForCode(wrapper, 'ana@example.com');
    expect(wrapper.get('[role="alert"]').text()).toBe('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  });

  it('can switch to another address', async () => {
    const { wrapper } = await mountLogin({ routes: { 'POST /auth/email/start': { body: { sent: true } } } });

    await askForCode(wrapper);
    await wrapper.get('[data-action="other-email"]').trigger('click');

    expect(wrapper.find('input[name="code"]').exists()).toBe(false);
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('');
  });

  it('tells the demo code in the demo only', async () => {
    vi.stubEnv('MODE', 'demo');
    const { wrapper } = await mountLogin({ routes: { 'POST /auth/email/start': { body: { sent: true } } } });

    await askForCode(wrapper);

    expect(wrapper.get('[data-hint="demo"]').text()).toBe('Demonstração: use o código 123456.');
  });

  it('says goodbye after the account was deleted', async () => {
    setFarewell(['site Worker loja: not found']);
    const { wrapper } = await mountLogin();

    const notice = wrapper.get('[data-notice="farewell"]');
    expect(notice.text()).toContain('Conta excluída');
    expect(notice.text()).toContain('site Worker loja: not found');
  });
});
