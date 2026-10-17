import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings } from '../api';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt } from '../test-utils';

const NONE: AgentSettings = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  effort: null,
  keyHint: null,
};
const ANTHROPIC: AgentSettings = { ...NONE, configured: true, provider: 'anthropic', keyHint: '…a1b2' };
const KEY = `sk-ant-api03-${'x'.repeat(30)}`;
const TOKEN = `sk-ant-oat01-${'y'.repeat(40)}`;
// The instance's sign-in container runs it: no project involved
const LOGIN = {
  projectId: null,
  loginId: 'login_0123456789',
  url: 'https://claude.com/cai/oauth/authorize?code=true&state=s',
};
// An instance without the sign-in container runs it in one of the user's projects
const PROJECT_LOGIN = { ...LOGIN, projectId: 'p_loja' };
const SUBSCRIPTION: AgentSettings = { ...NONE, configured: true, provider: 'subscription', keyHint: '…wxyz' };

async function mountAgent(routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({ 'GET /api/me': { body: ME }, ...routes });
  await loadSession(true);
  const mounted = await mountAt('/account/agente');
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountAgent>>['wrapper'];

const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);
const field = (wrapper: Wrapper, label: string) => {
  const id = wrapper
    .findAll('label')
    .find((candidate) => candidate.text().replace('*', '') === label)
    ?.attributes('for');
  return wrapper.get(`#${id}`);
};
const save = async (wrapper: Wrapper) => {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
};

describe('agent settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('saves an Anthropic key with a model and effort, and says where it was applied', async () => {
    const { wrapper, api, missing } = await mountAgent({
      'GET /api/me/agent': { body: { agent: NONE } },
      'PUT /api/me/agent': {
        body: {
          agent: { ...ANTHROPIC, model: 'claude-sonnet-5-5', effort: 'high' },
          projects: { applied: 2, failed: 1 },
        },
      },
    });

    expect(wrapper.text()).toContain('Não configurado');
    expect(wrapper.find('a[href="https://console.anthropic.com/settings/keys"]').exists()).toBe(true);
    expect(wrapper.findAll('datalist option').map((option) => option.attributes('value'))).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
    expect(button(wrapper, 'Remover')).toBeUndefined();

    // The key is required and checked before calling the instance.
    await save(wrapper);
    expect(wrapper.text()).toContain('Cole a chave da API.');
    await wrapper.get('input[type="password"]').setValue('not-a-key');
    await save(wrapper);
    expect(wrapper.text()).toContain('Isso não parece uma chave da API da Anthropic');
    expect(api.callsTo('PUT /api/me/agent')).toHaveLength(0);

    await wrapper.get('input[type="password"]').setValue(KEY);
    await field(wrapper, 'Modelo').setValue('claude-sonnet-5-5');
    await wrapper.get('select').setValue('high');
    await save(wrapper);

    expect(api.callsTo('PUT /api/me/agent')[0]?.body).toEqual({
      provider: 'anthropic',
      apiKey: KEY,
      baseUrl: null,
      model: 'claude-sonnet-5-5',
      effort: 'high',
    });
    const result = wrapper.get('[data-result]').text();
    expect(result).toContain('Salvo e aplicado a 2 projetos.');
    expect(result).toContain('Não foi possível atualizar 1 projeto.');
    expect(wrapper.text()).toContain('Configurado');
    // The key is not shown again: its hint is, and a blank field keeps it.
    expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).toContain('Chave salva: …a1b2.');
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('keeps the stored key when only the model or effort change', async () => {
    const { wrapper, api } = await mountAgent({
      'GET /api/me/agent': { body: { agent: ANTHROPIC } },
      'PUT /api/me/agent': { body: { agent: { ...ANTHROPIC, effort: 'max' }, projects: { applied: 0, failed: 0 } } },
    });

    await wrapper.get('select').setValue('max');
    await save(wrapper);

    expect(api.callsTo('PUT /api/me/agent')[0]?.body).toEqual({
      provider: 'anthropic',
      baseUrl: null,
      model: null,
      effort: 'max',
    });
    expect(wrapper.get('[data-result]').text()).toContain('Nenhum projeto seu está pronto');
    wrapper.unmount();
  });

  it('asks a compatible provider for its base URL, key and model, and shows what the instance refused', async () => {
    const { wrapper, api } = await mountAgent({
      'GET /api/me/agent': { body: { agent: ANTHROPIC } },
      'PUT /api/me/agent': { status: 400, body: { error: 'The provider did not accept this key.' } },
    });

    await wrapper.get('[data-provider="compatible"] input').setValue(true);
    expect(wrapper.text()).toContain('URL base');
    expect(wrapper.text()).toContain('Provedores compatíveis podem ignorar o esforço.');

    // Another provider needs its own key, a https URL and a model.
    await field(wrapper, 'URL base').setValue('http://openrouter.ai/api');
    await save(wrapper);
    expect(wrapper.text()).toContain('Cole a chave da API.');
    expect(wrapper.text()).toContain('Informe uma URL que comece com https://.');
    expect(wrapper.text()).toContain('Informe o nome do modelo no provedor.');
    expect(api.callsTo('PUT /api/me/agent')).toHaveLength(0);

    await wrapper.get('input[type="password"]').setValue('sk-or-v1-abc');
    await field(wrapper, 'URL base').setValue('https://openrouter.ai/api');
    await field(wrapper, 'Modelo').setValue('moonshotai/kimi-k2');
    await save(wrapper);

    expect(api.callsTo('PUT /api/me/agent')[0]?.body).toEqual({
      provider: 'compatible',
      apiKey: 'sk-or-v1-abc',
      baseUrl: 'https://openrouter.ai/api',
      model: 'moonshotai/kimi-k2',
      effort: null,
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('The provider did not accept this key.');
    wrapper.unmount();
  });

  it('connects a Claude subscription: the link to authorize at, the code, then connected', async () => {
    const { wrapper, api, missing } = await mountAgent({
      'GET /api/me/agent': { body: { agent: NONE } },
      'POST /api/me/agent/subscription/start': { body: LOGIN },
      'POST /api/me/agent/subscription/finish': [
        { status: 422, body: { error: 'OAuth error: Invalid authorization code', code: 'code_rejected' } },
        { body: { agent: { ...SUBSCRIPTION, effort: 'high' }, projects: { applied: 1, failed: 0 } } },
      ],
    });

    await wrapper.get('[data-provider="subscription"] input').setValue(true);
    expect(wrapper.get('[data-provider="subscription"]').text()).toContain('Assinatura Claude (Pro/Max)');
    expect(wrapper.get('[data-notice="subscription"]').text()).toBe(
      'O agente usa a sua assinatura Claude por meio do Claude Code oficial. O uso fica sujeito aos termos e limites da sua assinatura.',
    );
    // Claude models, as with an API key
    expect(wrapper.findAll('datalist option')).toHaveLength(3);

    await button(wrapper, 'Conectar assinatura Claude')?.trigger('click');
    expect(button(wrapper, 'Abrindo o Claude Code…')).toBeDefined();
    await flushPromises();
    expect(api.callsTo('POST /api/me/agent/subscription/start')).toHaveLength(1);
    expect(wrapper.find('[data-no-runtime]').exists()).toBe(false);
    const link = wrapper.get('[data-authorize]');
    expect(link.attributes()).toMatchObject({ href: LOGIN.url, target: '_blank', rel: 'noopener noreferrer' });
    expect(wrapper.get('[data-login]').text()).toContain('Autorize, copie o código que aparece e cole aqui.');

    // The code is checked before it goes anywhere
    await button(wrapper, 'Concluir conexão')?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Cole o código exatamente como o claude.ai mostra.');
    expect(api.callsTo('POST /api/me/agent/subscription/finish')).toHaveLength(0);

    // Claude refuses the code: the sign-in ends and starts over
    await field(wrapper, 'Código de autorização').setValue('wrong#code');
    await button(wrapper, 'Concluir conexão')?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-login-error]').text()).toContain('OAuth error: Invalid authorization code');
    expect(wrapper.find('[data-login]').exists()).toBe(false);

    await button(wrapper, 'Conectar assinatura Claude')?.trigger('click');
    await flushPromises();
    await field(wrapper, 'Código de autorização').setValue('  good#code ');
    await wrapper.get('select').setValue('high');
    // Enter in the code field finishes the sign-in
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.callsTo('POST /api/me/agent/subscription/finish')[1]?.body).toEqual({
      projectId: null,
      loginId: 'login_0123456789',
      code: 'good#code',
      model: null,
      effort: 'high',
    });
    expect(api.callsTo('PUT /api/me/agent')).toHaveLength(0);
    expect(wrapper.get('[data-connected]').text()).toBe('Assinatura conectada (token …wxyz).');
    expect(wrapper.get('[data-result]').text()).toContain('Salvo e aplicado a 1 projeto.');
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Assinatura Claude conectada.');
    expect(button(wrapper, 'Conectar de novo')).toBeDefined();
    expect(wrapper.text()).toContain('Configurado');
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('says a project is needed (instances without the sign-in container), takes a pasted token instead, and cancels a sign-in left behind', async () => {
    const { wrapper, api } = await mountAgent({
      'GET /api/me/agent': { body: { agent: NONE } },
      'POST /api/me/agent/subscription/start': [
        { status: 409, body: { error: 'Connecting needs a project with the agent ready.', code: 'no_runtime' } },
        { body: PROJECT_LOGIN },
      ],
      'POST /api/me/agent/subscription/cancel': { body: { cancelled: true } },
      'PUT /api/me/agent': { body: { agent: SUBSCRIPTION, projects: { applied: 0, failed: 0 } } },
    });

    await wrapper.get('[data-provider="subscription"] input').setValue(true);
    await button(wrapper, 'Conectar assinatura Claude')?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-no-runtime]').text()).toContain('Crie um projeto primeiro ou use um token abaixo.');
    expect(wrapper.get('[data-fallback]').attributes()).toHaveProperty('open');
    expect(wrapper.get('[data-fallback]').text()).toContain('claude setup-token');

    // The fallback: a token from `claude setup-token`, in its format
    await save(wrapper);
    expect(wrapper.text()).toContain('Conecte a assinatura ou cole um token.');
    await wrapper.get('[data-fallback] input[type="password"]').setValue(KEY);
    await save(wrapper);
    expect(wrapper.text()).toContain('Isso não parece um token do claude setup-token.');
    expect(api.callsTo('PUT /api/me/agent')).toHaveLength(0);
    await wrapper.get('[data-fallback] input[type="password"]').setValue(TOKEN);
    await save(wrapper);
    expect(api.callsTo('PUT /api/me/agent')[0]?.body).toEqual({
      provider: 'subscription',
      apiKey: TOKEN,
      baseUrl: null,
      model: null,
      effort: null,
    });
    expect(wrapper.text()).toContain('Token salvo: …wxyz. Deixe em branco para manter.');

    // A sign-in the user walks away from is cancelled, so the container can start another
    await button(wrapper, 'Conectar de novo')?.trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-login]').exists()).toBe(true);
    await wrapper.get('[data-provider="anthropic"] input').setValue(true);
    await flushPromises();
    expect(api.callsTo('POST /api/me/agent/subscription/cancel')[0]?.body).toEqual({
      projectId: 'p_loja',
      loginId: 'login_0123456789',
    });
    wrapper.unmount();
  });

  it('turns the agent off after confirming', async () => {
    const { wrapper, api } = await mountAgent({
      'GET /api/me/agent': { body: { agent: ANTHROPIC } },
      'DELETE /api/me/agent': { body: { agent: NONE } },
    });

    await button(wrapper, 'Remover')?.trigger('click');
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Desligar o agente?');
    [...(document.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [])]
      .find((candidate) => candidate.textContent?.trim() === 'Desligar o agente')
      ?.click();
    await flushPromises();

    expect(api.callsTo('DELETE /api/me/agent')).toHaveLength(1);
    expect(wrapper.text()).toContain('Não configurado');
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Agente desligado em todos os seus projetos.');
    wrapper.unmount();
  });
});
