import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createDb, type Db } from '../db/client';
import { orgs, subscriptions } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { appUrl } from '../lib/app-url';
import { randomId } from '../lib/crypto';
import { badRequest, HttpError, notFound, unauthorized } from '../lib/http';
import { type Owner, subscriptionsOf, userOwner } from '../lib/owner';
import { sessionUser } from '../lib/session';
import { stripeRequest, verifyStripeSignature } from '../lib/stripe';
import { audit } from '../services/audit';

// bohr.io Cloud billing: US$20/month to use the instance (projects run in the customer's own Cloudflare account);
// v1 customers keep their subscriptions and price (legacy). Organizations have their own subscription.

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  items?: { data: { price?: { id: string }; current_period_end?: number }[] };
};

export const billingEnabled = (env: Env) =>
  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID);

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

const asOwner = (owner: string | Owner): Owner => (typeof owner === 'string' ? userOwner(owner) : owner);

/**
 * A current subscription, new (US$20) or legacy (v1 price), lets the user run projects on bohr.io Cloud. An
 * organization has its own (orgId set), which is not the paying admin's.
 */
export async function hasActiveSubscription(db: Db, owner: string | Owner): Promise<boolean> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(subscriptionsOf(asOwner(owner)))
    .all();
  return rows.some((row) => ACTIVE_STATUSES.includes(row.status));
}

/** The owner's subscription row (the current one when there are several). */
export async function ownerSubscription(db: Db, owner: Owner) {
  const rows = await db.select().from(subscriptions).where(subscriptionsOf(owner)).all();
  return rows.find((row) => ACTIVE_STATUSES.includes(row.status)) ?? rows[0];
}

/**
 * A Stripe Checkout page for the managed hosting price: the user's own, or with `orgId` an organization's (paid
 * by this admin, with its own Stripe customer so it never mixes with the admin's personal subscription).
 */
export async function createCheckout(
  db: Db,
  env: Env,
  user: { id: string; email: string | null },
  baseUrl: string,
  returnPath = '/start',
  orgId?: string,
): Promise<string> {
  const existing = await ownerSubscription(db, orgId === undefined ? userOwner(user.id) : { kind: 'org', id: orgId });
  if (existing !== undefined && ACTIVE_STATUSES.includes(existing.status)) {
    throw badRequest(
      orgId === undefined
        ? 'You already have an active subscription; manage it in the billing portal.'
        : 'This organization already has an active subscription; manage it in the billing portal.',
    );
  }
  const session = await stripeRequest<{ url: string }>(env.STRIPE_SECRET_KEY ?? '', 'POST', 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID ?? '',
    'line_items[0][quantity]': '1',
    client_reference_id: user.id,
    // The webhook stores an organization's subscription with its id
    ...(orgId === undefined ? {} : { 'metadata[orgId]': orgId, 'subscription_data[metadata][orgId]': orgId }),
    // Promotion codes (e.g. 100% off for the team and partners); no card is asked when nothing is due
    allow_promotion_codes: 'true',
    payment_method_collection: 'if_required',
    ...(existing ? { customer: existing.stripeCustomerId } : user.email ? { customer_email: user.email } : {}),
    success_url: `${baseUrl}${returnPath}?billing=success`,
    cancel_url: `${baseUrl}${returnPath}`,
  });
  return session.url;
}

/** A Stripe billing portal session for the owner's subscription. */
export async function billingPortal(db: Db, env: Env, owner: Owner, returnUrl: string): Promise<string> {
  const existing = await ownerSubscription(db, owner);
  if (existing === undefined) throw notFound('No subscription yet.');
  const session = await stripeRequest<{ url: string }>(env.STRIPE_SECRET_KEY ?? '', 'POST', 'billing_portal/sessions', {
    customer: existing.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

export const requireBilling = createMiddleware<AppEnv>(async (c, next) => {
  if (!billingEnabled(c.env)) throw notFound('Billing is not enabled on this instance.');
  await next();
});

export async function upsertSubscription(
  db: Db,
  userId: string,
  subscription: StripeSubscription,
  legacy?: boolean,
  orgId?: string,
) {
  const periodEnd = subscription.current_period_end ?? subscription.items?.data[0]?.current_period_end;
  const values = {
    stripeSubscriptionId: subscription.id,
    priceId: subscription.items?.data[0]?.price?.id ?? null,
    status: subscription.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({
      id: randomId('sub_', 16),
      userId,
      stripeCustomerId: subscription.customer,
      legacy: legacy ?? false,
      orgId: orgId ?? null,
      ...values,
    })
    .onConflictDoUpdate({ target: subscriptions.stripeCustomerId, set: values })
    .run();
}

// Latest subscription of a Stripe customer, e.g. a v1 payer imported with only the customer id
export async function syncCustomer(db: Db, env: Env, userId: string, customerId: string, legacy: boolean) {
  const list = await stripeRequest<{ data: StripeSubscription[] }>(
    env.STRIPE_SECRET_KEY ?? '',
    'GET',
    'subscriptions',
    {
      customer: customerId,
      status: 'all',
      limit: '1',
    },
  );
  const latest = list.data[0];
  if (latest !== undefined) await upsertSubscription(db, userId, latest, legacy);
  return latest?.status ?? null;
}

/**
 * Whether the user (or the organization) may create projects: always on instances without billing
 * (self-hosted); on bohr.io Cloud with a current subscription. v1 payers arrive with only their Stripe customer
 * ("imported") until Stripe is asked, so those are synced before answering.
 */
export async function ensureSubscription(db: Db, env: Env, owner: string | Owner): Promise<boolean> {
  const target = asOwner(owner);
  if (!billingEnabled(env) || (await hasActiveSubscription(db, target))) return true;
  // Only people bring subscriptions from v1
  if (target.kind === 'org') return false;
  const userId = target.id;
  const imported = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.orgId), eq(subscriptions.status, 'imported')))
    .all();
  for (const row of imported) {
    await syncCustomer(db, env, userId, row.stripeCustomerId, row.legacy).catch((error) =>
      console.error('[billing] sync failed:', error),
    );
  }
  return imported.length > 0 && hasActiveSubscription(db, userId);
}

/** 402 unless ensureSubscription allows the user (or the organization) to create projects. */
export async function requireSubscription(db: Db, env: Env, owner: string | Owner): Promise<void> {
  if (!(await ensureSubscription(db, env, owner))) {
    throw new HttpError(
      402,
      asOwner(owner).kind === 'org'
        ? 'bohr.io Cloud needs an active subscription for this organization.'
        : 'bohr.io Cloud needs an active subscription.',
    );
  }
}

export const billingRoutes = new Hono<AppEnv>();
billingRoutes.use('/stripe/*', requireBilling);
billingRoutes.use('/billing', requireBilling);
billingRoutes.use('/billing/*', requireBilling);

// Stripe → instance. Customers are matched by Stripe customer id (imported for v1 payers) or checkout reference
billingRoutes.post('/stripe/webhook', async (c) => {
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(payload, c.req.header('Stripe-Signature'), c.env.STRIPE_WEBHOOK_SECRET ?? ''))) {
    throw new HttpError(400, 'Invalid signature.');
  }
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  const db = createDb(c.env.DB);
  const object = event.data.object;

  if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
    const userId = String(object.client_reference_id ?? '');
    // An organization's checkout carries its id (createCheckout)
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    const orgId = typeof metadata.orgId === 'string' && metadata.orgId !== '' ? metadata.orgId : undefined;
    const subscription = await stripeRequest<StripeSubscription>(
      c.env.STRIPE_SECRET_KEY ?? '',
      'GET',
      `subscriptions/${encodeURIComponent(String(object.subscription))}`,
    );
    const org = orgId === undefined ? undefined : await db.select().from(orgs).where(eq(orgs.id, orgId)).get();
    if (orgId !== undefined && org === undefined) {
      console.error('[billing] checkout for an unknown organization', orgId);
    } else if (userId !== '') {
      await upsertSubscription(db, userId, subscription, undefined, org?.id);
      await audit(db, {
        actor: 'stripe',
        actorUserId: userId,
        action: 'billing.subscribed',
        target: org === undefined ? userId : `org:${org.id}`,
      });
    }
  } else if (event.type.startsWith('customer.subscription.')) {
    const payload = object as unknown as StripeSubscription;
    const subscription = await stripeRequest<StripeSubscription>(
      c.env.STRIPE_SECRET_KEY ?? '',
      'GET',
      `subscriptions/${encodeURIComponent(payload.id)}`,
    ).catch(() => payload);
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, subscription.customer))
      .get();
    if (existing !== undefined) {
      await upsertSubscription(
        db,
        existing.userId,
        event.type === 'customer.subscription.deleted' ? { ...subscription, status: 'canceled' } : subscription,
      );
      await audit(db, {
        actor: 'stripe',
        action: `billing.${event.type.slice('customer.subscription.'.length)}`,
        target: existing.orgId === null ? existing.userId : `org:${existing.orgId}`,
        metadata: { status: subscription.status },
      });
    }
  }
  return c.json({ received: true });
});

const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c, createDb(c.env.DB));
  if (user === null) throw unauthorized();
  c.set('user', user);
  await next();
});

billingRoutes.get('/billing', requireUser, async (c) => {
  const row = await ownerSubscription(createDb(c.env.DB), userOwner(c.get('user').id));
  return c.json({
    subscription: row
      ? { status: row.status, legacy: row.legacy, currentPeriodEnd: row.currentPeriodEnd, priceId: row.priceId }
      : null,
  });
});

billingRoutes.post('/billing/checkout', requireUser, async (c) => {
  const url = await createCheckout(createDb(c.env.DB), c.env, c.get('user'), await appUrl(c), '/billing');
  return c.json({ url });
});

billingRoutes.post('/billing/portal', requireUser, async (c) => {
  const url = await billingPortal(createDb(c.env.DB), c.env, userOwner(c.get('user').id), `${await appUrl(c)}/billing`);
  return c.json({ url });
});
