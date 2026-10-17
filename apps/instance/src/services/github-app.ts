import {
  createAppJwt,
  createInstallationToken,
  GithubClient,
  GithubError,
  getRepositoryInstallation,
} from '@bohr/github';
import type { Db } from '../db/client';
import { deps } from '../deps';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { readSealedSetting, writeSealedSetting } from './settings';

export type GithubAppCredentials = {
  appId: string | null;
  slug: string | null;
  clientId: string;
  clientSecret: string;
  privateKey: string | null;
  webhookSecret: string | null;
};

const SETTING = 'github_app';

/**
 * The instance's GitHub App: the one created by the setup flow (stored sealed), or the one
 * configured through secrets (bohr.io Cloud's existing App).
 */
export async function githubApp(db: Db, env: Env): Promise<GithubAppCredentials | null> {
  const stored = await readSealedSetting<GithubAppCredentials>(db, env, SETTING);
  if (stored !== null) return stored;
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
  return {
    appId: env.GITHUB_APP_ID ?? null,
    slug: env.GITHUB_APP_SLUG ?? null,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    privateKey: env.GITHUB_APP_PRIVATE_KEY ?? null,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? null,
  };
}

export async function requireGithubApp(db: Db, env: Env): Promise<GithubAppCredentials> {
  const app = await githubApp(db, env);
  if (app === null) throw new HttpError(503, 'The GitHub App is not set up yet. An admin must finish /setup.');
  return app;
}

export async function saveGithubApp(db: Db, env: Env, app: GithubAppCredentials): Promise<void> {
  await writeSealedSetting(db, env, SETTING, app);
}

/** A user access token for the App, from the code GitHub's authorization redirect carries. */
export async function exchangeOAuthCode(app: GithubAppCredentials, code: string, redirectUri: string): Promise<string> {
  const response = await deps.fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }),
  });
  const token = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!token.access_token) throw new HttpError(401, 'GitHub did not authorize the request.');
  return token.access_token;
}

export const TOKEN_PERMISSIONS = {
  // The sandbox's git traffic: push to the work branch. Without the workflows permission GitHub refuses any
  // push that changes .github/workflows, where code would run with the repository's secrets.
  sandbox: { contents: 'write' },
  // The project Worker only: pull requests, merges and reverts, the deploy workflow it writes, workflow runs
  worker: { contents: 'write', pull_requests: 'write', workflows: 'write', actions: 'read' },
  // Repository secrets for the production deploy workflow
  secrets: { secrets: 'write' },
} as const;

/** A token limited to one repository (by id when known), from the App installation that covers it. */
export async function repositoryToken(
  db: Db,
  env: Env,
  repository: { repoOwner: string; repoName: string; repoId: number | null },
  scope: keyof typeof TOKEN_PERMISSIONS,
): Promise<{ token: string; expiresAt: string }> {
  const { repoOwner: owner, repoName: repo, repoId } = repository;
  const app = await requireGithubApp(db, env);
  if (app.appId === null || app.privateKey === null) {
    throw new HttpError(503, 'The GitHub App has no private key configured.');
  }
  const installation = await getRepositoryInstallation({
    appId: app.appId,
    privateKeyPem: app.privateKey,
    owner,
    repo,
    fetch: deps.fetch,
  });
  if (installation === null) throw new HttpError(404, `The GitHub App is not installed on ${owner}/${repo}.`);
  const token = await createInstallationToken({
    appId: app.appId,
    privateKeyPem: app.privateKey,
    installationId: installation.id,
    // A repository recreated under the same name is a different id: GitHub refuses the token then
    ...(repoId !== null ? { repositoryIds: [repoId] } : { repositories: [repo] }),
    permissions: { ...TOKEN_PERMISSIONS[scope] },
    fetch: deps.fetch,
  });
  return { token: token.token, expiresAt: token.expiresAt };
}

/** Uninstalls the GitHub App from an account (with the App's JWT); an installation already gone is fine. */
export async function uninstallGithubApp(db: Db, env: Env, installationId: number): Promise<void> {
  const app = await githubApp(db, env);
  if (app?.appId == null || app.privateKey == null) throw new Error('The GitHub App has no private key configured.');
  const jwt = await createAppJwt(app.appId, app.privateKey);
  try {
    await new GithubClient({ token: jwt, fetch: deps.fetch }).request('DELETE', `/app/installations/${installationId}`);
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return;
    throw error;
  }
}
