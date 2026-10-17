import { env } from 'cloudflare:workers';
import { DEPLOY_WORKFLOW_PATH, deployConfigSchema, renderDeployWorkflow } from '@bohr/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import {
  auditLog,
  cfConnections,
  githubInstallations,
  identities,
  onboarding as onboardingTable,
  projectMembers,
  projects,
  runtimes,
  sessions,
  subscriptions,
  users,
} from '../src/db/schema';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import { applyOwnerAgent, saveAgentSettings } from '../src/services/agent-settings';
import { deployCredentials } from '../src/services/deploy-credentials';
import { saveGithubApp } from '../src/services/github-app';
import { installUrl, readOnboarding } from '../src/services/onboarding';
import { notifyProvisioned } from '../src/services/platform-bot';
import { DEFAULT_RUNTIME_IMAGE, provisionRuntime } from '../src/services/provision';
import { writeSetting } from '../src/services/settings';
import type { ProvisionParams } from '../src/workflows/provision';
import { FakeWorld } from './fake-world';
import { resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const IMAGE = `registry.cloudflare.com/acc-user/bohr-agent@sha256:${'c'.repeat(64)}`;
// A self-hosted instance: no managed hosting, platform bot configured
const selfHosted = {
  ...env,
  APP_URL: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  CF_API_TOKEN: undefined,
  CF_ACCOUNT_ID: undefined,
  TELEGRAM_BOT_TOKEN: '1111:platform-bot-token-0123456789abcdefghij',
};
const call = (path: string, init: RequestInit = {}) => app.request(path, init, selfHosted);

let world: FakeWorld;
let provisioning: ProvisionParams[];

async function pkcs8Pem() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
}
const appKey = await pkcs8Pem();

async function signedInUser() {
  await db.insert(users).values({ id: 'u_ana', name: 'Ana' }).run();
  const token = `session-${crypto.randomUUID()}`;
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex(token), userId: 'u_ana', expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  return { Cookie: `__Host-bohr_session=${token}`, 'Content-Type': 'application/json' };
}

/** GitHub's redirect after installing, then the authorization that proves the installation is the user's. */
async function installed(
  send: (path: string, init?: RequestInit) => Response | Promise<Response>,
  installationId: number,
  state: string,
) {
  const back = await send(
    `/setup/github/installed?installation_id=${installationId}&setup_action=install&state=${state}`,
  );
  const authorize = new URL(back.headers.get('Location') ?? '');
  expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
  return send(`/setup/github/verify?code=oauth-code&state=${authorize.searchParams.get('state')}`);
}

beforeEach(async () => {
  await resetStorage();
  useFakes();
  world = new FakeWorld();
  deps.fetch = world.fetch;
  provisioning = [];
  deps.startProvisioning = async (_env, params) => {
    provisioning.push(params);
  };
  await saveGithubApp(db, selfHosted, {
    appId: '321',
    slug: 'bohr-ana',
    clientId: 'Iv1.ana',
    clientSecret: 'secret',
    privateKey: appKey,
    webhookSecret: 'hook',
  });
  await writeSetting(db, 'app_url', 'https://bohr.ana.workers.dev');
  // The agent image was already copied into this account; the registry copy has its own tests
  await writeSetting(db, 'runtime_image:acc-user', { source: DEFAULT_RUNTIME_IMAGE, reference: IMAGE });
});

describe('web onboarding', () => {
  it('connects Cloudflare and GitHub, provisions the project Worker and wires the bot and the key', async () => {
    const headers = await signedInUser();
    const start = (await (await call('/api/onboarding', { headers })).json()) as { step: string };
    expect(start.step).toBe('cloudflare');

    const cloudflare = await call('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    expect(await cloudflare.json()).toMatchObject({ status: 'connected', accountName: "Ana's account" });

    const onboarding = (await (await call('/api/onboarding', { headers })).json()) as {
      step: string;
      github: { installUrl: string };
    };
    expect(onboarding.step).toBe('github');
    const state = new URL(onboarding.github.installUrl).searchParams.get('state') ?? '';
    expect(onboarding.github.installUrl).toContain('https://github.com/apps/bohr-ana/installations/new?state=');

    // GitHub sends the user back with the installation and the state we passed
    const back = await installed(call, 55, state);
    expect(back.status).toBe(302);
    const repositories = (await (await call('/api/onboarding/repositories', { headers })).json()) as {
      repositories: { fullName: string }[];
    };
    expect(repositories.repositories.map((repo) => repo.fullName)).toEqual(['ana/loja']);

    const created = await call('/api/onboarding/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repository: 'ana/loja', locale: 'pt-BR' }),
    });
    expect(created.status).toBe(201);
    const { projectId } = (await created.json()) as { projectId: string };
    expect(provisioning).toEqual([{ projectId, userId: 'u_ana', locale: 'pt-BR' }]);

    // What the Workflow runs
    await provisionRuntime(db, selfHosted, projectId, { locale: 'pt-BR', sleep: async () => {} });
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    expect(runtime).toMatchObject({ status: 'ready', imageRef: IMAGE, migrationTag: 'v1' });
    expect(runtime?.workerUrl).toBe(`https://${runtime?.script}.ana.workers.dev`);
    expect(runtime?.previewScript).toMatch(/^bohr-loja-preview-[a-z0-9]{12}$/);

    const main = world.scripts.get(runtime?.script ?? '');
    expect(main?.modules).toEqual(['project-worker.mjs']);
    const bindings = main?.metadata.bindings as { type: string; name: string; text?: string }[];
    const vars = Object.fromEntries(bindings.filter((b) => b.type === 'plain_text').map((b) => [b.name, b.text]));
    expect(vars).toMatchObject({
      PROJECT_ID: projectId,
      REPO_OWNER: 'ana',
      REPO_NAME: 'loja',
      PRODUCTION_BRANCH: 'main',
      INSTANCE_URL: 'https://bohr.ana.workers.dev',
      PREVIEW_URL: runtime?.previewUrl,
      OWNER_KEY: 'u:u_ana',
      DEFAULT_LOCALE: 'pt-BR',
    });
    expect(JSON.parse(vars.INSTANCE_JWKS ?? '{}').keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256' });
    expect(main?.metadata).toMatchObject({
      main_module: 'project-worker.mjs',
      compatibility_flags: ['nodejs_compat'],
      keep_bindings: ['secret_text'],
      migrations: { new_tag: 'v1', new_sqlite_classes: ['Project'] },
      containers: [{ class_name: 'Project', images: { agent: IMAGE } }],
      tags: ['bohr', `bohr-project:${projectId}`],
      annotations: { 'workers/message': 'bohr', 'workers/tag': expect.stringMatching(/^bohr-\d+\.\d+\.\d+$/) },
    });
    // Account owners can tell bohr's calls apart
    const cloudflareCalls = world.calls.filter((entry) => entry.url.hostname === 'api.cloudflare.com');
    expect(cloudflareCalls.length).toBeGreaterThan(0);
    for (const entry of cloudflareCalls) {
      expect(entry.headers.get('user-agent')).toMatch(/^bohr\/\d+\.\d+\.\d+ \(\+https:\/\/bohr\.io\)$/);
    }
    expect(bindings).toContainEqual({ type: 'durable_object_namespace', name: 'PROJECT', class_name: 'Project' });
    expect(world.secrets.get(runtime?.script ?? '')?.get('PROJECT_SECRET')).toMatch(/^[\w-]{40,}$/);
    expect(world.applications.get(`ns-${runtime?.script}`)).toMatchObject({ scheduling_policy: 'durable_object' });
    const preview = world.scripts.get(runtime?.previewScript ?? '');
    expect(preview?.metadata.bindings).toEqual([
      { type: 'service', name: 'PROJECT', service: runtime?.script, entrypoint: 'Preview' },
    ]);
    expect([...world.workersDev].sort()).toEqual([runtime?.previewScript, runtime?.script].sort());
    // Production deploys from Actions ask bohr for the owner's token: none goes to the repository
    expect([...world.actionsSecrets]).toEqual([]);
    expect(vars.DEPLOY_TARGET).toBe('wrangler');

    // The agent's model, in the user's settings: it reaches every project and starts the first import
    const projectPath = `/api/projects/${projectId}/runtime`;
    const secrets = () => world.secrets.get(runtime?.script ?? '');
    const agent = (body: unknown) => call('/api/me/agent', { method: 'PUT', headers, body: JSON.stringify(body) });
    expect((await agent({ provider: 'anthropic', apiKey: 'sk-ant-api03-wrongkey-0123456789abcdef' })).status).toBe(400);
    expect(world.projectWorkerCalls).toEqual([]);
    const saved = await agent({
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-validkey-0123456789abcdef',
      effort: 'high',
    });
    expect(await saved.json()).toEqual({
      agent: {
        configured: true,
        provider: 'anthropic',
        baseUrl: null,
        model: null,
        effort: 'high',
        keyHint: '…cdef',
      },
      projects: { applied: 1, failed: 0 },
    });
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe('sk-ant-api03-validkey-0123456789abcdef');
    expect(secrets()?.get('AGENT_EFFORT')).toBe('high');
    expect(secrets()?.get('AGENT_PROVIDER')).toBe('anthropic');
    expect(secrets()?.has('AGENT_BASE_URL')).toBe(false);
    expect(world.projectWorkerCalls.map((entry) => entry.url.pathname)).toEqual(['/__bohr/api/v1/import']);

    // A compatible provider: base URL, its key and a model; the import does not run again
    expect(
      (
        await agent({
          provider: 'compatible',
          apiKey: 'sk-ant-api03-validkey-0123456789abcdef',
          baseUrl: 'https://llm.example.com/anthropic',
        })
      ).status,
    ).toBe(400);
    const compatible = await agent({
      provider: 'compatible',
      apiKey: 'sk-ant-api03-validkey-0123456789abcdef',
      baseUrl: 'https://llm.example.com/anthropic/v1/',
      model: 'kimi-k2',
    });
    expect(compatible.status).toBe(200);
    expect(secrets()?.get('AGENT_BASE_URL')).toBe('https://llm.example.com/anthropic');
    expect(secrets()?.get('AGENT_MODEL')).toBe('kimi-k2');
    expect(secrets()?.has('AGENT_EFFORT')).toBe(false);
    expect(world.projectWorkerCalls).toHaveLength(1);
    const view = (await (await call('/api/me/agent', { headers })).json()) as { agent: { provider: string } };
    expect(view.agent).toMatchObject({ configured: true, provider: 'compatible', model: 'kimi-k2' });
    // Changing only the model keeps the stored key
    expect(
      (await agent({ provider: 'compatible', baseUrl: 'https://llm.example.com/anthropic', model: 'glm-5' })).status,
    ).toBe(200);
    expect(secrets()?.get('AGENT_MODEL')).toBe('glm-5');
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe('sk-ant-api03-validkey-0123456789abcdef');
    expect(secrets()?.get('AGENT_PROVIDER')).toBe('compatible');

    // The Claude subscription: the official CLI's setup-token runs in the project's container; the instance
    // relays the link and the code, and keeps the token (the browser never sees it)
    const subscription = (step: string, body: unknown = {}) =>
      call(`/api/me/agent/subscription/${step}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const workerCalls = world.projectWorkerCalls.length;
    const started = await subscription('start');
    expect(await started.json()).toEqual({ projectId, loginId: 'login_0123456789', url: world.claudeLoginUrl });
    const startCall = world.projectWorkerCalls.at(-1);
    expect(startCall?.url.href).toBe(`${runtime?.workerUrl}/__bohr/api/v1/claude-login/start`);
    expect(startCall?.headers.get('authorization')).toMatch(/^Bearer ey/);
    const finish = (code: string, extra: Record<string, unknown> = {}) =>
      subscription('finish', { projectId, loginId: 'login_0123456789', code, effort: 'high', ...extra });
    const refused = await finish('wrong-code#state');
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: 'OAuth error: Invalid authorization code', code: 'code_rejected' });
    expect((await finish('good-code#state', { projectId: 'p_someone_else' })).status).toBe(404);
    expect((await finish('has spaces')).status).toBe(400);
    const anthropicCalls = world.calls.filter((entry) => entry.url.hostname === 'api.anthropic.com').length;
    const connected = await finish('good-code#state');
    const connectedText = await connected.text();
    expect(connectedText).not.toContain(world.claudeToken);
    expect(JSON.parse(connectedText)).toEqual({
      agent: {
        configured: true,
        provider: 'subscription',
        baseUrl: null,
        model: null,
        effort: 'high',
        keyHint: '…wxyz',
      },
      projects: { applied: 1, failed: 0 },
    });
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe(world.claudeToken);
    expect(secrets()?.get('AGENT_PROVIDER')).toBe('subscription');
    expect(secrets()?.has('AGENT_BASE_URL')).toBe(false);
    expect(secrets()?.has('AGENT_MODEL')).toBe(false);
    // Only the format is checked: nothing calls Anthropic with the token
    expect(world.calls.filter((entry) => entry.url.hostname === 'api.anthropic.com')).toHaveLength(anthropicCalls);
    const connectAudit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'agent.subscription.connect'))
      .get();
    expect(connectAudit).toMatchObject({ actorUserId: 'u_ana' });
    expect(JSON.stringify(connectAudit)).not.toContain(world.claudeToken);
    expect((await subscription('cancel', { projectId, loginId: 'login_0123456789' })).status).toBe(200);
    expect(world.projectWorkerCalls.slice(workerCalls).map((entry) => entry.url.pathname)).toEqual([
      '/__bohr/api/v1/claude-login/start',
      '/__bohr/api/v1/claude-login/finish',
      '/__bohr/api/v1/claude-login/finish',
      '/__bohr/api/v1/claude-login/cancel',
    ]);
    // The chat proxy never reaches the sign-in (it would hand the token to the browser)
    const proxied = await call(`/api/projects/${projectId}/agent/claude-login/finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ loginId: 'login_0123456789', code: 'good-code#state' }),
    });
    expect(proxied.status).toBe(404);
    expect(world.projectWorkerCalls).toHaveLength(workerCalls + 4);

    // The fallback: a token made with `claude setup-token` elsewhere, pasted; an API key is not one, and the
    // Anthropic provider refuses a subscription token
    expect((await agent({ provider: 'subscription', apiKey: 'sk-ant-api03-validkey-0123456789abcdef' })).status).toBe(
      400,
    );
    const pastedToken = `sk-ant-oat01-${'p'.repeat(40)}last`;
    expect((await agent({ provider: 'anthropic', apiKey: pastedToken })).status).toBe(400);
    const pasted = await agent({ provider: 'subscription', apiKey: pastedToken, model: 'claude-sonnet-5-5' });
    expect(((await pasted.json()) as { agent: unknown }).agent).toMatchObject({
      provider: 'subscription',
      model: 'claude-sonnet-5-5',
      keyHint: '…last',
    });
    expect(secrets()?.get('ANTHROPIC_API_KEY')).toBe(pastedToken);
    expect(secrets()?.get('AGENT_MODEL')).toBe('claude-sonnet-5-5');
    expect(world.calls.filter((entry) => entry.url.hostname === 'api.anthropic.com')).toHaveLength(anthropicCalls);
    await call('/api/me/agent', { method: 'DELETE', headers });
    expect(secrets()?.has('AGENT_PROVIDER')).toBe(false);
    expect(secrets()?.has('ANTHROPIC_API_KEY')).toBe(false);
    expect(secrets()?.has('AGENT_MODEL')).toBe(false);

    const bot = await call(`${projectPath}/telegram-bot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: '42424242:managed-token-for-the-project-bot-0123' }),
    });
    expect(await bot.json()).toEqual({ username: 'loja_ana_bot' });
    const webhook = world.telegram.find((entry) => entry.method === 'setWebhook');
    expect(webhook?.body).toMatchObject({ url: `${runtime?.workerUrl}/__bohr/telegram`, drop_pending_updates: true });
    expect(world.secrets.get(runtime?.script ?? '')?.get('TELEGRAM_WEBHOOK_SECRET')).toBe(webhook?.body.secret_token);

    await call(`${projectPath}/import`, { method: 'POST', headers });
    const importCall = world.projectWorkerCalls.at(-1);
    expect(importCall?.url.pathname).toBe('/__bohr/api/v1/import');
    expect(importCall?.headers.get('authorization')).toMatch(/^Bearer ey/);

    // The danger zone: the name confirms it; the agent goes, and with deleteSite the deploy secrets too
    const remove = (body: unknown) =>
      call(`/api/projects/${projectId}`, { method: 'DELETE', headers, body: JSON.stringify(body) });
    expect((await remove({ confirm: 'other', deleteSite: true })).status).toBe(400);
    const removed = await remove({ confirm: 'loja', deleteSite: true });
    expect(removed.status).toBe(200);
    expect(world.scripts.has(runtime?.script ?? '')).toBe(false);
    expect(world.scripts.has(runtime?.previewScript ?? '')).toBe(false);
    expect(world.applications.size).toBe(0);
    expect([...world.actionsSecrets]).toEqual([]);
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toBeUndefined();
    expect((await call(`/api/projects/${projectId}`, { headers })).status).toBe(404);
    // The site's Worker was never deployed here: reported, not fatal
    expect(((await removed.json()) as { warnings: string[] }).warnings).toEqual([
      expect.stringContaining('site Worker'),
    ]);
  });

  it('explains missing token permissions and lets the user pick among several accounts', async () => {
    const headers = await signedInUser();
    // Containers are optional: never reported missing, whatever else is
    world.deniedCapabilities.add('scripts');
    world.deniedCapabilities.add('containers');
    const missing = await call('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    const body = (await missing.json()) as { status: string; missing: string[]; errors: Record<string, string> };
    expect(body).toMatchObject({ status: 'missing', missing: ['workers_scripts'] });
    expect(Object.keys(body.errors)).toEqual(['workers_scripts']);

    world.deniedCapabilities.clear();
    world.accounts.push({ id: 'acc-work', name: 'Work' });
    const choose = await call('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    expect(await choose.json()).toMatchObject({
      status: 'choose_account',
      accounts: [{ id: 'acc-user' }, { id: 'acc-work' }],
    });
    const chosen = await call('/api/onboarding/cloudflare/account', {
      method: 'POST',
      headers,
      body: JSON.stringify({ accountId: 'acc-work' }),
    });
    expect(await chosen.json()).toMatchObject({ status: 'connected', accountName: 'Work' });
  });

  it('connects a free account: its projects deploy without the agent until the account can run Containers', async () => {
    const headers = await signedInUser();
    world.deniedCapabilities.add('containers');
    const connected = await call('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    expect(await connected.json()).toMatchObject({ status: 'connected', containers: false });
    const connection = await db.select().from(cfConnections).get();
    expect(connection?.capabilities).toMatchObject({ workers_scripts: true, containers: false });

    const { github } = (await (await call('/api/onboarding', { headers })).json()) as {
      github: { installUrl: string };
    };
    await installed(call, 55, new URL(github.installUrl).searchParams.get('state') ?? '');
    const created = await call('/api/onboarding/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repository: 'ana/loja' }),
    });
    expect(created.status).toBe(201);
    const { projectId, runtime } = (await created.json()) as { projectId: string; runtime: boolean };
    expect(runtime).toBe(false);
    // The site deploys to the owner's account; there is no runtime to provision
    expect(provisioning).toEqual([]);
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toMatchObject({
      mode: 'byo',
      cfConnectionId: connection?.id,
    });
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toBeUndefined();
    const credentials = await deployCredentials(db, selfHosted, {
      repository: 'ana/loja',
      repository_id: '901',
      repository_owner: 'ana',
      ref: 'refs/heads/main',
      event_name: 'push',
      job_workflow_ref: `ana/loja/${DEPLOY_WORKFLOW_PATH}@refs/heads/main`,
    });
    expect(credentials).toMatchObject({ accountId: 'acc-user', apiToken: 'cf-user-token-0123456789abcdefghijklmnop' });

    // Turning the agent on says why it cannot run, without Cloudflare's raw error
    const enable = () => call(`/api/projects/${projectId}/runtime/enable`, { method: 'POST', headers });
    const refused = await enable();
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      code: 'containers_unavailable',
      error: expect.stringContaining('Workers Paid'),
    });
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toBeUndefined();

    // After the upgrade, turning it on checks again: the runtime goes to the owner's account
    world.deniedCapabilities.clear();
    expect((await enable()).status).toBe(201);
    expect(provisioning).toEqual([{ projectId, userId: 'u_ana' }]);
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toMatchObject({
      accountId: 'acc-user',
      cfConnectionId: connection?.id,
    });
    expect((await db.select().from(cfConnections).get())?.capabilities).toMatchObject({ containers: true });
  });

  it('records a provisioning failure the user can retry', async () => {
    const headers = await signedInUser();
    await call('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    const { github } = (await (await call('/api/onboarding', { headers })).json()) as {
      github: { installUrl: string };
    };
    await installed(call, 55, new URL(github.installUrl).searchParams.get('state') ?? '');
    const { projectId } = (await (
      await call('/api/onboarding/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ repository: 'ana/loja' }),
      })
    ).json()) as { projectId: string };

    world.subdomain = null;
    await expect(provisionRuntime(db, selfHosted, projectId)).rejects.toThrow(/workers.dev subdomain/);
    expect(await (await call(`/api/projects/${projectId}/runtime`, { headers })).json()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('workers.dev subdomain'),
    });
    await call(`/api/projects/${projectId}/runtime/retry`, { method: 'POST', headers });
    expect(provisioning.at(-1)).toMatchObject({ projectId });

    // Once it runs, an update that fails leaves it running and usable (bot, chat), with the error noted
    world.subdomain = 'ana';
    await provisionRuntime(db, selfHosted, projectId);
    // An update asks the project's Durable Object to restart on the new code
    await provisionRuntime(db, selfHosted, projectId);
    expect(world.projectWorkerCalls.at(-1)?.url.pathname).toBe('/__bohr/api/v1/restart');
    world.subdomain = null;
    await expect(provisionRuntime(db, selfHosted, projectId)).rejects.toThrow(/workers.dev subdomain/);
    expect(await (await call(`/api/projects/${projectId}/runtime`, { headers })).json()).toMatchObject({
      status: 'ready',
      error: expect.stringContaining('workers.dev subdomain'),
    });
  });
});

describe('platform bot', () => {
  const PLATFORM = '1111:';
  let updateId = 0;
  const from = { id: 777001, is_bot: false, first_name: 'Ana', language_code: 'pt-br' };

  async function webhook(update: Record<string, unknown>) {
    const secret = world.telegram.find((entry) => entry.method === 'setWebhook')?.body.secret_token as string;
    return call('/api/telegram/platform', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: ++updateId, ...update }),
    });
  }
  const text = (value: string) =>
    webhook({
      message: { message_id: ++updateId, date: 1, chat: { id: from.id, type: 'private' }, from, text: value },
    });
  const tap = (data: string) =>
    webhook({
      callback_query: {
        id: `cb${updateId}`,
        from,
        message: { message_id: 1, chat: { id: from.id, type: 'private' }, date: 1 },
        data,
      },
    });

  it('walks a Telegram user from /start to a running project bot', async () => {
    const setup = await call('/api/admin/platform-bot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
    });
    expect(await setup.json()).toMatchObject({
      username: 'bohr_platform_bot',
      canManageBots: true,
      webhookUrl: 'https://bohr.ana.workers.dev/api/telegram/platform',
    });
    expect((await call('/api/telegram/platform', { method: 'POST', body: '{}' })).status).toBe(401);

    await text('/start');
    expect(world.sentBy(PLATFORM).slice(-2)[0]).toContain('Olá, Ana!');
    expect(world.sentBy(PLATFORM).at(-1)).toContain('1/2 · Cloudflare');

    await text('cf-user-token-0123456789abcdefghijklmnop');
    expect(world.telegram.some((entry) => entry.method === 'deleteMessage')).toBe(true);
    expect(world.sentBy(PLATFORM).at(-1)).toContain('2/2 · GitHub');
    const githubPrompt = world.telegram.filter((entry) => entry.method === 'sendMessage').at(-1);
    const installUrl = JSON.stringify(githubPrompt?.body.reply_markup).match(/state=([\w-]+)/)?.[1] ?? '';

    const back = await installed(call, 55, installUrl);
    expect(back.headers.get('Location')).toBe('https://t.me/bohr_platform_bot');
    // The onboarding ends with the accounts; projects come with /novo
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Tudo configurado!');
    await text('/novo');
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Qual repositório vira um projeto na bohr?');

    await tap('repo:901');
    expect(provisioning).toHaveLength(1);
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Preparando ana/loja');
    const { projectId, userId } = provisioning[0] ?? { projectId: '', userId: '' };
    // The agent was set up on the web meanwhile: the Workflow hands it to the project, which starts the import
    await saveAgentSettings(db, selfHosted, userId, {
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-validkey-0123456789abcdef',
    });
    await provisionRuntime(db, selfHosted, projectId);
    expect(await applyOwnerAgent(db, selfHosted, projectId)).toBe(true);
    expect(world.projectWorkerCalls.at(-1)?.url.pathname).toBe('/__bohr/api/v1/import');
    await notifyProvisioned(db, selfHosted, userId, projectId, null);
    expect(world.sentBy(PLATFORM).slice(-2)[0]).toContain('o agente já está preparando o repositório');
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    expect(world.secrets.get(runtime?.script ?? '')?.get('ANTHROPIC_API_KEY')).toBe(
      'sk-ant-api03-validkey-0123456789abcdef',
    );
    const askBot = world.telegram.filter((entry) => entry.method === 'sendMessage').at(-1);
    expect(askBot?.body.reply_markup).toMatchObject({
      keyboard: [[{ request_managed_bot: { suggested_name: 'loja' } }]],
    });
    // OWNER_KEY follows the Telegram account
    const ownerBindings = (world.scripts.get(runtime?.script ?? '')?.metadata.bindings ?? []) as {
      name: string;
      text?: string;
    }[];
    const vars = ownerBindings.find((binding) => binding.name === 'OWNER_KEY');
    expect(vars?.text).toBe('tg:777001');

    // Telegram reports the bot the user created through the platform bot
    await webhook({
      managed_bot: { user: from, bot: { id: 42424242, is_bot: true, first_name: 'Loja', username: 'loja_ana_bot' } },
    });
    expect(world.telegram.find((entry) => entry.method === 'getManagedBotToken')?.body).toEqual({ user_id: 42424242 });
    expect(world.secrets.get(runtime?.script ?? '')?.get('TELEGRAM_BOT_TOKEN')).toBe(
      '42424242:managed-token-for-the-project-bot-0123',
    );
    expect(world.projectWorkerCalls).toHaveLength(1);
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Converse com @loja_ana_bot');

    await text('/status');
    expect(world.sentBy(PLATFORM).at(-1)).toContain('ana/loja: ready · @loja_ana_bot');
  });

  it('creates the project of an account without Containers and says why the agent waits', async () => {
    await call('/api/admin/platform-bot', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } });
    world.deniedCapabilities.add('containers');
    await text('/start');
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Uma conta gratuita basta');
    await text('cf-user-token-0123456789abcdefghijklmnop');
    expect(world.sentBy(PLATFORM).at(-1)).toContain('2/2 · GitHub');
    const githubPrompt = world.telegram.filter((entry) => entry.method === 'sendMessage').at(-1);
    await installed(call, 55, JSON.stringify(githubPrompt?.body.reply_markup).match(/state=([\w-]+)/)?.[1] ?? '');
    await text('/novo');
    await tap('repo:901');
    expect(provisioning).toEqual([]);
    expect(world.sentBy(PLATFORM).at(-1)).toContain('Workers Paid');
    expect(await db.select().from(projects).where(eq(projects.repoKey, 'ana/loja')).get()).toBeDefined();
  });

  it('no longer signs anyone in with Telegram: the routes are gone and login_ links just start the bot', async () => {
    await call('/api/admin/platform-bot', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } });
    expect((await call('/auth/telegram?redirect=/projects')).status).toBe(404);
    expect((await call('/auth/telegram/finish?code=x&token=y')).status).toBe(404);
    await text('/start login_somecode');
    expect(world.sentBy(PLATFORM).some((message) => message.includes('Olá, Ana!'))).toBe(true);
    const buttons = JSON.stringify(world.telegram.map((entry) => entry.body.reply_markup ?? null));
    expect(buttons).not.toContain('/auth/telegram');
  });
});

describe('linking a Telegram account', () => {
  it('asks the Telegram user to confirm which bohr account they join', async () => {
    const headers = await signedInUser();
    await call('/api/admin/platform-bot', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } });
    const { url } = (await (await call('/api/me/telegram-link', { method: 'POST', headers })).json()) as {
      url: string;
    };
    const start = new URL(url).searchParams.get('start') ?? '';
    const secret = world.telegram.find((entry) => entry.method === 'setWebhook')?.body.secret_token as string;
    const from = { id: 888001, is_bot: false, first_name: 'Ana', language_code: 'pt-br' };
    const send = (update: Record<string, unknown>) =>
      call('/api/telegram/platform', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: Date.now(), ...update }),
      });

    await send({
      message: { message_id: 1, date: 1, chat: { id: from.id, type: 'private' }, from, text: `/start ${start}` },
    });
    expect(world.sentBy('1111:').at(-1)).toContain('Vincular este Telegram à conta da bohr Ana?');
    const identityBefore = await db.select().from(identities).where(eq(identities.providerUserId, '888001')).get();
    expect(identityBefore?.userId).not.toBe('u_ana');

    const code = start.replace('link_', '');
    await send({
      callback_query: {
        id: 'cb1',
        from,
        message: { message_id: 2, chat: { id: from.id, type: 'private' }, date: 1 },
        data: `link:${code}`,
      },
    });
    expect(world.sentBy('1111:').at(-1)).toContain('ligado à sua conta da bohr');
    const identityAfter = await db.select().from(identities).where(eq(identities.providerUserId, '888001')).get();
    expect(identityAfter?.userId).toBe('u_ana');
  });
});

describe('bohr.io Cloud', () => {
  // The test configuration has bohr.io Cloud's account ("acc") and Stripe billing on
  const cloud = {
    ...env,
    APP_URL: undefined,
    GITHUB_CLIENT_ID: undefined,
    GITHUB_CLIENT_SECRET: undefined,
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_ID: 'price_20usd',
  };
  const cloudCall = (path: string, init: RequestInit = {}) => app.request(path, init, cloud);

  it('asks for the subscription first, then runs the project in the user own Cloudflare account', async () => {
    const headers = await signedInUser();
    const stripe = world.fetch;
    world.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://api.stripe.com/v1/checkout/sessions')
        return Response.json({ url: 'https://checkout.stripe.com/c/pay' });
      return stripe(input, init);
    };
    deps.fetch = world.fetch;

    const first = (await (await cloudCall('/api/onboarding', { headers })).json()) as {
      step: string;
      billing: { enabled: boolean; subscribed: boolean };
    };
    expect(first).toMatchObject({ step: 'subscription', billing: { enabled: true, subscribed: false } });
    const unpaid = await cloudCall('/api/onboarding/subscription', { method: 'POST', headers });
    expect(await unpaid.json()).toEqual({
      status: 'payment_required',
      checkoutUrl: 'https://checkout.stripe.com/c/pay',
    });

    // Everything else can be connected, but no project is created without a subscription
    await cloudCall('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    // The wizard shows the install link after the subscription; the link itself works before it
    await installed(
      cloudCall,
      55,
      new URL(await installUrl(db, cloud, 'u_ana', 'web')).searchParams.get('state') ?? '',
    );
    const blocked = await cloudCall('/api/onboarding/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repository: 'ana/loja' }),
    });
    expect(blocked.status).toBe(402);

    await db
      .insert(subscriptions)
      .values({ id: 'sub_1', userId: 'u_ana', stripeCustomerId: 'cus_ana', status: 'active', priceId: 'price_20usd' })
      .run();
    const paid = await cloudCall('/api/onboarding/subscription', { method: 'POST', headers });
    expect(await paid.json()).toEqual({ status: 'ready' });
    const next = (await (await cloudCall('/api/onboarding', { headers })).json()) as { step: string };
    expect(next.step).toBe('done');

    const created = await cloudCall('/api/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repository: 'ana/loja' }),
    });
    expect(created.status).toBe(201);
    const { projectId } = (await created.json()) as { projectId: string };
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    expect(project?.mode).toBe('byo');

    await provisionRuntime(db, cloud, projectId, { sleep: async () => {} });
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    expect(runtime?.status).toBe('ready');
    expect(runtime?.accountId).not.toBe('acc');
    expect(runtime?.cfConnectionId).not.toBeNull();
    const bindings = world.scripts.get(runtime?.script ?? '')?.metadata.bindings as { name: string; text?: string }[];
    expect(bindings.find((binding) => binding.name === 'DEPLOY_TARGET')?.text).toBe('wrangler');
    expect([...world.actionsSecrets]).toEqual([]);

    // A repository an older version set up keeps its Cloudflare secrets while its workflow still reads them
    const legacy = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
    for (const name of [...legacy, 'OTHER_SECRET']) world.actionsSecrets.add(name);
    const workflow = () =>
      renderDeployWorkflow(deployConfigSchema.parse({ build: 'npm run build' }), {
        productionBranch: 'main',
        target: 'wrangler',
        instanceUrl: 'https://app.bohr.io',
      });
    world.repoFiles.set(
      DEPLOY_WORKFLOW_PATH,
      workflow()
        .replace('steps.bohr-credentials.outputs.cloudflare-api-token', 'secrets.CLOUDFLARE_API_TOKEN')
        .replace('steps.bohr-credentials.outputs.cloudflare-account-id', 'secrets.CLOUDFLARE_ACCOUNT_ID'),
    );
    await provisionRuntime(db, cloud, projectId, { sleep: async () => {} });
    expect([...world.actionsSecrets].sort()).toEqual([...legacy, 'OTHER_SECRET']);
    // Once the workflow on the production branch asks bohr, the next provisioning removes them
    world.repoFiles.set(DEPLOY_WORKFLOW_PATH, workflow());
    await provisionRuntime(db, cloud, projectId, { sleep: async () => {} });
    expect([...world.actionsSecrets]).toEqual(['OTHER_SECRET']);
    const contents = world.calls.filter((entry) => entry.url.pathname.includes('/contents/'));
    expect(contents.at(-1)?.url.searchParams.get('ref')).toBe('main');
    // Updating the runtime never fails on that cleanup
    world.repoFiles.set(DEPLOY_WORKFLOW_PATH, 'not: [yaml');
    await provisionRuntime(db, cloud, projectId, { sleep: async () => {} });
    expect((await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get())?.status).toBe('ready');
  });
});

describe('Claude subscription', () => {
  it('needs a project whose agent is ready to run the sign-in in', async () => {
    const headers = await signedInUser();
    const response = await call('/api/me/agent/subscription/start', { method: 'POST', headers, body: '{}' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'no_runtime' });
    expect(world.projectWorkerCalls).toEqual([]);
  });
});

describe('optional steps', () => {
  it('reads the old Anthropic key step as the optional project bot step', async () => {
    await signedInUser();
    await db
      .insert(onboardingTable)
      .values({ userId: 'u_ana', step: 'anthropic', data: { step: 'anthropic', projectId: 'p_any' } })
      .run();
    expect(await readOnboarding(db, 'u_ana')).toEqual({ step: 'project_bot', projectId: 'p_any' });
  });
});

describe('runtime placement on bohr.io Cloud', () => {
  // bohr.io Cloud's account ("acc", CF_API_TOKEN) is in the test configuration; billing stays off here
  const cloud = { ...env, APP_URL: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined };
  const cloudCall = (path: string, init: RequestInit = {}) => app.request(path, init, cloud);

  async function createProject(headers: Record<string, string>) {
    await cloudCall('/api/onboarding/cloudflare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }),
    });
    await installed(
      cloudCall,
      55,
      new URL(await installUrl(db, cloud, 'u_ana', 'web')).searchParams.get('state') ?? '',
    );
    const created = await cloudCall('/api/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repository: 'ana/loja' }),
    });
    expect(created.status).toBe(201);
    return (await created.json()) as { projectId: string; runtime: boolean };
  }

  it("runs the agent of an account without Containers in bohr's account; the site deploys to the owner's", async () => {
    const headers = await signedInUser();
    world.deniedCapabilities.add('containers');
    await writeSetting(db, 'runtime_image:acc', { source: DEFAULT_RUNTIME_IMAGE, reference: IMAGE });
    const { projectId, runtime: placed } = await createProject(headers);
    expect(placed).toBe(true);
    expect(provisioning).toEqual([{ projectId, userId: 'u_ana' }]);
    const connection = await db.select().from(cfConnections).get();
    expect(await db.select().from(projects).where(eq(projects.id, projectId)).get()).toMatchObject({
      mode: 'byo',
      cfConnectionId: connection?.id,
    });
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toMatchObject({
      accountId: 'acc',
      cfConnectionId: null,
    });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'project.create')).get()).toMatchObject({
      metadata: { runtime: 'bohr' },
    });

    // Provisioned with bohr's token in bohr's account; the project Worker still deploys with wrangler
    world.calls = [];
    await provisionRuntime(db, cloud, projectId, { sleep: async () => {} });
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get();
    expect(runtime?.status).toBe('ready');
    const accounts = world.calls
      .filter((entry) => entry.url.hostname === 'api.cloudflare.com')
      .map((entry) => ({
        account: /^\/client\/v4\/accounts\/([^/]+)/.exec(entry.url.pathname)?.[1],
        token: entry.headers.get('authorization'),
      }));
    expect(accounts.length).toBeGreaterThan(0);
    expect(new Set(accounts.map((entry) => entry.account))).toEqual(new Set(['acc']));
    expect(new Set(accounts.map((entry) => entry.token))).toEqual(new Set([`Bearer ${env.CF_API_TOKEN}`]));
    const bindings = world.scripts.get(runtime?.script ?? '')?.metadata.bindings as { name: string; text?: string }[];
    expect(bindings.find((binding) => binding.name === 'DEPLOY_TARGET')?.text).toBe('wrangler');

    // Production deploys get the owner's token for the owner's account, never bohr's
    const credentials = await deployCredentials(db, cloud, {
      repository: 'ana/loja',
      repository_id: '901',
      repository_owner: 'ana',
      ref: 'refs/heads/main',
      event_name: 'push',
      job_workflow_ref: `ana/loja/${DEPLOY_WORKFLOW_PATH}@refs/heads/main`,
    });
    expect(credentials).toMatchObject({ accountId: 'acc-user', apiToken: 'cf-user-token-0123456789abcdefghijklmnop' });

    // The connection the site deploys with cannot be removed while the project uses it
    const removed = await cloudCall(`/api/me/cloudflare/${connection?.id}`, { method: 'DELETE', headers });
    expect(removed.status).toBe(409);
  });

  it("keeps the agent in the owner's account when it can run Containers", async () => {
    const headers = await signedInUser();
    const { projectId } = await createProject(headers);
    const connection = await db.select().from(cfConnections).get();
    expect(await db.select().from(runtimes).where(eq(runtimes.projectId, projectId)).get()).toMatchObject({
      accountId: 'acc-user',
      cfConnectionId: connection?.id,
    });
  });

  it('still needs the subscription before bohr runs anything', async () => {
    const headers = await signedInUser();
    world.deniedCapabilities.add('containers');
    const billing = { ...cloud, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec', STRIPE_PRICE_ID: 'p' };
    await app.request(
      '/api/onboarding/cloudflare',
      { method: 'POST', headers, body: JSON.stringify({ token: 'cf-user-token-0123456789abcdefghijklmnop' }) },
      billing,
    );
    await installed(
      (path, init) => app.request(path, init, billing),
      55,
      new URL(await installUrl(db, billing, 'u_ana', 'web')).searchParams.get('state') ?? '',
    );
    const blocked = await app.request(
      '/api/projects',
      { method: 'POST', headers, body: JSON.stringify({ repository: 'ana/loja' }) },
      billing,
    );
    expect(blocked.status).toBe(402);
    expect(await db.select().from(runtimes).all()).toEqual([]);
    expect(provisioning).toEqual([]);
  });
});

describe('migrated projects', () => {
  it('turns the agent on for a project that only deploys', async () => {
    const headers = await signedInUser();
    await db
      .insert(projects)
      .values({
        id: 'p_migrated',
        ownerUserId: 'u_ana',
        name: 'Loja v1',
        repoOwner: 'ana',
        repoName: 'loja-v1',
        repoKey: 'ana/loja-v1',
        mode: 'managed',
      })
      .run();
    await db.insert(projectMembers).values({ projectId: 'p_migrated', userId: 'u_ana', role: 'owner' }).run();

    const enabled = await app.request('/api/projects/p_migrated/runtime/enable', { method: 'POST', headers }, env);
    expect(enabled.status).toBe(201);
    expect(provisioning).toEqual([{ projectId: 'p_migrated', userId: 'u_ana' }]);
    const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, 'p_migrated')).get();
    expect(runtime).toMatchObject({ accountId: 'acc', cfConnectionId: null, status: 'pending' });
    expect(runtime?.script).toMatch(/^bohr-loja-v1-[a-z0-9]{6}$/);

    const again = await app.request('/api/projects/p_migrated/runtime/enable', { method: 'POST', headers }, env);
    expect(again.status).toBe(409);
  });

  it('with billing on, asks Stripe about an imported v1 subscription before refusing', async () => {
    const headers = await signedInUser();
    const billing = {
      ...env,
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec',
      STRIPE_PRICE_ID: 'price_20',
    };
    for (const [id, repo] of [
      ['p_paid', 'paid'],
      ['p_free', 'free'],
    ] as const) {
      await db
        .insert(projects)
        .values({
          id,
          ownerUserId: 'u_ana',
          name: repo,
          repoOwner: 'ana',
          repoName: repo,
          repoKey: `ana/${repo}`,
          mode: 'managed',
        })
        .run();
      await db.insert(projectMembers).values({ projectId: id, userId: 'u_ana', role: 'owner' }).run();
    }
    const enable = (id: string) =>
      app.request(`/api/projects/${id}/runtime/enable`, { method: 'POST', headers }, billing);

    // No subscription at all: hosting with bohr is paid
    expect((await enable('p_free')).status).toBe(402);

    await db
      .insert(subscriptions)
      .values({ id: 'sub_v1', userId: 'u_ana', stripeCustomerId: 'cus_v1', status: 'imported', legacy: true })
      .run();
    const previous = world.fetch;
    world.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin === 'https://api.stripe.com' && url.pathname === '/v1/subscriptions') {
        expect(url.searchParams.get('customer')).toBe('cus_v1');
        return Response.json({
          data: [
            {
              id: 'sub_stripe',
              customer: 'cus_v1',
              status: 'active',
              items: { data: [{ price: { id: 'price_v1' } }] },
            },
          ],
        });
      }
      return previous(input, init);
    };
    deps.fetch = world.fetch;

    expect((await enable('p_paid')).status).toBe(201);
    const row = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, 'cus_v1')).get();
    expect(row).toMatchObject({ status: 'active', legacy: true, priceId: 'price_v1' });
  });
});

describe('GitHub installations', () => {
  it('brings people back to where they started the installation', async () => {
    await signedInUser();
    await call('/api/admin/platform-bot', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } });
    const web = new URL(await installUrl(db, selfHosted, 'u_ana', 'web')).searchParams.get('state') ?? '';
    expect((await installed(call, 55, web)).headers.get('Location')).toBe('/start');
    const telegram = new URL(await installUrl(db, selfHosted, 'u_ana', 'telegram')).searchParams.get('state') ?? '';
    expect((await installed(call, 55, telegram)).headers.get('Location')).toBe('https://t.me/bohr_platform_bot');
  });

  it('links only installations the GitHub user can access, and never takes one from another account', async () => {
    await signedInUser();
    const state = new URL(await installUrl(db, selfHosted, 'u_ana', 'web')).searchParams.get('state') ?? '';
    world.userInstallations = [55];
    const forged = await installed(call, 77, state);
    expect(forged.status).toBe(403);
    expect(await db.select().from(githubInstallations).all()).toEqual([]);

    await db.insert(users).values({ id: 'u_other', name: 'Other' }).run();
    await db.insert(githubInstallations).values({ id: 55, accountLogin: 'ana', userId: 'u_other' }).run();
    const taken = await installed(call, 55, state);
    expect(taken.status).toBe(409);
    expect((await db.select().from(githubInstallations).where(eq(githubInstallations.id, 55)).get())?.userId).toBe(
      'u_other',
    );
  });
});
