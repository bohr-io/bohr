import { describe, expect, it, vi } from 'vitest';
import { credentials } from '../src/credentials';
import type { Fetch } from '../src/http';
import { requestDeployCredentials } from '../src/instance';
import { fakeJwt, jsonResponse, noSleep, recordingLogger } from './helpers';

const TOKEN = 'cf-user-token-0123456789abcdefghij';
const OIDC = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 600 });

function setup(response: () => Response | Promise<Response>) {
  const fetch = vi.fn<Fetch>(async () => response());
  const { logger, lines, secrets } = recordingLogger();
  const exported: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  const deps = {
    fetch,
    getIdToken: vi.fn(async () => OIDC),
    logger,
    exportVariable: (name: string, value: string) => {
      exported[name] = value;
    },
    setOutput: (name: string, value: string) => {
      outputs[name] = value;
    },
    sleep: noSleep,
  };
  return { fetch, deps, lines, secrets, exported, outputs };
}

describe('credentials mode', () => {
  it('asks the instance with the OIDC token, masks every value and exports the build variables', async () => {
    const { fetch, deps, lines, secrets, exported, outputs } = setup(() =>
      jsonResponse({
        accountId: 'acc-user',
        apiToken: TOKEN,
        buildVariables: { NEXT_PUBLIC_API: 'https://api.example.com', MULTI: 'line one\nline two' },
      }),
    );
    const result = await credentials({ instanceUrl: 'https://bohr.example/' }, deps);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://bohr.example/api/deploy/credentials');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${OIDC}`);

    expect(secrets).toEqual(
      expect.arrayContaining([OIDC, TOKEN, 'acc-user', 'https://api.example.com', 'line one\nline two', 'line one']),
    );
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain('https://api.example.com');

    // The build gets the variables; only the step that maps the outputs gets the Cloudflare credentials
    expect(exported).toEqual({ NEXT_PUBLIC_API: 'https://api.example.com', MULTI: 'line one\nline two' });
    expect(outputs).toEqual({ 'cloudflare-api-token': TOKEN, 'cloudflare-account-id': 'acc-user' });
    expect(result).toEqual({ accountId: 'acc-user', variables: ['NEXT_PUBLIC_API', 'MULTI'] });
  });

  it('skips names the build cannot use', async () => {
    const { deps, exported, lines } = setup(() =>
      jsonResponse({
        accountId: 'acc',
        apiToken: TOKEN,
        buildVariables: { GITHUB_TOKEN: 'x', CLOUDFLARE_API_TOKEN: 'y', 'A-B': 'z', 'X\n::stop': 'w', OK: 'v' },
      }),
    );
    await credentials({ instanceUrl: 'https://bohr.example' }, deps);
    expect(exported).toEqual({ OK: 'v' });
    expect(lines.filter((line) => line.startsWith('warning: Skipped'))).toHaveLength(4);
    expect(lines.join('\n')).not.toContain('\n::stop');
  });

  it('fails with the instance message when bohr refuses the run', async () => {
    const { deps, exported, outputs } = setup(() =>
      jsonResponse({ error: 'Deploy credentials are only given to runs on the production branch (main).' }, 403),
    );
    await expect(credentials({ instanceUrl: 'https://bohr.example' }, deps)).rejects.toThrow(
      /HTTP 403\): Deploy credentials are only given to runs on the production branch/,
    );
    expect(exported).toEqual({});
    expect(outputs).toEqual({});
  });

  it('explains a missing id-token permission and refuses plain http', async () => {
    const { deps, fetch } = setup(() => jsonResponse({}));
    deps.getIdToken.mockRejectedValueOnce(new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable'));
    await expect(credentials({ instanceUrl: 'https://bohr.example' }, deps)).rejects.toThrow('id-token: write');
    await expect(credentials({ instanceUrl: 'http://bohr.example' }, deps)).rejects.toThrow('must use https');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('requestDeployCredentials', () => {
  const client = (fetch: Fetch) => ({ instanceUrl: 'https://bohr.example', token: 'oidc', fetch, sleep: noSleep });

  it('retries server errors and validates the answer', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ accountId: 'acc', apiToken: TOKEN }));
    expect(await requestDeployCredentials(client(fetch))).toEqual({
      accountId: 'acc',
      apiToken: TOKEN,
      buildVariables: {},
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    for (const body of [
      { accountId: 'acc' },
      { apiToken: TOKEN },
      { accountId: 'acc', apiToken: TOKEN, buildVariables: { A: 1 } },
      { accountId: 'acc', apiToken: TOKEN, buildVariables: ['A'] },
    ]) {
      await expect(requestDeployCredentials(client(async () => jsonResponse(body)))).rejects.toThrow('without a valid');
    }
  });
});
