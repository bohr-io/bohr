import { and, count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { identities, users } from '../db/schema';
import { randomId } from '../lib/crypto';
import { audit } from './audit';

export type GithubProfile = { githubId: number | string; login: string; name?: string | null; email?: string | null };

/** The providers that sign in; telegram is only a connected service. */
export const SIGN_IN_PROVIDERS = ['github', 'email'] as const;

/**
 * The role of a user created by signing in: the first person who can sign in becomes the instance's admin.
 * Users the platform bot created for Telegram accounts cannot sign in, so they do not count.
 */
async function roleForNewSignIn(db: Db): Promise<'user' | 'admin'> {
  const row = await db
    .select({ total: count() })
    .from(identities)
    .where(inArray(identities.provider, [...SIGN_IN_PROVIDERS]))
    .get();
  return (row?.total ?? 0) === 0 ? 'admin' : 'user';
}

// Finds the user behind a GitHub account, creating it on first sight; keeps the login current.
// signIn: created by a sign-in (the first one becomes admin), not by the operator's import.
export async function upsertGithubUser(db: Db, profile: GithubProfile, options: { signIn?: boolean } = {}) {
  const providerUserId = String(profile.githubId);
  const existing = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'github'), eq(identities.providerUserId, providerUserId)))
    .get();

  if (existing !== undefined) {
    const user = await db.select().from(users).where(eq(users.id, existing.userId)).get();
    await db.batch([
      db.update(identities).set({ username: profile.login }).where(eq(identities.id, existing.id)),
      db
        .update(users)
        .set({ name: user?.name ?? profile.name ?? profile.login, email: user?.email ?? profile.email ?? null })
        .where(eq(users.id, existing.userId)),
    ]);
    return existing.userId;
  }

  const userId = randomId('u_', 16);
  const role = options.signIn ? await roleForNewSignIn(db) : 'user';
  await db.batch([
    db.insert(users).values({ id: userId, name: profile.name ?? profile.login, email: profile.email ?? null, role }),
    db
      .insert(identities)
      .values({ id: randomId('i_', 16), userId, provider: 'github', providerUserId, username: profile.login }),
  ]);
  if (options.signIn) {
    await audit(db, {
      actor: `user:${userId}`,
      actorUserId: userId,
      action: 'signup',
      metadata: { provider: 'github', role },
    });
  }
  return userId;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The user behind an email address; signing in with an unknown address creates a new user (never merged). */
export async function upsertEmailUser(db: Db, email: string): Promise<string> {
  const address = normalizeEmail(email);
  const existing = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'email'), eq(identities.providerUserId, address)))
    .get();
  if (existing !== undefined) return existing.userId;

  const userId = randomId('u_', 16);
  const role = await roleForNewSignIn(db);
  await db.batch([
    db.insert(users).values({ id: userId, name: null, email: address, role }),
    db
      .insert(identities)
      .values({ id: randomId('i_', 16), userId, provider: 'email', providerUserId: address, username: address }),
  ]);
  await audit(db, {
    actor: `user:${userId}`,
    actorUserId: userId,
    action: 'signup',
    metadata: { provider: 'email', role },
  });
  return userId;
}

export type LinkResult = { status: 'linked' } | { status: 'taken' } | { status: 'already' };

/** Attaches an identity to a user. Fails when it belongs to someone else; one identity per provider per user. */
export async function linkIdentity(
  db: Db,
  userId: string,
  identity: { provider: 'github' | 'email'; providerUserId: string; username: string },
): Promise<LinkResult> {
  const existing = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, identity.provider), eq(identities.providerUserId, identity.providerUserId)))
    .get();
  if (existing !== undefined && existing.userId !== userId) return { status: 'taken' };
  if (existing !== undefined) {
    await db.update(identities).set({ username: identity.username }).where(eq(identities.id, existing.id)).run();
    return { status: 'already' };
  }
  // A new address (or GitHub account) replaces the one the user had
  await db.batch([
    db.delete(identities).where(and(eq(identities.userId, userId), eq(identities.provider, identity.provider))),
    db.insert(identities).values({ id: randomId('i_', 16), userId, ...identity }),
  ]);
  return { status: 'linked' };
}

export const publicUser = (user: { id: string; name: string | null; email: string | null; role: string }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});
