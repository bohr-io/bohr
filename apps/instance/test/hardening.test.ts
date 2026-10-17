import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { instanceSettings } from '../src/db/schema';
import { isAdminToken } from '../src/lib/admin';
import { safeRedirect } from '../src/lib/session';
import { purgeExpiredCodes } from '../src/services/housekeeping';
import { isProductionBranch } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import { resetStorage } from './helpers';

const db = createDb(env.DB);

beforeEach(resetStorage);

describe('redirects after sign-in', () => {
  it('keeps paths on this instance and drops everything else', () => {
    expect(safeRedirect('/projects/p1?tab=chat#top')).toBe('/projects/p1?tab=chat#top');
    expect(safeRedirect('/')).toBe('/');
    for (const value of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/ /evil.example',
      '/%0a',
      'javascript:alert(1)',
    ]) {
      // '%0a' stays encoded and harmless; raw control characters and spaces never pass
      expect(safeRedirect(value)).toBe(value === '/%0a' ? '/%0a' : '/');
    }
  });
});

describe('production branches', () => {
  it('accepts git branch names other than the agent work branch', () => {
    expect(isProductionBranch('main')).toBe(true);
    expect(isProductionBranch('release/2026.10')).toBe(true);
    expect(isProductionBranch('homolog')).toBe(false);
    expect(isProductionBranch('-main')).toBe(false);
    expect(isProductionBranch('a..b')).toBe(false);
    expect(isProductionBranch('main branch')).toBe(false);
    expect(isProductionBranch('')).toBe(false);
  });
});

describe('admin token', () => {
  it('matches only a configured token of at least 32 characters', async () => {
    expect(await isAdminToken(env, env.ADMIN_TOKEN)).toBe(true);
    expect(await isAdminToken(env, `${env.ADMIN_TOKEN}x`)).toBe(false);
    expect(await isAdminToken(env, undefined)).toBe(false);
    expect(await isAdminToken({ ADMIN_TOKEN: 'short' }, 'short')).toBe(false);
    expect(await isAdminToken({ ADMIN_TOKEN: '' }, '')).toBe(false);
  });
});

describe('housekeeping', () => {
  it('deletes expired one-time codes and keeps everything else', async () => {
    const now = Date.now();
    await writeSetting(db, 'install_state:old', { userId: 'u1', expiresAt: now - 1 });
    await writeSetting(db, 'install_verify:used', { userId: 'u1', installationId: 1, expiresAt: 0 });
    await writeSetting(db, 'telegram_link:old', { userId: 'u1', expiresAt: now - 60_000 });
    await writeSetting(db, 'telegram_login:fresh', { nonceHash: 'x', expiresAt: now + 60_000 });
    await writeSetting(db, 'platform_bot', { username: 'bohr_bot', expiresAt: 0 });

    await purgeExpiredCodes(db, now);

    const keys = (await db.select({ key: instanceSettings.key }).from(instanceSettings).all()).map((row) => row.key);
    expect(keys.sort()).toEqual(['platform_bot', 'telegram_login:fresh']);
  });
});
