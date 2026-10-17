import { useToast } from '@bohr/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveView } from '../../api';
import { createTestI18n, type FakeRoute, fakeApi, onboarding } from '../../test-utils';
import MoveToCloudflare from './MoveToCloudflare.vue';

const MOVE = '/api/projects/p1/move';
const CONNECTIONS = [
  { id: 'c1', accountId: 'acc-1', accountName: 'Acme' },
  { id: 'c2', accountId: 'acc-2', accountName: null },
];
const PULL = { number: 7, url: 'https://github.com/acme/loja/pull/7' };

const prepared = (hostnames: Extract<MoveView, { script: string }>['hostnames'] = []): MoveView => ({
  status: 'prepared',
  script: 'loja',
  accountId: 'acc-1',
  pullRequest: PULL,
  hostnames,
});

async function mountMove(routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi(routes);
  const { i18n, missing } = createTestI18n();
  const wrapper = mount(MoveToCloudflare, {
    props: { projectId: 'p1' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return { api, wrapper, missing };
}

const button = (wrapper: Awaited<ReturnType<typeof mountMove>>['wrapper'], text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);
const dialogButton = (text: string) =>
  [...(document.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
/** "hostname status" for each address in the result list. */
const hostnames = (wrapper: Awaited<ReturnType<typeof mountMove>>['wrapper']) =>
  wrapper.findAll('.move__hostname').map((row) =>
    row
      .findAll('span')
      .map((span) => span.text())
      .join(' '),
  );
const phase = (wrapper: Awaited<ReturnType<typeof mountMove>>['wrapper']) =>
  wrapper.get('[data-move]').attributes('data-move');

describe('moving a project to the owner’s Cloudflare account', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('prepares the pull request, waits for the merge, then moves the domains', async () => {
    const { api, wrapper, missing } = await mountMove({
      [`GET ${MOVE}`]: { body: { move: { status: 'available' }, connections: CONNECTIONS } },
      [`POST ${MOVE}`]: { body: { move: prepared() } },
      [`POST ${MOVE}/complete`]: [
        { status: 409, body: { error: 'Merge pull request #7 first.' } },
        {
          body: {
            move: prepared([
              { hostname: 'loja.com.br', status: 'pending' },
              { hostname: 'loja.bohr.io', status: 'redirected' },
            ]),
          },
        },
        {
          body: {
            move: {
              ...prepared([
                { hostname: 'loja.com.br', status: 'moved' },
                { hostname: 'loja.bohr.io', status: 'redirected' },
                { hostname: 'dev.loja.bohr.io', status: 'dropped' },
              ]),
              status: 'done',
            },
          },
        },
      ],
    });

    // Available: explains the move and lists the connected accounts, the first one chosen.
    expect(wrapper.get('h2').text()).toBe('Hospedado pela bohr');
    expect(wrapper.text()).toContain('ainda está hospedado na conta da Cloudflare da bohr');
    expect(wrapper.findAll('input[type="radio"]').map((radio) => (radio.element as HTMLInputElement).checked)).toEqual([
      true,
      false,
    ]);
    expect(wrapper.text()).toContain('acc-2');

    // Asks before preparing; cancelling sends nothing.
    await wrapper.findAll('input[type="radio"]')[1]?.setValue(true);
    await button(wrapper, 'Preparar a mudança')?.trigger('click');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('acc-2');
    dialogButton('Cancelar')?.click();
    await flushPromises();
    expect(api.callsTo(`POST ${MOVE}`)).toHaveLength(0);

    await wrapper.findAll('input[type="radio"]')[0]?.setValue(true);
    await button(wrapper, 'Preparar a mudança')?.trigger('click');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Acme');
    dialogButton('Preparar a mudança')?.click();
    await flushPromises();

    expect(api.callsTo(`POST ${MOVE}`)[0]?.body).toEqual({ connectionId: 'c1' });
    expect(phase(wrapper)).toBe('prepared');
    expect(wrapper.text()).toContain('O pull request #7 está aberto');
    expect(wrapper.get(`a[href="${PULL.url}"]`).text()).toBe('Abrir #7 no GitHub');

    // Not merged yet: the reason, and the button to try again.
    await button(wrapper, 'Concluir a mudança')?.trigger('click');
    await flushPromises();
    const alert = wrapper.get('[role="alert"]').text();
    expect(alert).toContain('Ainda não dá para concluir');
    expect(alert).toContain('Merge pull request #7 first.');
    expect(phase(wrapper)).toBe('prepared');

    // A domain whose zone is not in the account yet: what to do about it.
    await button(wrapper, 'Concluir a mudança')?.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('alguns domínios ainda dependem de você');
    expect(hostnames(wrapper)).toEqual(['loja.com.br Pendente', 'loja.bohr.io Redireciona']);
    expect(wrapper.text()).toContain('aponte os nameservers dele para a Cloudflare');
    expect(wrapper.emitted('moved')).toBeUndefined();

    // Completing again once the zone is there finishes the move.
    await button(wrapper, 'Concluir a mudança')?.trigger('click');
    await flushPromises();
    expect(api.callsTo(`POST ${MOVE}/complete`)).toHaveLength(3);
    expect(phase(wrapper)).toBe('done');
    expect(wrapper.get('h2').text()).toBe('Na sua conta da Cloudflare');
    expect(wrapper.text()).toContain('O projeto agora roda na sua conta da Cloudflare (Acme)');
    expect(hostnames(wrapper)).toEqual([
      'loja.com.br Na sua conta',
      'loja.bohr.io Redireciona',
      'dev.loja.bohr.io Desativado',
    ]);
    expect(wrapper.text()).toContain('agora redirecionam para o novo endereço');
    expect(wrapper.text()).not.toContain('nameservers');
    expect(button(wrapper, 'Concluir a mudança')).toBeUndefined();
    expect(wrapper.emitted('moved')).toHaveLength(1);
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('explains why the move could not be prepared', async () => {
    const reason =
      '.github/workflows/bohr-deploy.yml is not the workflow the bohr migration created. Change its deploy step to `npx wrangler deploy` by hand.';
    const { wrapper } = await mountMove({
      [`GET ${MOVE}`]: { body: { move: { status: 'available' }, connections: CONNECTIONS } },
      [`POST ${MOVE}`]: { status: 409, body: { error: reason } },
    });

    await button(wrapper, 'Preparar a mudança')?.trigger('click');
    dialogButton('Preparar a mudança')?.click();
    await flushPromises();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(phase(wrapper)).toBe('available');
    const alert = wrapper.get('[role="alert"]').text();
    expect(alert).toContain('Não foi possível preparar a mudança automaticamente.');
    expect(alert).toContain('by hand');
    wrapper.unmount();
  });

  it('connects a Cloudflare account first when there is none', async () => {
    const { api, wrapper } = await mountMove({
      [`GET ${MOVE}`]: [
        { body: { move: { status: 'available' }, connections: [] } },
        { body: { move: { status: 'available' }, connections: [CONNECTIONS[0]] } },
      ],
      'GET /api/onboarding': { body: onboarding({ step: 'done' }) },
      'POST /api/onboarding/cloudflare': {
        body: { status: 'choose_account', accounts: [{ id: 'acc-1', name: 'Acme' }] },
      },
      'POST /api/onboarding/cloudflare/account': {
        body: { status: 'connected', connectionId: 'c1', accountName: 'Acme' },
      },
    });

    expect(wrapper.text()).toContain('conecte uma conta da Cloudflare abaixo');
    expect(button(wrapper, 'Preparar a mudança')).toBeUndefined();
    expect(wrapper.get('a[href*="dash.cloudflare.com"]').attributes('target')).toBe('_blank');

    await wrapper.get('input[type="password"]').setValue('x'.repeat(40));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/onboarding/cloudflare')[0]?.body).toEqual({ token: 'x'.repeat(40) });

    // More than one account behind the token: pick it, as in the wizard.
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/onboarding/cloudflare/account')[0]?.body).toEqual({ accountId: 'acc-1' });

    expect(api.callsTo(`GET ${MOVE}`)).toHaveLength(2);
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect((wrapper.get('input[type="radio"]').element as HTMLInputElement).checked).toBe(true);
    expect(button(wrapper, 'Preparar a mudança')?.attributes('disabled')).toBeUndefined();
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Conta Acme conectada.');
    wrapper.unmount();
  });

  it('shows nothing for a project that cannot move', async () => {
    const { wrapper } = await mountMove({
      [`GET ${MOVE}`]: { body: { move: { status: 'unavailable' }, connections: [] } },
    });

    expect(wrapper.find('[data-move]').exists()).toBe(false);
    wrapper.unmount();
  });
});
