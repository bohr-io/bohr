import { and, count, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { createDb } from '../db/client';
import { users } from '../db/schema';
import type { AppEnv } from '../env';
import { appUrl } from '../lib/app-url';
import { conflict } from '../lib/http';
import { SESSION_COOKIE } from '../lib/session';
import {
  CLOUDFLARE_TOKEN_HINT,
  connectionsView,
  deleteAccount,
  removeCloudflareConnection,
  removeGithubInstallation,
  removeIdentity,
} from '../services/accounts';
import { createPanelToken, revokeToken, tokensView } from '../services/api-tokens';
import { audit } from '../services/audit';
import { codeSchema, emailLocale, parseEmail, startEmailCode, verifyEmailCode } from '../services/email-codes';
import { linkIdentity } from '../services/users';
import { requireUser } from './api';

// The signed-in user's account: connected services, linking an email address, deleting the account
export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use('/me', requireUser);
accountRoutes.use('/me/*', requireUser);

accountRoutes.get('/me/connections', async (c) => {
  return c.json(await connectionsView(createDb(c.env.DB), c.env, c.get('user').id));
});

accountRoutes.delete('/me/identities/:provider', async (c) => {
  const db = createDb(c.env.DB);
  const provider = z.enum(['github', 'email', 'telegram']).parse(c.req.param('provider'));
  await removeIdentity(db, c.get('user').id, provider);
  return c.json(await connectionsView(db, c.env, c.get('user').id));
});

accountRoutes.delete('/me/github-installations/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = z.coerce.number().int().positive().parse(c.req.param('id'));
  await removeGithubInstallation(db, c.env, c.get('user').id, id);
  return c.json(await connectionsView(db, c.env, c.get('user').id));
});

accountRoutes.delete('/me/cloudflare/:id', async (c) => {
  const db = createDb(c.env.DB);
  await removeCloudflareConnection(db, c.get('user').id, c.req.param('id'));
  return c.json({ ...(await connectionsView(db, c.env, c.get('user').id)), hint: CLOUDFLARE_TOKEN_HINT });
});

// API tokens for scripts and AI agents (BOHR_TOKEN), and the CLI's own (`bohr login`): listed without the token
// itself, which is answered once, when it is created
accountRoutes.get('/me/tokens', async (c) => {
  return c.json(await tokensView(createDb(c.env.DB), c.get('user').id));
});

accountRoutes.post('/me/tokens', async (c) => {
  const db = createDb(c.env.DB);
  const { token, row } = await createPanelToken(db, c.get('user').id, await c.req.json());
  c.header('Cache-Control', 'no-store');
  return c.json({ token, id: row.id, ...(await tokensView(db, c.get('user').id)) }, 201);
});

accountRoutes.delete('/me/tokens/:id', async (c) => {
  const db = createDb(c.env.DB);
  await revokeToken(db, c.get('user').id, c.req.param('id'));
  return c.json(await tokensView(db, c.get('user').id));
});

// Linking an email address (a second way to sign in): a code sent to it proves it is theirs
accountRoutes.post('/me/email/start', async (c) => {
  const body = z.object({ email: z.unknown(), locale: z.string().max(20).optional() }).parse(await c.req.json());
  const email = parseEmail(body.email);
  await startEmailCode(createDb(c.env.DB), c.env, {
    email,
    purpose: 'link',
    userId: c.get('user').id,
    redirect: null,
    ip: c.req.header('CF-Connecting-IP') ?? null,
    locale: emailLocale(body.locale, c.req.header('Accept-Language')),
    baseUrl: await appUrl(c),
  });
  return c.json({ sent: true });
});

accountRoutes.post('/me/email/verify', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const body = z.object({ email: z.unknown(), code: codeSchema }).parse(await c.req.json());
  const email = parseEmail(body.email);
  await verifyEmailCode(db, c.env, { email, code: body.code, purpose: 'link', userId: user.id });
  const result = await linkIdentity(db, user.id, { provider: 'email', providerUserId: email, username: email });
  if (result.status === 'taken') throw conflict('This email address belongs to another bohr account.');
  if (user.email === null || result.status === 'linked') {
    await db.update(users).set({ email }).where(eq(users.id, user.id)).run();
  }
  await audit(db, {
    actor: `user:${user.id}`,
    actorUserId: user.id,
    action: 'identity.link',
    metadata: { provider: 'email' },
  });
  return c.json({ identity: { provider: 'email', username: email } });
});

// Deletes the account and everything it owns
accountRoutes.delete('/me', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const input = z
    .object({ confirm: z.literal(true), deleteSites: z.boolean().default(false) })
    .parse(await c.req.json().catch(() => ({})));
  if (user.role === 'admin') {
    const [admins, others] = await Promise.all([
      db
        .select({ total: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), ne(users.id, user.id)))
        .get(),
      db.select({ total: count() }).from(users).where(ne(users.id, user.id)).get(),
    ]);
    if ((admins?.total ?? 0) === 0 && (others?.total ?? 0) > 0) {
      throw conflict('You are the only admin. Make someone else an admin first.');
    }
  }
  const result = await deleteAccount(db, c.env, user.id, {
    deleteSites: input.deleteSites,
    actor: { actor: `user:${user.id}`, actorUserId: user.id },
  });
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json(result);
});
