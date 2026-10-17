import { afterEach, describe, expect, it, vi } from 'vitest';
import { basicChallenge, hashPassword, isAuthorized, parseBasicAuth, verifyPassword } from '../src/auth';
import type { BasicAuthUser } from '../src/routes';
import { basicHeader, toBase64, uniqueLabel } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const decodedLength = (base64: string) => atob(base64).length;

describe('hashPassword / verifyPassword', () => {
  it('derives a 32-byte PBKDF2-SHA256 hash with a random 16-byte salt', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');
    expect(first.iterations).toBe(20_000);
    expect(decodedLength(first.salt)).toBe(16);
    expect(decodedLength(first.hash)).toBe(32);
    expect(second.salt).not.toBe(first.salt);
    expect(await verifyPassword('correct horse', first)).toBe(true);
    expect(await verifyPassword('correct horse!', first)).toBe(false);
    expect(await verifyPassword('', first)).toBe(false);
  });

  it('matches a reference PBKDF2-SHA256 vector', async () => {
    // node -e "crypto.pbkdf2Sync('password', 'salt', 4096, 32, 'sha256').toString('base64')"
    const record = { salt: btoa('salt'), hash: 'xeR41ZKIyEGqUw22hFxMjZYok6ABzk4RpJY4c6qYE0o=', iterations: 4096 };
    expect(await verifyPassword('password', record)).toBe(true);
    expect(await verifyPassword('Password', record)).toBe(false);
  });

  it('honours a custom iteration count and rejects unsupported ones', async () => {
    const record = await hashPassword('pw', { iterations: 1000 });
    expect(record.iterations).toBe(1000);
    expect(await verifyPassword('pw', record)).toBe(true);
    for (const iterations of [0, 1.5, 100_001]) {
      await expect(hashPassword('pw', { iterations })).rejects.toThrow(RangeError);
    }
  });

  it('treats malformed records as non-matching instead of throwing', async () => {
    const good = await hashPassword('pw', { iterations: 1000 });
    expect(await verifyPassword('pw', { ...good, salt: '%%%' })).toBe(false);
    expect(await verifyPassword('pw', { ...good, salt: '' })).toBe(false);
    expect(await verifyPassword('pw', { ...good, hash: btoa('short') })).toBe(false);
    expect(await verifyPassword('pw', { ...good, iterations: 1_000_000 })).toBe(false);
  });
});

describe('parseBasicAuth', () => {
  it('parses credentials, splitting at the first colon', () => {
    expect(parseBasicAuth(basicHeader('client', 'a:b:c'))).toEqual({ username: 'client', password: 'a:b:c' });
    expect(parseBasicAuth(`basic   ${btoa('client:')}`)).toEqual({ username: 'client', password: '' });
    expect(parseBasicAuth(`BASIC ${btoa('client:pw')}`)).toEqual({ username: 'client', password: 'pw' });
  });

  it('decodes UTF-8 credentials', () => {
    expect(parseBasicAuth(basicHeader('josé', 'pässwörd ✓'))).toEqual({ username: 'josé', password: 'pässwörd ✓' });
  });

  it.each([
    ['an empty header', ''],
    ['a scheme without credentials', 'Basic'],
    ['another scheme', `Bearer ${btoa('client:pw')}`],
    ['invalid base64 characters', 'Basic !!!!'],
    ['a base64 length that cannot be decoded', 'Basic abcde'],
    ['credentials without a colon', `Basic ${btoa('client')}`],
    ['invalid UTF-8', `Basic ${btoa('\xff\xfe:pw')}`],
    ['control characters', `Basic ${toBase64(new TextEncoder().encode('client:pw\n'))}`],
    ['trailing data', `Basic ${btoa('client:pw')} extra`],
  ])('rejects %s', (_name, header) => {
    expect(parseBasicAuth(header)).toBeNull();
  });
});

describe('basicChallenge', () => {
  it('names the realm and the UTF-8 charset', () => {
    expect(basicChallenge('site-acme.bohr.io')).toBe('Basic realm="site-acme.bohr.io", charset="UTF-8"');
    expect(basicChallenge('a"b\\c')).toBe('Basic realm="a\\"b\\\\c", charset="UTF-8"');
  });
});

describe('isAuthorized', () => {
  async function user(username: string, password: string): Promise<BasicAuthUser> {
    return { username, ...(await hashPassword(password, { iterations: 1000 })) };
  }

  it('runs PBKDF2 once per hostname and Authorization value', async () => {
    const users = [await user('client', 'pw')];
    const header = basicHeader('client', 'pw');
    const host = `${uniqueLabel()}.bohr.io`;
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');

    expect(await isAuthorized(host, header, users)).toBe(true);
    expect(await isAuthorized(host, header, users)).toBe(true);
    expect(await isAuthorized(host, header, users)).toBe(true);
    expect(deriveBits).toHaveBeenCalledTimes(1);

    // The cache key includes the hostname.
    expect(await isAuthorized(`${uniqueLabel()}.bohr.io`, header, users)).toBe(true);
    expect(deriveBits).toHaveBeenCalledTimes(2);
  });

  it('never caches failures', async () => {
    const users = [await user('client', 'pw')];
    const host = `${uniqueLabel()}.bohr.io`;
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await isAuthorized(host, basicHeader('client', 'nope'), users)).toBe(false);
    expect(await isAuthorized(host, basicHeader('client', 'nope'), users)).toBe(false);
    expect(deriveBits).toHaveBeenCalledTimes(2);
  });

  it('runs PBKDF2 for unknown usernames too, without accepting them', async () => {
    const users = [await user('client', 'pw')];
    const deriveBits = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await isAuthorized(`${uniqueLabel()}.bohr.io`, basicHeader('intruder', 'pw'), users)).toBe(false);
    expect(deriveBits).toHaveBeenCalledTimes(1);
  });

  it('drops a cached verification once the password changes or the user is removed', async () => {
    const host = `${uniqueLabel()}.bohr.io`;
    const header = basicHeader('client', 'old');
    const before = [await user('client', 'old'), await user('other', 'x')];
    expect(await isAuthorized(host, header, before)).toBe(true);

    const changed = [await user('client', 'new'), before[1] as BasicAuthUser];
    expect(await isAuthorized(host, header, changed)).toBe(false);
    expect(await isAuthorized(host, header, [before[1] as BasicAuthUser])).toBe(false);
    expect(await isAuthorized(host, basicHeader('client', 'new'), changed)).toBe(true);
  });

  it('rejects missing headers and records without users', async () => {
    const users = [await user('client', 'pw')];
    expect(await isAuthorized('example.com', null, users)).toBe(false);
    expect(await isAuthorized('example.com', basicHeader('client', 'pw'), [])).toBe(false);
  });
});
