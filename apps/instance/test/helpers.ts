import { env } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { resetRuntimeKeyCache } from '../src/services/runtime-keys';
import { FakeCloudflare } from './fake-cloudflare';

const keys = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'RS256' };
const localJwks = createLocalJWKSet({ keys: [publicJwk] });

// A GitHub Actions OIDC token signed by the test key, which the instance trusts during tests
export async function oidcToken(
  repository: string,
  branch: string,
  options: {
    audience?: string;
    issuer?: string;
    expiresIn?: string;
    repositoryId?: string;
    /** Other claims, or overrides (event_name, job_workflow_ref, ref…). */
    claims?: Record<string, unknown>;
  } = {},
) {
  return new SignJWT({
    repository,
    ...(options.repositoryId !== undefined ? { repository_id: options.repositoryId } : {}),
    repository_owner: repository.split('/')[0],
    ref: `refs/heads/${branch}`,
    ref_type: 'branch',
    sha: 'abc1234',
    actor: 'octocat',
    run_id: '42',
    ...options.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(options.issuer ?? 'https://token.actions.githubusercontent.com')
    .setAudience(options.audience ?? 'bohr.io')
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(keys.privateKey);
}

// Storage is shared by the tests of a file: start each test from empty tables, KV and R2
export async function resetStorage() {
  const tables = [
    'dns_zones',
    'org_members',
    'runtimes',
    'onboarding',
    'cf_connections',
    'github_installations',
    'instance_settings',
    'audit_log',
    'deploy_sessions',
    'cli_logins',
    'api_tokens',
    'cli_deploys',
    'deployments',
    'env_vars',
    'build_plans',
    'runtime_secrets',
    'site_config',
    'hostnames',
    'v1_migrations',
    'subscriptions',
    'project_members',
    'projects',
    'orgs',
    'sessions',
    'email_codes',
    'identities',
    'users',
  ];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  resetRuntimeKeyCache();
  const keys = await env.ROUTES.list();
  await Promise.all(keys.keys.map((key) => env.ROUTES.delete(key.name)));
  const objects = await env.BUNDLES.list();
  if (objects.objects.length > 0) await env.BUNDLES.delete(objects.objects.map((object) => object.key));
}

export function useFakes() {
  const cloudflare = new FakeCloudflare();
  cloudflare.zones.set('bohr.io', 'zone-bohr');
  deps.githubOidcKeys = () => localJwks;
  deps.cloudflare = () => cloudflare.client();
  return cloudflare;
}

export const adminHeaders = {
  Authorization: `Bearer ${env.ADMIN_TOKEN}`,
  'Content-Type': 'application/json',
};

export function call(path: string, init: RequestInit = {}) {
  return app.request(path, init, env);
}

export async function importProject(overrides: Record<string, unknown> = {}) {
  const response = await call('/api/admin/import', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      projects: [
        {
          repoOwner: 'Acme',
          repoName: 'store',
          productionBranch: 'main',
          owner: { githubId: 1001, login: 'alice', name: 'Alice' },
          members: [{ githubId: 1002, login: 'bob' }],
          hostnames: [
            { hostname: 'store.example.com', branch: 'main', isProduction: true, zoneId: 'zone-example' },
            { hostname: 'store-acme.bohr.io', branch: 'main', isProduction: false, zoneId: 'zone-bohr' },
          ],
          config: [{ branch: '*', headers: { 'X-Frame-Options': 'SAMEORIGIN' } }],
          envVars: [
            { key: 'PUBLIC_API', target: 'runtime', isSecret: false, value: 'https://api.example.com' },
            { key: 'STRIPE_KEY', target: 'runtime', isSecret: true },
          ],
          v1SiteId: 'site-1',
          ...overrides,
        },
      ],
    }),
  });
  const body = (await response.json()) as { projects: { projectId: string; scripts: Record<string, string> }[] };
  return { response, project: body.projects?.[0] };
}

export async function startSession(
  repository: string,
  branch: string,
  manifest: Record<string, unknown> = {},
  assetsConfig: Record<string, unknown> = { notFoundHandling: 'single-page-application' },
) {
  const token = await oidcToken(repository, branch);
  const response = await call('/api/deploy/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, assetsConfig }),
  });
  return { token, response, body: (await response.json()) as Record<string, unknown> };
}

export async function finalize(
  token: string,
  sessionId: string,
  metadata: Record<string, unknown>,
  modules: Record<string, string> = { 'index.js': 'export default { fetch() { return new Response("hi"); } };' },
) {
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  for (const [name, source] of Object.entries(modules)) {
    form.append(name, new File([source], name, { type: 'application/javascript+module' }));
  }
  const response = await call(`/api/deploy/sessions/${sessionId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

export const baseMetadata = {
  mainModule: 'index.js',
  compatibilityDate: '2026-09-01',
  compatibilityFlags: ['nodejs_compat'],
  vars: { FROM_CONFIG: 'yes', PUBLIC_API: 'from-config' },
  assetsBinding: 'ASSETS',
  assetsCompletionToken: null,
  commitSha: 'abc1234',
};
