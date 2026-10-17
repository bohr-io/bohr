import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { app } from '../src/index';
import { upsertGithubUser } from '../src/services/users';
import { call, resetStorage } from './helpers';

const LOCAL = { ...env, LOCAL_PRODUCTION_DB: '1', LOCAL_SIGN_IN_AS: 'Ana' };

beforeEach(async () => {
  await resetStorage();
  // Migrated by a regular request first: the local mode never migrates
  await call('/health');
  await upsertGithubUser(createDb(env.DB), { githubId: 5001, login: 'ana', name: 'Ana', email: null });
});

describe('local sign-in on production data', () => {
  it('signs LOCAL_SIGN_IN_AS in from localhost, in the local production-data mode only', async () => {
    const local = await app.request('http://localhost/auth/local', {}, LOCAL);
    expect(local.status).toBe(302);
    expect(local.headers.get('location')).toBe('/');
    expect(local.headers.get('set-cookie')).toBeTruthy();

    expect((await app.request('https://app.bohr.io/auth/local', {}, LOCAL)).status).toBe(404);
    expect((await app.request('http://localhost/auth/local', {}, env)).status).toBe(404);
    const nobody = { ...LOCAL, LOCAL_SIGN_IN_AS: 'someone-else' };
    expect((await app.request('http://localhost/auth/local', {}, nobody)).status).toBe(404);
  });
});
