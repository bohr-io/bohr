// Site protection (Basic Auth), as the panel manages it. Settings live in site_config (project-wide,
// branch "*"), with password hashes only. Projects bohr hosts are protected by the dispatcher (route
// records); projects in their owner's account by the gate the deploy workflow puts in front of the site,
// which reads the Worker secret BOHR_SITE_AUTH (@bohr/shared site-gate).
import { deleteAccountScriptSecret, putAccountScriptSecret } from '@bohr/cloudflare';
import { GithubClient } from '@bohr/github';
import { DEFAULT_DEPLOY_COMMAND, DEPLOY_CONFIG_PATH, SITE_AUTH_SECRET, SITE_PASSWORD_ITERATIONS } from '@bohr/shared';
import { and, eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { ALL_BRANCHES, type BasicAuthUser, type SiteAuth, siteConfig } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { badRequest } from '../lib/http';
import { repositoryToken } from './github-app';
import { writeProjectRoutes } from './routing';
import { productionWorker } from './variables';

export type ProtectionView = {
  type: 'none' | 'basic';
  users: { username: string }[];
  bypassPaths: string[];
  /** Why protection would not apply to this project's site, when that is the case. */
  warning: 'custom_deploy' | null;
};

export type ProtectionInput = {
  type: 'none' | 'basic';
  /** A user without a password keeps the one it had. */
  users: { username: string; password?: string }[];
  bypassPaths: string[];
};

const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** PBKDF2-SHA256 with a random 16-byte salt, the format the dispatcher and the gate verify. */
export async function hashSitePassword(password: string): Promise<Omit<BasicAuthUser, 'username'>> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: SITE_PASSWORD_ITERATIONS },
      key,
      256,
    ),
  );
  return { salt: base64(salt), hash: base64(hash), iterations: SITE_PASSWORD_ITERATIONS };
}

async function storedAuth(db: Db, projectId: string): Promise<SiteAuth | null> {
  const row = await db
    .select()
    .from(siteConfig)
    .where(and(eq(siteConfig.projectId, projectId), eq(siteConfig.branch, ALL_BRANCHES)))
    .get();
  return row?.auth ?? null;
}

/** The gate only wraps sites deployed with the plain `wrangler deploy` (deploy.json "deploy"). */
async function customDeploy(db: Db, env: Env, project: Project): Promise<boolean> {
  if (project.mode === 'managed') return false;
  try {
    const github = new GithubClient({
      token: (await repositoryToken(db, env, project, 'worker')).token,
      fetch: deps.fetch,
    });
    const file = await github.getFile(
      project.repoOwner,
      project.repoName,
      DEPLOY_CONFIG_PATH,
      project.productionBranch,
    );
    if (file === null) return false;
    const deploy = (JSON.parse(file.content) as { deploy?: unknown }).deploy;
    return typeof deploy === 'string' && deploy.trim() !== DEFAULT_DEPLOY_COMMAND;
  } catch {
    return false;
  }
}

export async function protectionView(db: Db, env: Env, project: Project): Promise<ProtectionView> {
  const auth = await storedAuth(db, project.id);
  const basic = auth?.type === 'basic' ? auth : null;
  return {
    type: basic === null ? 'none' : 'basic',
    users: (basic?.users ?? []).map((user) => ({ username: user.username })),
    bypassPaths: basic?.bypassPaths ?? [],
    warning: (await customDeploy(db, env, project)) ? 'custom_deploy' : null,
  };
}

export async function setProtection(db: Db, env: Env, project: Project, input: ProtectionInput): Promise<void> {
  let auth: SiteAuth = { type: 'none' };
  if (input.type === 'basic') {
    const previous = await storedAuth(db, project.id);
    const known = new Map(previous?.type === 'basic' ? previous.users.map((user) => [user.username, user]) : []);
    const names = new Set<string>();
    const users: BasicAuthUser[] = [];
    for (const user of input.users) {
      if (names.has(user.username)) throw badRequest(`${user.username} appears twice.`);
      names.add(user.username);
      if (user.password) users.push({ username: user.username, ...(await hashSitePassword(user.password)) });
      else {
        const kept = known.get(user.username);
        if (kept === undefined) throw badRequest(`Set a password for ${user.username}.`);
        users.push(kept);
      }
    }
    if (users.length === 0) throw badRequest('Add at least one user.');
    auth = { type: 'basic', users, ...(input.bypassPaths.length > 0 ? { bypassPaths: input.bypassPaths } : {}) };
  }

  // Applied first, so a failure leaves the stored settings as they were
  if (project.mode === 'managed') {
    await saveAuth(db, project.id, auth);
    await writeProjectRoutes(db, env, project);
    return;
  }
  const { cf, accountId, script } = await productionWorker(db, env, project);
  if (auth.type === 'basic') {
    await putAccountScriptSecret(
      cf,
      accountId,
      script,
      SITE_AUTH_SECRET,
      JSON.stringify({ users: auth.users, bypassPaths: auth.bypassPaths ?? [] }),
    );
  } else {
    await deleteAccountScriptSecret(cf, accountId, script, SITE_AUTH_SECRET);
  }
  await saveAuth(db, project.id, auth);
}

async function saveAuth(db: Db, projectId: string, auth: SiteAuth) {
  await db
    .insert(siteConfig)
    .values({ projectId, branch: ALL_BRANCHES, auth })
    .onConflictDoUpdate({ target: [siteConfig.projectId, siteConfig.branch], set: { auth, updatedAt: new Date() } })
    .run();
}
