import { appManifest, exchangeManifestCode, GithubClient, verifyWebhookSignature } from '@bohr/github';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createDb } from '../db/client';
import { githubInstallations } from '../db/schema';
import { deps } from '../deps';
import type { AppEnv } from '../env';
import { isAdminToken } from '../lib/admin';
import { appUrl, recordAppUrl } from '../lib/app-url';
import { randomToken, safeEqual, sha256Hex } from '../lib/crypto';
import { badRequest, forbidden, unauthorized } from '../lib/http';
import { sessionUser } from '../lib/session';
import { audit } from '../services/audit';
import { exchangeOAuthCode, githubApp, requireGithubApp, saveGithubApp } from '../services/github-app';
import { fetchInstallation, linkInstallation, userForInstallState } from '../services/onboarding';
import {
  ensureOrgForInstallation,
  handleInstallationEvent,
  handleOrganizationEvent,
  type InstallationEvent,
  type OrganizationEvent,
} from '../services/orgs';
import { notifyInstallation, platformBotInfo } from '../services/platform-bot';
import { readSetting, writeSetting } from '../services/settings';

// First run: the admin creates the instance's GitHub App from a manifest, in one click.
export const setupRoutes = new Hono<AppEnv>();

const STATE_COOKIE = '__Host-bohr_setup';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function page(c: Context<AppEnv>, title: string, body: string, status: 200 | 401 = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · bohr</title>
<style>
body{margin:0;min-height:100vh;background:#0e171d;color:#fff;font:16px/1.5 Helvetica,Arial,sans-serif;display:grid;place-items:center}
main{width:min(32rem,calc(100% - 2rem));padding:2rem 0}
h1{font-size:2rem;margin:0 0 1rem;background:linear-gradient(90deg,#f4cc3a,#f26419,#e84855);-webkit-background-clip:text;background-clip:text;color:transparent}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:.75rem;border-radius:.5rem;border:1px solid #38434a;background:#151f26;color:#fff;font:inherit}
.check{display:flex;gap:.5rem;align-items:center;font-weight:400}button,.button{display:inline-block;margin-top:1.5rem;padding:.75rem 1.5rem;border:0;border-radius:2rem;background:linear-gradient(90deg,#f26419,#e84855);color:#0e171d;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
p.hint{color:#9fb0bb;font-size:.875rem}code{background:#151f26;padding:.1rem .3rem;border-radius:.25rem}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action https://github.com 'self'",
  );
  return c.html(html, status);
}

setupRoutes.get('/setup', async (c) => {
  const app = await githubApp(createDb(c.env.DB), c.env);
  if (app !== null) {
    const install = app.slug ? `https://github.com/apps/${app.slug}/installations/new` : null;
    return page(
      c,
      'bohr is set up',
      `<p>GitHub App: <strong>${escapeHtml(app.slug ?? app.clientId)}</strong>.</p>
${install ? `<a class="button" href="${escapeHtml(install)}">Install it on your repositories</a>` : ''}
<p class="hint">To use another App, delete the <code>github_app</code> setting and open this page again.</p>`,
    );
  }
  const host = new URL(await appUrl(c)).hostname;
  return page(
    c,
    'Set up your bohr',
    `<p>Create the GitHub App this instance uses to read repositories, open pull requests and publish. GitHub shows you what it asks for before you confirm.</p>
<form method="post" action="/setup/github">
<label for="token">Admin token</label><input id="token" name="token" type="password" required autocomplete="off">
<p class="hint">The <code>ADMIN_TOKEN</code> secret you set when you deployed the instance.</p>
<label for="name">App name</label><input id="name" name="name" type="text" maxlength="34" value="${escapeHtml(`bohr ${host}`.slice(0, 34))}" required>
<label for="org">GitHub organization (optional)</label><input id="org" name="org" type="text" pattern="[A-Za-z0-9-]{1,39}" placeholder="Leave empty to create it on your account">
<label class="check"><input name="public" type="checkbox" checked> Other people can install it (needed when other users bring their own repositories)</label>
<button type="submit">Create the GitHub App</button></form>`,
  );
});

setupRoutes.post('/setup/github', async (c) => {
  const form = await c.req.parseBody();
  const token = typeof form.token === 'string' ? form.token : '';
  if (!(await isAdminToken(c.env, token))) {
    return page(c, 'Set up your bohr', '<p>Wrong admin token. <a href="/setup">Try again</a>.</p>', 401);
  }
  const name = typeof form.name === 'string' && form.name.trim() ? form.name.trim().slice(0, 34) : 'bohr';
  const org = typeof form.org === 'string' ? form.org.trim() : '';
  if (org && !/^[A-Za-z0-9-]{1,39}$/.test(org)) throw badRequest('Invalid organization name.');

  const base = await recordAppUrl(c);
  const state = randomToken(24);
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 900 });
  const manifest = appManifest({
    name,
    url: base,
    webhookUrl: `${base}/api/github/webhook`,
    // GitHub cannot reach (and refuses) webhooks on a local instance; installations are linked without them
    webhookActive: !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base),
    callbackUrls: [`${base}/auth/github/callback`, `${base}/setup/github/verify`],
    setupUrl: `${base}/setup/github/installed`,
    redirectUrl: `${base}/setup/github/callback`,
    description: `bohr instance at ${base}`,
    public: form.public === 'on',
  });
  const action = org
    ? `https://github.com/organizations/${org}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;
  return page(
    c,
    'Opening GitHub…',
    `<form id="manifest" method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<noscript><button type="submit">Continue on GitHub</button></noscript></form><script>document.getElementById('manifest').submit()</script>`,
  );
});

setupRoutes.get('/setup/github/callback', async (c) => {
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/', secure: true });
  const state = c.req.query('state');
  const code = c.req.query('code');
  if (!expected || !state || !code || !(await safeEqual(expected, state))) {
    throw unauthorized('The setup expired; open /setup again.');
  }
  const db = createDb(c.env.DB);
  const created = await exchangeManifestCode(code, { fetch: deps.fetch });
  await saveGithubApp(db, c.env, {
    appId: String(created.id),
    slug: created.slug,
    clientId: created.client_id,
    clientSecret: created.client_secret,
    privateKey: created.pem,
    webhookSecret: created.webhook_secret,
  });
  await audit(db, { actor: 'admin', action: 'setup.github_app', target: created.slug, metadata: { id: created.id } });
  return c.redirect(`https://github.com/apps/${created.slug}/installations/new`);
});

// GitHub sends people here after they install (or change) the App. The state names the bohr user who
// started the installation (web or platform bot), but installation_id can be forged: before linking, the
// person authorizes the App on GitHub and the installation must be among the ones they can access.
// An "org" state (from /api/orgs/install-url) is an installation meant for a GitHub organization.
type InstallVerification = {
  userId: string;
  installationId: number;
  fromTelegram: boolean;
  org?: boolean;
  expiresAt: number;
};
const verificationKey = async (code: string) => `install_verify:${await sha256Hex(code)}`;

setupRoutes.get('/setup/github/installed', async (c) => {
  const db = createDb(c.env.DB);
  const installationId = Number(c.req.query('installation_id'));
  const state = c.req.query('state');
  const started = state ? await userForInstallState(db, state) : null;
  const userId = started?.userId ?? (await sessionUser(c, db))?.id ?? null;
  if (userId === null || !Number.isInteger(installationId) || installationId <= 0) return c.redirect('/');
  const app = await requireGithubApp(db, c.env);
  const code = randomToken(24);
  await writeSetting(db, await verificationKey(code), {
    userId,
    installationId,
    fromTelegram: started?.source === 'telegram',
    ...(started?.org ? { org: true } : {}),
    expiresAt: Date.now() + 15 * 60_000,
  } satisfies InstallVerification);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', app.clientId);
  authorize.searchParams.set('redirect_uri', `${await appUrl(c)}/setup/github/verify`);
  authorize.searchParams.set('state', code);
  return c.redirect(authorize.toString());
});

setupRoutes.get('/setup/github/verify', async (c) => {
  const db = createDb(c.env.DB);
  const state = c.req.query('state') ?? '';
  const key = await verificationKey(state);
  const verification = await readSetting<InstallVerification>(db, key);
  const code = c.req.query('code');
  if (verification === null || verification.expiresAt < Date.now() || code === undefined) {
    throw unauthorized('This confirmation expired. Install the GitHub App again from bohr.');
  }
  await writeSetting(db, key, { ...verification, expiresAt: 0 });
  const app = await requireGithubApp(db, c.env);
  const token = await exchangeOAuthCode(app, code, `${await appUrl(c)}/setup/github/verify`);
  const github = new GithubClient({ token, fetch: deps.fetch });
  const installations = await github.listUserInstallations();
  if (!installations.some((installation) => installation.id === verification.installationId)) {
    throw forbidden('Your GitHub account cannot access that installation of the App.');
  }
  const installation = await fetchInstallation(db, c.env, verification.installationId);
  const onOrganization = installation?.account.type === 'Organization';
  // On a GitHub organization: bohr creates (or links) the org, with whoever installed it as an admin
  const ensureOrg = async () => {
    if (installation === null || !onOrganization) return null;
    const person = await github.getAuthenticatedUser();
    return ensureOrgForInstallation(db, c.env, installation, {
      githubUserId: person.id,
      login: person.login,
      userId: verification.userId,
    });
  };
  if (verification.org && onOrganization) {
    const org = await ensureOrg();
    await audit(db, {
      actor: `user:${verification.userId}`,
      actorUserId: verification.userId,
      action: 'github.installation',
      target: String(verification.installationId),
      metadata: { org: org?.id ?? null },
    });
    return c.redirect(org === null ? '/orgs/new' : `/orgs/${org.slug}`);
  }
  await linkInstallation(db, c.env, verification.installationId, verification.userId, installation);
  await audit(db, {
    actor: `user:${verification.userId}`,
    actorUserId: verification.userId,
    action: 'github.installation',
    target: String(verification.installationId),
  });
  if (onOrganization) {
    await ensureOrg().catch((error) => console.error('[setup] organization:', error));
  }
  if (verification.org) {
    // Meant for an organization, installed on a personal account: it works as a personal installation
    return c.redirect(
      `/orgs/new?error=${encodeURIComponent('The GitHub App was installed on a personal account, not on an organization.')}`,
    );
  }
  await notifyInstallation(db, c.env, verification.userId).catch((error) =>
    console.error('[setup] notify failed:', error),
  );
  const bot = await platformBotInfo(db);
  return c.redirect(bot !== null && verification.fromTelegram ? `https://t.me/${bot.username}` : '/start');
});

setupRoutes.post('/api/github/webhook', async (c) => {
  const db = createDb(c.env.DB);
  const app = await githubApp(db, c.env);
  const body = await c.req.text();
  if (
    !app?.webhookSecret ||
    !(await verifyWebhookSignature(body, c.req.header('X-Hub-Signature-256') ?? null, app.webhookSecret))
  ) {
    throw unauthorized('Invalid signature.');
  }
  const event = c.req.header('X-GitHub-Event');
  if (event === 'organization') {
    // Members added to or removed from a GitHub organization that is a bohr org
    await handleOrganizationEvent(db, JSON.parse(body) as OrganizationEvent);
    return c.body(null, 204);
  }
  const payload = JSON.parse(body) as InstallationEvent;
  const installation = payload.installation;
  if (event === 'installation' && installation !== undefined) {
    if (payload.action === 'deleted') {
      // An org keeps existing without its installation
      await handleInstallationEvent(db, c.env, payload);
      await db.delete(githubInstallations).where(eq(githubInstallations.id, installation.id)).run();
    } else if (payload.action === 'created' || payload.action === 'new_permissions_accepted') {
      const row = {
        id: installation.id,
        accountLogin: installation.account?.login ?? '',
        accountType: installation.account?.type ?? null,
      };
      await db
        .insert(githubInstallations)
        .values(row)
        .onConflictDoUpdate({
          target: githubInstallations.id,
          set: { accountLogin: row.accountLogin, accountType: row.accountType },
        })
        .run();
      // On a GitHub organization: link (or create, when a bohr user installed it) the org and import members
      await handleInstallationEvent(db, c.env, payload).catch((error) =>
        console.error('[webhook] organization installation:', error),
      );
    }
  }
  return c.body(null, 204);
});
