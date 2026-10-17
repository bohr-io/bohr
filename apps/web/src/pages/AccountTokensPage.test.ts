import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiToken, Tokens } from '../api';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt } from '../test-utils';

const PROJECTS: Tokens['projects'] = [
  { id: 'p_loja', name: 'Loja', repository: 'ana/loja' },
  { id: 'p_blog', name: 'Blog', repository: 'ana/blog' },
];
const LAPTOP: ApiToken = {
  id: 'tok_1',
  name: 'CLI on ana-laptop',
  hint: 'bohr_k3x9…',
  source: 'cli',
  projects: null,
  expiresAt: null,
  expired: false,
  lastUsedAt: null,
  createdAt: '2026-10-01T12:00:00.000Z',
};
const AGENT: ApiToken = {
  ...LAPTOP,
  id: 'tok_2',
  name: 'agente de deploy',
  hint: 'bohr_m2p8…',
  source: 'panel',
  projects: [{ id: 'p_loja', name: 'Loja' }],
  expiresAt: '2027-01-01T00:00:00.000Z',
};
const SECRET = `bohr_${'z'.repeat(40)}`;

async function mountTokens(routes: Record<string, FakeRoute | FakeRoute[]>) {
  const api = fakeApi({ 'GET /api/me': { body: ME }, ...routes });
  await loadSession(true);
  const mounted = await mountAt('/account/tokens');
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountTokens>>['wrapper'];
const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

describe('account tokens', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('lists the tokens without the tokens themselves', async () => {
    const { wrapper, missing } = await mountTokens({
      'GET /api/me/tokens': { body: { tokens: [LAPTOP, AGENT], projects: PROJECTS } },
    });
    const items = wrapper.findAll('[data-token-id]');
    expect(items.map((item) => item.find('.account-tokens__name').text())).toEqual([
      'CLI on ana-laptop CLI',
      'agente de deploy',
    ]);
    expect(items[0]?.text()).toContain('Todos os seus projetos');
    expect(items[0]?.text()).toContain('nunca usado');
    expect(items[1]?.text()).toContain('Projetos: Loja');
    expect(items[1]?.text()).toContain('bohr_m2p8…');
    expect(missing).toEqual([]);
  });

  it('creates a token for chosen projects and shows it once', async () => {
    const { wrapper, api } = await mountTokens({
      'GET /api/me/tokens': { body: { tokens: [], projects: PROJECTS } },
      'POST /api/me/tokens': { status: 201, body: { token: SECRET, id: 'tok_2', tokens: [AGENT], projects: PROJECTS } },
    });
    // Checked before calling the instance
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Dê um nome ao token.');
    expect(api.callsTo('POST /api/me/tokens')).toHaveLength(0);

    await wrapper.get('input[autocomplete="off"]').setValue('agente de deploy');
    await wrapper.get('input[value="selected"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Escolha pelo menos um projeto.');

    await wrapper.get('input[type="checkbox"][value="p_loja"]').setValue(true);
    await wrapper.get('select').setValue('365');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/me/tokens')[0]?.body).toEqual({
      name: 'agente de deploy',
      projectIds: ['p_loja'],
      expiresInDays: 365,
    });
    expect(wrapper.get('[data-token]').text()).toBe(SECRET);
    expect(wrapper.get('[data-created]').text()).toContain('não mostra de novo');
    expect(wrapper.findAll('[data-token-id]')).toHaveLength(1);
  });

  it('revokes a token after asking', async () => {
    const { wrapper, api } = await mountTokens({
      'GET /api/me/tokens': { body: { tokens: [LAPTOP], projects: PROJECTS } },
      'DELETE /api/me/tokens/tok_1': { body: { tokens: [], projects: PROJECTS } },
    });
    await button(wrapper, 'Revogar')?.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Revogar "CLI on ana-laptop"?');
    const confirm = [...document.querySelectorAll('button')]
      .filter((node) => node.textContent?.trim() === 'Revogar')
      .at(-1);
    confirm?.click();
    await flushPromises();
    expect(api.callsTo('DELETE /api/me/tokens/tok_1')).toHaveLength(1);
    expect(wrapper.text()).toContain('Nenhum token ainda.');
  });
});
