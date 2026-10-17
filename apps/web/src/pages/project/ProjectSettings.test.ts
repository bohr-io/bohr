import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Domains, Protection, Variable } from '../../api';
import { loadSession } from '../../session';
import { type FakeRoute, fakeApi, ME, mountAt, projectState, projectSummary } from '../../test-utils';

const P = '/api/projects/p1';

async function mountSettings(page: string, routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects: [projectSummary()] } },
    [`GET ${P}/agent/state`]: { body: projectState() },
    [`GET ${P}/agent/messages`]: { body: { messages: [], last: 0 } },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(`/projects/p1/configuracoes/${page}`);
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountSettings>>['wrapper'];

const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);
const dialogButton = (text: string) =>
  [...(document.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent?.trim() === text,
  );

const variable = (key: string, overrides: Partial<Variable> = {}): Variable => ({
  key,
  target: 'runtime',
  secret: false,
  value: 'valor',
  updatedAt: '2026-10-10T12:00:00.000Z',
  ...overrides,
});

const VARIABLES: Variable[] = [
  variable('API_URL', { value: 'https://api.loja.com' }),
  variable('STRIPE_KEY', { secret: true, value: null }),
  variable('NODE_VERSION', { target: 'build', value: '22' }),
];

/** The rows of a variables card: [name, value, secret]. */
function rows(wrapper: Wrapper, target: 'runtime' | 'build') {
  return wrapper.findAll(`[data-target="${target}"] fieldset`).map((row) => {
    const [name, value] = row.findAll('input:not([type="checkbox"])').map((input) => input.element as HTMLInputElement);
    return { row, name, value, secret: row.get('input[type="checkbox"]') };
  });
}

describe('project settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  describe('environment variables', () => {
    it('edits, adds and removes the site variables, then saves what changed', async () => {
      const { wrapper, api, missing } = await mountSettings('variaveis', {
        [`GET ${P}/variables`]: { body: { variables: VARIABLES, canEdit: true } },
        [`PUT ${P}/variables`]: { body: { variables: VARIABLES } },
        [`DELETE ${P}/variables`]: { body: { variables: VARIABLES } },
      });

      expect(wrapper.text()).toContain('Variáveis do site');
      expect(wrapper.text()).toContain('Variáveis do build');
      const site = rows(wrapper, 'runtime');
      expect(site.map((row) => row.name?.value)).toEqual(['API_URL', 'STRIPE_KEY']);
      // A secret cannot be read back: its field is empty, with a hint.
      expect(site[1]?.value?.value).toBe('');
      expect(site[1]?.value?.type).toBe('password');
      expect(site[1]?.value?.placeholder).toContain('Valor oculto');
      expect(rows(wrapper, 'build').map((row) => row.name?.value)).toEqual(['NODE_VERSION']);

      // Change a value, remove the secret (kept as it is otherwise), add a secret one.
      await site[0]?.row.findAll('input')[1]?.setValue('https://api2.loja.com');
      await site[1]?.row.get('button[aria-label="Remover STRIPE_KEY"]').trigger('click');
      await wrapper
        .get('[data-target="runtime"]')
        .findAll('button')
        .find((b) => b.text() === 'Nova variável')
        ?.trigger('click');
      const added = rows(wrapper, 'runtime')[1];
      await added?.row.findAll('input')[0]?.setValue('SENTRY_DSN');
      await added?.row.findAll('input')[1]?.setValue('https://sentry.example/1');
      await added?.secret.setValue(true);

      await wrapper
        .get('[data-target="runtime"]')
        .findAll('button')
        .find((b) => b.text() === 'Salvar')
        ?.trigger('click');
      await flushPromises();

      expect(api.callsTo(`DELETE ${P}/variables`).map((call) => Object.fromEntries(call.query))).toEqual([
        { target: 'runtime', key: 'STRIPE_KEY' },
      ]);
      expect(api.callsTo(`PUT ${P}/variables`).map((call) => call.body)).toEqual([
        { target: 'runtime', key: 'API_URL', value: 'https://api2.loja.com', secret: false },
        { target: 'runtime', key: 'SENTRY_DSN', value: 'https://sentry.example/1', secret: true },
      ]);
      expect(useToast().toasts.map((toast) => toast.message)).toContain('Configurações do projeto salvas.');
      expect(missing).toEqual([]);
      wrapper.unmount();
    });

    it('checks names and secrets before saving', async () => {
      const { wrapper, api } = await mountSettings('variaveis', {
        [`GET ${P}/variables`]: { body: { variables: VARIABLES, canEdit: true } },
      });
      const site = rows(wrapper, 'runtime');
      // Renaming a secret needs its value again; a name bohr uses is refused.
      await site[1]?.row.findAll('input')[0]?.setValue('STRIPE_SECRET');
      await site[0]?.row.findAll('input')[0]?.setValue('GITHUB_TOKEN');
      await wrapper
        .get('[data-target="runtime"]')
        .findAll('button')
        .find((b) => b.text() === 'Salvar')
        ?.trigger('click');
      await flushPromises();

      const errors = wrapper.findAll('[data-target="runtime"] .variables__error').map((error) => error.text());
      expect(errors).toEqual([
        'GITHUB_TOKEN é um nome que a bohr ou o GitHub já usam.',
        'Digite o valor de novo: o de uma variável secreta não pode ser lido.',
      ]);
      expect(api.callsTo(`PUT ${P}/variables`)).toHaveLength(0);
      wrapper.unmount();
    });

    it('shows why the instance refused a variable', async () => {
      const { wrapper } = await mountSettings('variaveis', {
        [`GET ${P}/variables`]: { body: { variables: VARIABLES, canEdit: true } },
        [`PUT ${P}/variables`]: {
          status: 409,
          body: { error: "The site's Worker (loja) is not deployed yet. Publish the site once, then try again." },
        },
      });

      await rows(wrapper, 'build')[0]?.row.findAll('input')[1]?.setValue('24');
      await wrapper
        .get('[data-target="build"]')
        .findAll('button')
        .find((b) => b.text() === 'Salvar')
        ?.trigger('click');
      await flushPromises();

      const alert = wrapper.get('[data-target="build"] .variables__failure').text();
      expect(alert).toContain('Não foi possível salvar NODE_VERSION.');
      expect(alert).toContain('Publish the site once');
      // The edit stays, to try again.
      expect(rows(wrapper, 'build')[0]?.value?.value).toBe('24');
      wrapper.unmount();
    });

    it('shows members the names and plain values only', async () => {
      const { wrapper } = await mountSettings('variaveis', {
        [`GET ${P}/variables`]: { body: { variables: VARIABLES, canEdit: false } },
      });

      expect(wrapper.text()).toContain('Só o dono do projeto muda as variáveis.');
      expect(wrapper.find('[data-target="runtime"] input').exists()).toBe(false);
      expect(wrapper.text()).toContain('https://api.loja.com');
      expect(button(wrapper, 'Salvar')).toBeUndefined();
      wrapper.unmount();
    });
  });

  describe('authentication', () => {
    const BASIC: Protection = {
      type: 'basic',
      users: [{ username: 'ana' }],
      bypassPaths: ['/api/public/*'],
      warning: null,
    };

    it('keeps the stored passwords and sends the new ones', async () => {
      const { wrapper, api } = await mountSettings('autenticacao', {
        [`GET ${P}/protection`]: { body: { protection: BASIC, canEdit: true } },
        [`PUT ${P}/protection`]: {
          body: { protection: { ...BASIC, users: [{ username: 'ana' }, { username: 'bia' }] } },
        },
      });

      expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('basic');
      const password = wrapper.findAll('input[type="password"]')[0];
      expect(password?.attributes('placeholder')).toBe('Senha mantida — digite para trocar');

      await button(wrapper, 'Novo usuário')?.trigger('click');
      const fields = wrapper.findAll('fieldset')[1]?.findAll('input');
      await fields?.[0]?.setValue('bia');
      // A new user needs a password.
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.get('.auth__problems').text()).toContain('Defina uma senha para bia.');
      expect(api.callsTo(`PUT ${P}/protection`)).toHaveLength(0);

      await fields?.[1]?.setValue('s3nha-forte');
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(api.callsTo(`PUT ${P}/protection`)[0]?.body).toEqual({
        type: 'basic',
        users: [{ username: 'ana' }, { username: 'bia', password: 's3nha-forte' }],
        bypassPaths: ['/api/public/*'],
      });
      expect(useToast().toasts.map((toast) => toast.message)).toContain('Configurações do projeto salvas.');
      wrapper.unmount();
    });

    it('turns the protection off, and warns when the site deploys with its own command', async () => {
      const { wrapper, api } = await mountSettings('autenticacao', {
        [`GET ${P}/protection`]: { body: { protection: { ...BASIC, warning: 'custom_deploy' }, canEdit: true } },
        [`PUT ${P}/protection`]: {
          body: { protection: { type: 'none', users: [], bypassPaths: [], warning: 'custom_deploy' } },
        },
      });

      expect(wrapper.text()).toContain('A proteção não vale para este site');
      expect(wrapper.text()).toContain('deploy.json');
      await wrapper.get('select').setValue('none');
      expect(wrapper.find('input[type="password"]').exists()).toBe(false);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(api.callsTo(`PUT ${P}/protection`)[0]?.body).toEqual({ type: 'none', users: [], bypassPaths: [] });
      wrapper.unmount();
    });
  });

  describe('domains', () => {
    const OWN: Domains = {
      hosting: 'own',
      deployed: true,
      worker: 'loja',
      workersDev: 'https://loja.ana.workers.dev',
      domains: [{ id: 'd1', hostname: 'loja.com.br' }],
      zones: [
        { name: 'loja.com.br', status: 'active' },
        { name: 'outra.dev', status: 'pending' },
      ],
      canEdit: true,
    };

    it('adds a domain under a zone of the account and removes one after confirming', async () => {
      const { wrapper, api } = await mountSettings('dominios', {
        [`GET ${P}/domains`]: { body: OWN },
        [`POST ${P}/domains`]: [
          { status: 409, body: { error: 'No zone in your Cloudflare account covers www.loja.com.br.' } },
          { status: 201, body: { ...OWN, domains: [...OWN.domains, { id: 'd2', hostname: 'www.loja.com.br' }] } },
        ],
        [`DELETE ${P}/domains/d1`]: { body: { ...OWN, domains: [] } },
      });

      expect(wrapper.find('a[href="https://loja.ana.workers.dev"]').exists()).toBe(true);
      expect(wrapper.findAll('.domains__host').map((host) => host.text())).toEqual(['loja.com.br']);
      expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['loja.com.br', 'outra.dev (pending)']);

      await wrapper.get('input').setValue('www');
      expect(wrapper.text()).toContain('O site vai abrir em www.loja.com.br.');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain('No zone in your Cloudflare account');

      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(api.callsTo(`POST ${P}/domains`).map((call) => call.body)).toEqual([
        { hostname: 'www.loja.com.br' },
        { hostname: 'www.loja.com.br' },
      ]);
      expect(wrapper.findAll('.domains__host').map((host) => host.text())).toEqual(['loja.com.br', 'www.loja.com.br']);

      await wrapper.get('button[aria-label="Remover loja.com.br"]').trigger('click');
      await flushPromises();
      expect(api.callsTo(`DELETE ${P}/domains/d1`)).toHaveLength(0);
      dialogButton('Remover')?.click();
      await flushPromises();
      expect(api.callsTo(`DELETE ${P}/domains/d1`)).toHaveLength(1);
      wrapper.unmount();
    });

    it('explains that the site needs its first deploy', async () => {
      const { wrapper } = await mountSettings('dominios', {
        [`GET ${P}/domains`]: {
          body: {
            hosting: 'own',
            deployed: false,
            worker: null,
            workersDev: null,
            domains: [],
            zones: [],
            canEdit: true,
          },
        },
      });
      expect(wrapper.text()).toContain('O site ainda não foi publicado');
      expect(wrapper.find('form').exists()).toBe(false);
      wrapper.unmount();
    });

    it('lists the domains of a project bohr hosts, read-only, with the way to move it', async () => {
      const { wrapper } = await mountSettings('dominios', {
        'GET /api/projects': { body: { projects: [projectSummary({ mode: 'managed' })] } },
        [`GET ${P}/domains`]: {
          body: {
            hosting: 'bohr',
            domains: [{ id: 'loja.com.br', hostname: 'loja.com.br', status: 'live' }],
            canEdit: false,
          },
        },
      });
      expect(wrapper.text()).toContain('Enquanto a bohr hospeda este projeto');
      expect(wrapper.text()).toContain('No ar');
      const move = wrapper.findAll('a').find((anchor) => anchor.text() === 'Mover para a minha conta da Cloudflare');
      expect(move?.attributes('href')).toBe('/projects/p1/configuracoes/hospedagem');
      expect(wrapper.find('form').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('danger zone', () => {
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    const nameInput = () => dialog()?.querySelector<HTMLInputElement>('input[type="text"]');

    async function type(value: string) {
      const input = nameInput();
      if (!input) throw new Error('No name field.');
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await flushPromises();
    }

    it('deletes the project once its name is typed, with the site in the owner’s account if asked', async () => {
      const { wrapper, api, router, missing } = await mountSettings('geral', {
        [`DELETE ${P}`]: { body: { warnings: ['site Worker: Not found.'] } },
      });

      const card = wrapper.get('[data-card="danger"]');
      expect(card.text()).toContain('Zona de perigo');
      await button(wrapper, 'Excluir projeto')?.trigger('click');
      await flushPromises();

      expect(dialog()?.textContent).toContain('Excluir Loja?');
      expect(dialog()?.textContent).toContain('O repositório no GitHub não é alterado.');
      expect(dialog()?.textContent).toContain('@BotFather');
      expect(dialog()?.textContent).toContain('continua no ar');
      expect(dialogButton('Excluir projeto')?.disabled).toBe(true);

      await type('loja');
      expect(dialogButton('Excluir projeto')?.disabled).toBe(true);
      await type('Loja');
      const checkbox = dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      checkbox?.click();
      await flushPromises();
      expect(dialog()?.textContent).not.toContain('continua no ar');
      dialogButton('Excluir projeto')?.click();
      await flushPromises();

      expect(api.callsTo(`DELETE ${P}`)[0]?.body).toEqual({ confirm: 'Loja', deleteSite: true });
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('projects'), { timeout: 10_000 });
      const toasts = useToast().toasts.map((toast) => toast.message);
      expect(toasts).toContain('Projeto Loja excluído.');
      expect(toasts.find((message) => message.includes('site Worker: Not found.'))).toBeDefined();
      expect(missing).toEqual([]);
      wrapper.unmount();
    });

    it('offers the site only for projects in the owner’s account, and shows a refusal', async () => {
      const { wrapper, api } = await mountSettings('geral', {
        'GET /api/projects': { body: { projects: [projectSummary({ mode: 'managed' })] } },
        [`DELETE ${P}`]: { status: 400, body: { error: 'Type the project name to confirm.' } },
      });

      await button(wrapper, 'Excluir projeto')?.trigger('click');
      await flushPromises();
      expect(dialog()?.querySelector('input[type="checkbox"]')).toBeNull();
      await type('Loja');
      dialogButton('Excluir projeto')?.click();
      await flushPromises();

      expect(api.callsTo(`DELETE ${P}`)[0]?.body).toEqual({ confirm: 'Loja', deleteSite: false });
      expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Type the project name to confirm.');
      wrapper.unmount();
    });

    it('is for the owner only', async () => {
      const { wrapper } = await mountSettings('geral', {
        'GET /api/projects': { body: { projects: [projectSummary({ role: 'member' })] } },
        [`GET ${P}/agent/state`]: { body: projectState({ you: { key: 'tg:42', role: 'member' } }) },
      });

      expect(wrapper.find('[data-card="danger"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
