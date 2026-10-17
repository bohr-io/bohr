import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliLogin } from '../api';
import { loadSession } from '../session';
import { type FakeRoute, fakeApi, ME, mountAt } from '../test-utils';

const PENDING: CliLogin = {
  userCode: 'BCDF-GHJK',
  clientName: 'CLI on ana-laptop',
  status: 'pending',
  createdAt: '2026-10-12T12:00:00.000Z',
  expiresAt: '2026-10-12T12:10:00.000Z',
};

async function mountLogin(path: string, routes: Record<string, FakeRoute | FakeRoute[]> = {}) {
  const api = fakeApi({ 'GET /api/me': { body: ME }, ...routes });
  await loadSession(true);
  const mounted = await mountAt(path);
  return { ...mounted, api };
}

type Wrapper = Awaited<ReturnType<typeof mountLogin>>['wrapper'];
const button = (wrapper: Wrapper, text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

describe('approving bohr login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('shows the computer and the code, warns, and approves', async () => {
    const { wrapper, api, missing } = await mountLogin('/cli?code=BCDF-GHJK', {
      'GET /api/cli/logins/BCDF-GHJK': { body: { login: PENDING } },
      'POST /api/cli/logins/BCDF-GHJK/approve': { body: { login: { ...PENDING, status: 'approved' } } },
    });
    expect(wrapper.text()).toContain('CLI on ana-laptop');
    expect(wrapper.text()).toContain('BCDF-GHJK');
    expect(wrapper.get('[data-notice="check"]').text()).toContain('O código é o mesmo do seu terminal?');

    await button(wrapper, 'Aprovar')?.trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/cli/logins/BCDF-GHJK/approve')).toHaveLength(1);
    expect(wrapper.text()).toContain('Pode voltar ao terminal.');
    expect(wrapper.find('a[href="/account/tokens"]').exists()).toBe(true);
    expect(missing).toEqual([]);
  });

  it('denies, and says when a code is unknown or expired', async () => {
    const denied = await mountLogin('/cli?code=BCDF-GHJK', {
      'GET /api/cli/logins/BCDF-GHJK': { body: { login: PENDING } },
      'POST /api/cli/logins/BCDF-GHJK/deny': { body: { login: { ...PENDING, status: 'denied' } } },
    });
    await button(denied.wrapper, 'Recusar')?.trigger('click');
    await flushPromises();
    expect(denied.wrapper.text()).toContain('Recusado: a CLI não entrou na sua conta.');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';

    const unknown = await mountLogin('/cli?code=XXXX-XXXX', {
      'GET /api/cli/logins/XXXX-XXXX': { status: 404, body: { error: 'No sign-in with this code.' } },
    });
    expect(unknown.wrapper.text()).toContain('Nenhuma entrada com este código.');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';

    const expired = await mountLogin('/cli?code=BCDF-GHJK', {
      'GET /api/cli/logins/BCDF-GHJK': { body: { login: { ...PENDING, status: 'expired' } } },
    });
    expect(expired.wrapper.text()).toContain('Este código expirou.');
    expect(button(expired.wrapper, 'Aprovar')).toBeUndefined();
  });

  it('asks for the code when the link has none', async () => {
    const { wrapper, router, api } = await mountLogin('/cli', {
      'GET /api/cli/logins/bcdf-ghjk': { body: { login: PENDING } },
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Digite o código que o terminal mostra.');
    await wrapper.get('input').setValue('bcdf-ghjk');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(router.currentRoute.value.query.code).toBe('bcdf-ghjk');
    expect(api.callsTo('GET /api/cli/logins/bcdf-ghjk')).toHaveLength(1);
    expect(wrapper.text()).toContain('CLI on ana-laptop');
  });

  it('sends signed-out visitors to sign in, and back here afterwards', async () => {
    fakeApi({ 'GET /api/me': { status: 401, body: { error: 'Not signed in.' } } });
    await loadSession(true).catch(() => null);
    const { router } = await mountAt('/cli?code=BCDF-GHJK');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/cli?code=BCDF-GHJK');
  });
});
