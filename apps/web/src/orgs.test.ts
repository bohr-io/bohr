import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextOrg, loadOrgs, orgs, resetOrgs, setContext } from './orgs';
import { fakeApi } from './test-utils';

const READY = { subscription: true, cloudflare: true, agent: true, installation: true };
const ACME = { id: 'o_1', slug: 'acme', name: 'Acme Inc', avatarUrl: null, role: 'admin', status: READY };

describe('organizations and the context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetOrgs();
    setContext(null);
    window.localStorage.clear();
  });

  it('loads the organizations once, sorted by name', async () => {
    const { callsTo } = fakeApi({
      'GET /api/orgs': { body: { orgs: [{ ...ACME, slug: 'zeta', name: 'Zeta' }, ACME] } },
    });

    expect((await loadOrgs()).map((org) => org.slug)).toEqual(['acme', 'zeta']);
    await loadOrgs();
    expect(callsTo('GET /api/orgs')).toHaveLength(1);
    await loadOrgs(true);
    expect(callsTo('GET /api/orgs')).toHaveLength(2);
  });

  it('remembers the context in this browser, and works when the storage is blocked', () => {
    setContext('acme');
    expect(window.localStorage.getItem('bohr.context')).toBe('"acme"');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => setContext('zeta')).not.toThrow();
    expect(orgs.context).toBe('zeta');
  });

  it('keeps a remembered organization while the list cannot be read, and forgets it once the user left it', async () => {
    setContext('acme');
    fakeApi({ 'GET /api/orgs': { status: 500, body: { error: 'Down.' } } });
    expect(await contextOrg()).toBeNull();
    expect(orgs.context).toBe('acme');

    resetOrgs();
    fakeApi({ 'GET /api/orgs': { body: { orgs: [ACME] } } });
    expect((await contextOrg())?.name).toBe('Acme Inc');

    setContext('gone');
    expect(await contextOrg()).toBeNull();
    expect(orgs.context).toBeNull();
  });
});
