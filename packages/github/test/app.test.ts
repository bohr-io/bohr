import { createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  appManifest,
  createAppJwt,
  createInstallationToken,
  exchangeManifestCode,
  GithubError,
  getRepositoryInstallation,
} from '../src';
import { derLength, pkcs1ToPkcs8, privateKeyPemToPkcs8 } from '../src/pem';
import { call, fakeFetch } from './fake-fetch';
import { owner, repository } from './fixtures';

// GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY") keys
const { privateKey: pkcs1Pem, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const pkcs8Pem = createPrivateKey(pkcs1Pem).export({ type: 'pkcs8', format: 'pem' }).toString();

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const NOW_SECONDS = NOW / 1000;

function decodeJwt(jwt: string) {
  const [header = '', payload = '', signature = ''] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    verified: verify('sha256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
  };
}

function bearerJwt(authorization: string | undefined) {
  expect(authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  return decodeJwt(authorization?.slice('Bearer '.length) ?? '');
}

describe('createAppJwt', () => {
  it('signs an RS256 JWT with a PKCS#1 key, valid from a minute ago to nine minutes ahead', async () => {
    const jwt = await createAppJwt(12345, pkcs1Pem, NOW);

    expect(jwt.split('.')).toHaveLength(3);
    expect(jwt).not.toMatch(/[=+/]/);
    const decoded = decodeJwt(jwt);
    expect(decoded.header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decoded.payload).toEqual({ iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 540, iss: 12345 });
    expect(decoded.verified).toBe(true);
  });

  it('accepts PKCS#8 keys, producing the same (deterministic) signature', async () => {
    const fromPkcs8 = await createAppJwt(12345, pkcs8Pem, NOW);

    expect(decodeJwt(fromPkcs8).verified).toBe(true);
    expect(fromPkcs8).toBe(await createAppJwt(12345, pkcs1Pem, NOW));
  });

  it('accepts keys whose newlines were escaped in an environment variable', async () => {
    const escaped = pkcs1Pem.trim().replace(/\n/g, '\\n');

    expect(await createAppJwt(12345, escaped, NOW)).toBe(await createAppJwt(12345, pkcs1Pem, NOW));
  });

  it('keeps a string issuer (app id or client id) as given', async () => {
    expect(decodeJwt(await createAppJwt('Iv23liAbCdEf', pkcs1Pem, NOW)).payload.iss).toBe('Iv23liAbCdEf');
  });

  it('defaults to the current time', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { payload } = decodeJwt(await createAppJwt(1, pkcs1Pem));
    const after = Math.floor(Date.now() / 1000);

    expect(payload.iat).toBeGreaterThanOrEqual(before - 60);
    expect(payload.iat).toBeLessThanOrEqual(after - 60);
    expect(payload.exp - payload.iat).toBe(600);
  });

  it('imports each key once', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    // A distinct string, so no earlier test has cached it
    const pem = `${pkcs1Pem}\n`;
    try {
      await Promise.all([createAppJwt(1, pem, NOW), createAppJwt(1, pem, NOW)]);
      await createAppJwt(2, pem, NOW);
      expect(importKey).toHaveBeenCalledTimes(1);
    } finally {
      importKey.mockRestore();
    }
  });

  it('refuses keys it cannot use, with a clear message', async () => {
    const encryptedPkcs1 = createPrivateKey(pkcs1Pem)
      .export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'secret' })
      .toString();
    const encryptedPkcs8 = createPrivateKey(pkcs1Pem)
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'secret' })
      .toString();

    await expect(createAppJwt(1, 'not a key', NOW)).rejects.toThrow('Expected an unencrypted PEM private key');
    await expect(createAppJwt(1, publicKey, NOW)).rejects.toThrow('Expected an unencrypted PEM private key');
    await expect(createAppJwt(1, encryptedPkcs8, NOW)).rejects.toThrow('Expected an unencrypted PEM private key');
    await expect(createAppJwt(1, encryptedPkcs1, NOW)).rejects.toThrow('Encrypted PEM private keys are not supported');
    await expect(
      createAppJwt(1, '-----BEGIN RSA PRIVATE KEY-----\n%%%%\n-----END RSA PRIVATE KEY-----', NOW),
    ).rejects.toThrow('not valid base64');
  });
});

describe('PKCS#1 to PKCS#8', () => {
  it('wraps the key exactly as OpenSSL does', () => {
    const key = createPrivateKey(pkcs1Pem);
    const pkcs1Der = key.export({ type: 'pkcs1', format: 'der' });
    const pkcs8Der = key.export({ type: 'pkcs8', format: 'der' });

    expect(Buffer.from(pkcs1ToPkcs8(pkcs1Der))).toEqual(pkcs8Der);
    expect(Buffer.from(privateKeyPemToPkcs8(pkcs1Pem))).toEqual(pkcs8Der);
    expect(Buffer.from(privateKeyPemToPkcs8(pkcs8Pem))).toEqual(pkcs8Der);
  });

  it('encodes DER lengths in short and long form', () => {
    expect(derLength(0)).toEqual([0x00]);
    expect(derLength(127)).toEqual([0x7f]);
    expect(derLength(128)).toEqual([0x81, 0x80]);
    expect(derLength(255)).toEqual([0x81, 0xff]);
    expect(derLength(256)).toEqual([0x82, 0x01, 0x00]);
    expect(derLength(1190)).toEqual([0x82, 0x04, 0xa6]);
    expect(derLength(65536)).toEqual([0x83, 0x01, 0x00, 0x00]);
  });
});

describe('createInstallationToken', () => {
  it('asks for a narrowed installation token with an App JWT', async () => {
    const { calls, fetch } = fakeFetch({
      status: 201,
      body: {
        token: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a',
        expires_at: '2026-10-11T13:00:00Z',
        permissions: { contents: 'write', metadata: 'read' },
        repository_selection: 'selected',
        repositories: [repository('site', 501)],
      },
    });

    const token = await createInstallationToken({
      appId: 12345,
      privateKeyPem: pkcs1Pem,
      installationId: 42,
      repositories: ['site'],
      permissions: { contents: 'write' },
      fetch,
      now: NOW,
    });

    expect(token).toEqual({
      token: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a',
      expiresAt: '2026-10-11T13:00:00Z',
      permissions: { contents: 'write', metadata: 'read' },
      repositories: ['site'],
    });
    const request = call(calls, 0);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.github.com/app/installations/42/access_tokens');
    expect(request.body).toEqual({ repositories: ['site'], permissions: { contents: 'write' } });
    expect(request.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'bohr (+https://bohr.io)',
      'content-type': 'application/json',
    });
    const jwt = bearerJwt(request.headers.authorization);
    expect(jwt.verified).toBe(true);
    expect(jwt.payload).toEqual({ iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 540, iss: 12345 });
  });

  it('sends no body when the token covers the whole installation', async () => {
    const { calls, fetch } = fakeFetch({
      status: 201,
      body: {
        token: 'ghs_x',
        expires_at: '2026-10-11T13:00:00Z',
        permissions: { contents: 'write' },
        repository_selection: 'all',
      },
    });

    const token = await createInstallationToken({ appId: 1, privateKeyPem: pkcs1Pem, installationId: 42, fetch });

    expect(token).toEqual({ token: 'ghs_x', expiresAt: '2026-10-11T13:00:00Z', permissions: { contents: 'write' } });
    expect(call(calls, 0).body).toBeUndefined();
    expect(call(calls, 0).headers['content-type']).toBeUndefined();
  });

  it('honors apiBase and userAgent', async () => {
    const { calls, fetch } = fakeFetch({
      status: 201,
      body: { token: 'ghs_x', expires_at: '2026-10-11T13:00:00Z', permissions: {} },
    });

    await createInstallationToken({
      appId: 1,
      privateKeyPem: pkcs1Pem,
      installationId: 7,
      fetch,
      apiBase: 'https://ghe.example.com/api/v3/',
      userAgent: 'bohr-instance',
    });

    expect(call(calls, 0).url).toBe('https://ghe.example.com/api/v3/app/installations/7/access_tokens');
    expect(call(calls, 0).headers['user-agent']).toBe('bohr-instance');
  });

  it('throws GithubError when GitHub refuses', async () => {
    const { fetch } = fakeFetch({
      status: 404,
      body: {
        message: 'Not Found',
        documentation_url: 'https://docs.github.com/rest/apps/apps#create-an-installation-access-token-for-an-app',
        status: '404',
      },
    });

    const error = await createInstallationToken({ appId: 1, privateKeyPem: pkcs1Pem, installationId: 9, fetch }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GithubError);
    expect((error as GithubError).status).toBe(404);
    expect((error as GithubError).message).toBe('GitHub 404: Not Found');
    expect((error as GithubError).documentationUrl).toBe(
      'https://docs.github.com/rest/apps/apps#create-an-installation-access-token-for-an-app',
    );
  });
});

describe('getRepositoryInstallation', () => {
  it("finds the App's installation on a repository", async () => {
    const { calls, fetch } = fakeFetch({
      body: {
        id: 42,
        account: owner,
        repository_selection: 'selected',
        app_id: 12345,
        app_slug: 'bohr-dev',
        target_type: 'Organization',
        permissions: { contents: 'write', metadata: 'read' },
        events: ['push', 'pull_request'],
      },
    });

    const installation = await getRepositoryInstallation({
      appId: 12345,
      privateKeyPem: pkcs1Pem,
      owner: 'acme',
      repo: 'site',
      fetch,
    });

    expect(installation).toEqual({ id: 42, account: { login: 'acme' } });
    expect(call(calls, 0).method).toBe('GET');
    expect(call(calls, 0).url).toBe('https://api.github.com/repos/acme/site/installation');
    expect(bearerJwt(call(calls, 0).headers.authorization).verified).toBe(true);
  });

  it('returns null when the App is not installed there', async () => {
    const { fetch } = fakeFetch({ status: 404, body: { message: 'Not Found' } });

    expect(
      await getRepositoryInstallation({ appId: 1, privateKeyPem: pkcs1Pem, owner: 'acme', repo: 'other', fetch }),
    ).toBeNull();
  });

  it('rethrows other failures', async () => {
    const { fetch } = fakeFetch({ status: 401, body: { message: 'A JSON web token could not be decoded' } });

    await expect(
      getRepositoryInstallation({ appId: 1, privateKeyPem: pkcs1Pem, owner: 'acme', repo: 'site', fetch }),
    ).rejects.toThrow('GitHub 401: A JSON web token could not be decoded');
  });
});

describe('exchangeManifestCode', () => {
  it('trades the code for the new App credentials, unauthenticated', async () => {
    const { calls, fetch } = fakeFetch({
      status: 201,
      body: {
        id: 12345,
        slug: 'bohr-acme',
        node_id: 'A_kwDOAbCdEf',
        owner,
        name: 'bohr (acme)',
        description: 'Deploys for acme',
        external_url: 'https://bohr.acme.dev',
        html_url: 'https://github.com/apps/bohr-acme',
        created_at: '2026-10-11T12:00:00Z',
        updated_at: '2026-10-11T12:00:00Z',
        permissions: { contents: 'write', metadata: 'read' },
        events: ['push', 'pull_request'],
        client_id: 'Iv23liAbCdEf',
        client_secret: 'client-secret-value',
        webhook_secret: 'webhook-secret-value',
        pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
      },
    });

    const app = await exchangeManifestCode('a1b2c3d4', { fetch });

    expect(app).toEqual({
      id: 12345,
      slug: 'bohr-acme',
      name: 'bohr (acme)',
      client_id: 'Iv23liAbCdEf',
      client_secret: 'client-secret-value',
      webhook_secret: 'webhook-secret-value',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
      html_url: 'https://github.com/apps/bohr-acme',
      owner: { login: 'acme' },
    });
    expect(call(calls, 0).method).toBe('POST');
    expect(call(calls, 0).url).toBe('https://api.github.com/app-manifests/a1b2c3d4/conversions');
    expect(call(calls, 0).headers.authorization).toBeUndefined();
    expect(call(calls, 0).body).toBeUndefined();
  });

  it('encodes the code and reports an expired one', async () => {
    const { calls, fetch } = fakeFetch({ status: 404, body: { message: 'Not Found' } });

    await expect(exchangeManifestCode('a/b?c', { fetch })).rejects.toThrow('GitHub 404: Not Found');
    expect(call(calls, 0).url).toBe('https://api.github.com/app-manifests/a%2Fb%3Fc/conversions');
  });
});

describe('appManifest', () => {
  it('leaves the webhook out when asked (local instances)', () => {
    const manifest = appManifest({
      name: 'bohr local',
      url: 'http://localhost:8787',
      webhookUrl: 'http://localhost:8787/api/github/webhook',
      webhookActive: false,
      callbackUrls: ['http://localhost:8787/auth/github/callback'],
      redirectUrl: 'http://localhost:8787/setup/github/callback',
    });
    expect(manifest.hook_attributes).toBeUndefined();
  });

  const base = {
    name: 'bohr (acme)',
    url: 'https://bohr.acme.dev',
    webhookUrl: 'https://bohr.acme.dev/api/github/webhook',
    callbackUrls: ['https://bohr.acme.dev/auth/github/callback'],
    redirectUrl: 'https://bohr.acme.dev/setup/github/created',
  };

  it('asks for the permissions and events bohr uses, with setup on install and update', () => {
    expect(
      appManifest({ ...base, setupUrl: 'https://bohr.acme.dev/setup/github/installed', description: 'Deploys' }),
    ).toEqual({
      name: 'bohr (acme)',
      url: 'https://bohr.acme.dev',
      hook_attributes: { url: 'https://bohr.acme.dev/api/github/webhook', active: true },
      redirect_url: 'https://bohr.acme.dev/setup/github/created',
      callback_urls: ['https://bohr.acme.dev/auth/github/callback'],
      setup_url: 'https://bohr.acme.dev/setup/github/installed',
      setup_on_update: true,
      description: 'Deploys',
      public: false,
      default_permissions: {
        contents: 'write',
        pull_requests: 'write',
        workflows: 'write',
        secrets: 'write',
        actions: 'read',
        metadata: 'read',
        members: 'read',
        administration: 'write',
      },
      // installation_repositories reaches every App without (and cannot take) a subscription
      default_events: ['push', 'pull_request', 'organization'],
      request_oauth_on_install: false,
    });
  });

  it('leaves setup out without a setup URL and can make the App public', () => {
    const manifest = appManifest({ ...base, public: true });

    expect(manifest.public).toBe(true);
    expect(manifest).not.toHaveProperty('setup_url');
    expect(manifest).not.toHaveProperty('setup_on_update');
    expect(manifest).not.toHaveProperty('description');
  });

  it('returns fresh objects, so callers cannot alter the shared defaults', () => {
    const first = appManifest(base);
    (first.default_events as string[]).push('issues');
    (first.default_permissions as Record<string, string>).issues = 'write';

    expect(appManifest(base).default_events).toEqual(['push', 'pull_request', 'organization']);
    expect(appManifest(base).default_permissions).not.toHaveProperty('issues');
  });
});
