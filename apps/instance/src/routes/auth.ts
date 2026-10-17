import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { createDb } from '../db/client';
import { identities, users } from '../db/schema';
import { deps } from '../deps';
import type { AppEnv } from '../env';
import { appUrl } from '../lib/app-url';
import { randomToken, safeEqual } from '../lib/crypto';
import { STATE_COOKIE, startGithubAuthorization, withError } from '../lib/github-authorize';
import { HttpError, unauthorized } from '../lib/http';
import { endSession, safeRedirect, sessionUser, startSession } from '../lib/session';
import { USER_AGENT } from '../lib/user-agent';
import { audit } from '../services/audit';
import {
  codeSchema,
  emailEnabled,
  emailLocale,
  parseEmail,
  startEmailCode,
  verifyEmailCode,
} from '../services/email-codes';
import { githubApp, requireGithubApp } from '../services/github-app';
import { activatePendingMemberships } from '../services/orgs';
import { linkIdentity, upsertEmailUser, upsertGithubUser } from '../services/users';
import { templateCallback } from './templates';

export const authRoutes = new Hono<AppEnv>();

// The ways to sign in this instance offers
authRoutes.get('/methods', async (c) => {
  const app = await githubApp(createDb(c.env.DB), c.env);
  return c.json({ github: app !== null, email: emailEnabled(c.env) });
});

// Sign in with GitHub (the GitHub App's user authorization). ?link=1 with a session attaches the GitHub
// account to the signed-in user instead.
authRoutes.get('/github', async (c) => {
  const db = createDb(c.env.DB);
  const app = await requireGithubApp(db, c.env);
  const link = c.req.query('link') === '1' && (await sessionUser(c, db)) !== null;
  const url = await startGithubAuthorization(c, app, {
    state: randomToken(16),
    redirect: safeRedirect(c.req.query('redirect')),
    mode: link ? 'link' : 'signin',
  });
  return c.redirect(url);
});

authRoutes.get('/github/callback', async (c) => {
  const cookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/', secure: true });
  const [state, redirectValue, mode] = cookie?.split('|') ?? [];
  const redirect = safeRedirect(redirectValue);
  const code = c.req.query('code');
  const returnedState = c.req.query('state');
  if (!state || returnedState === undefined || !(await safeEqual(state, returnedState))) {
    throw unauthorized('The sign-in expired; please try again.');
  }
  // Linking (from the account page) and a new project from a template go back to their page with ?error= when
  // GitHub did not let it through, as it does when the account is taken; signing in answers 401
  const fail = (message: string) => {
    if (mode === 'link' || mode === 'template') return c.redirect(withError(redirect, message));
    throw unauthorized(message);
  };
  // GitHub comes back without a code when the person cancels (?error=access_denied)
  if (code === undefined) return fail('GitHub did not authorize the sign-in.');

  const app = await requireGithubApp(createDb(c.env.DB), c.env);
  const tokenResponse = await deps.fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: `${await appUrl(c)}/auth/github/callback`,
    }),
  });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (token.access_token === undefined) return fail('GitHub did not authorize the sign-in.');
  // The user's token creates the repository during this request, and is not kept
  if (mode === 'template') return templateCallback(c, state, redirect, token.access_token);

  const profileResponse = await deps.fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!profileResponse.ok) return fail('Could not read the GitHub profile.');
  const profile = (await profileResponse.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
  };

  const db = createDb(c.env.DB);
  const current = mode === 'link' ? await sessionUser(c, db) : null;
  if (current !== null) {
    const result = await linkIdentity(db, current.id, {
      provider: 'github',
      providerUserId: String(profile.id),
      username: profile.login,
    });
    if (result.status === 'taken') {
      return c.redirect(withError(redirect, 'This GitHub account belongs to another bohr account.'));
    }
    // Organizations that were waiting for this GitHub account
    await activatePendingMemberships(db, profile.id, current.id);
    if (current.name === null) {
      await db
        .update(users)
        .set({ name: profile.name ?? profile.login })
        .where(eq(users.id, current.id))
        .run();
    }
    await audit(db, {
      actor: `user:${current.id}`,
      actorUserId: current.id,
      action: 'identity.link',
      metadata: { provider: 'github', username: profile.login },
    });
    return c.redirect(redirect);
  }

  const userId = await upsertGithubUser(
    db,
    { githubId: profile.id, login: profile.login, name: profile.name, email: profile.email },
    { signIn: true },
  );
  await activatePendingMemberships(db, profile.id, userId);
  await startSession(c, db, userId);
  await audit(db, { actor: `user:${userId}`, actorUserId: userId, action: 'login', metadata: { provider: 'github' } });
  return c.redirect(redirect);
});

// Sign in with a one-time code sent by email. The answer is the same for every valid address.
const requireJson = (contentType: string | undefined) => {
  if (!contentType?.startsWith('application/json')) throw new HttpError(415, 'Send application/json.');
};

authRoutes.post('/email/start', async (c) => {
  requireJson(c.req.header('Content-Type'));
  const body = z
    .object({ email: z.unknown(), redirect: z.string().max(2000).optional(), locale: z.string().max(20).optional() })
    .parse(await c.req.json());
  const email = parseEmail(body.email);
  await startEmailCode(createDb(c.env.DB), c.env, {
    email,
    purpose: 'signin',
    userId: null,
    redirect: safeRedirect(body.redirect),
    ip: c.req.header('CF-Connecting-IP') ?? null,
    locale: emailLocale(body.locale, c.req.header('Accept-Language')),
    baseUrl: await appUrl(c),
  });
  return c.json({ sent: true });
});

authRoutes.post('/email/verify', async (c) => {
  requireJson(c.req.header('Content-Type'));
  const body = z.object({ email: z.unknown(), code: codeSchema }).parse(await c.req.json());
  const email = parseEmail(body.email);
  const db = createDb(c.env.DB);
  const row = await verifyEmailCode(db, c.env, { email, code: body.code, purpose: 'signin', userId: null });
  const userId = await upsertEmailUser(db, email);
  await startSession(c, db, userId);
  await audit(db, { actor: `user:${userId}`, actorUserId: userId, action: 'login', metadata: { provider: 'email' } });
  return c.json({ redirect: safeRedirect(row.redirect ?? undefined) });
});

/**
 * A local instance on bohr.io Cloud's data (wrangler.prod-db.jsonc): GitHub cannot call back to localhost, so
 * LOCAL_SIGN_IN_AS (a GitHub login) is signed in by opening this address. Nowhere else: it needs that mode, the
 * variable and a request to localhost.
 */
authRoutes.get('/local', async (c) => {
  const host = new URL(c.req.url).hostname;
  const login = c.env.LOCAL_SIGN_IN_AS?.trim().toLowerCase();
  if (c.env.LOCAL_PRODUCTION_DB !== '1' || !login || (host !== 'localhost' && host !== '127.0.0.1')) {
    return c.notFound();
  }
  const db = createDb(c.env.DB);
  const identity = await db
    .select({ userId: identities.userId, username: identities.username })
    .from(identities)
    .where(eq(identities.provider, 'github'))
    .all()
    .then((rows) => rows.find((row) => row.username?.toLowerCase() === login));
  if (identity === undefined) return c.text(`No bohr account signs in with the GitHub account ${login}.`, 404);
  await startSession(c, db, identity.userId);
  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  await endSession(c, createDb(c.env.DB));
  return c.body(null, 204);
});
