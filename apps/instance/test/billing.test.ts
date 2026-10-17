import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { deps } from '../src/deps';
import { app } from '../src/index';
import { verifyStripeSignature } from '../src/lib/stripe';
import { createCheckout } from '../src/routes/billing';
import { adminHeaders, importProject, resetStorage, useFakes } from './helpers';

const billingEnv = {
  ...env,
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_ID: 'price_20usd',
};
const call = (path: string, init: RequestInit = {}) => app.request(path, init, billingEnv);
const db = createDb(env.DB);

async function signedHeader(payload: string, secret = 'whsec_test', timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

// Stripe API stand-in: one subscription per customer
const stripeCalls: string[] = [];
beforeEach(async () => {
  await resetStorage();
  useFakes();
  stripeCalls.length = 0;
  deps.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    stripeCalls.push(url);
    if (url.includes('/v1/subscriptions?')) {
      return Response.json({
        data: [
          {
            id: 'sub_legacy',
            customer: 'cus_alice',
            status: 'active',
            items: { data: [{ price: { id: 'price_old_r40' } }] },
          },
        ],
      });
    }
    if (url.endsWith('/v1/checkout/sessions')) return Response.json({ url: 'https://checkout.stripe.com/c/test' });
    return new Response('{}', { status: 404 });
  };
});

describe('checkout', () => {
  it('accepts promotion codes and asks for a card only when something is due', async () => {
    let body = '';
    const previous = deps.fetch;
    deps.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/checkout/sessions')) {
        body = String(init?.body ?? '');
        return Response.json({ url: 'https://checkout.stripe.com/c/test' });
      }
      return previous(input, init);
    };
    const url = await createCheckout(
      db,
      billingEnv,
      { id: 'u_promo', email: 'promo@example.com' },
      'https://app.bohr.io',
    );
    expect(url).toBe('https://checkout.stripe.com/c/test');
    const params = new URLSearchParams(body);
    expect(params.get('allow_promotion_codes')).toBe('true');
    expect(params.get('payment_method_collection')).toBe('if_required');
    expect(params.get('success_url')).toBe('https://app.bohr.io/start?billing=success');
  });
});

describe('Stripe signatures', () => {
  it('accepts a valid signature and rejects tampering, wrong secrets and old timestamps', async () => {
    const payload = '{"id":"evt_1"}';
    expect(await verifyStripeSignature(payload, await signedHeader(payload), 'whsec_test')).toBe(true);
    expect(await verifyStripeSignature(`${payload} `, await signedHeader(payload), 'whsec_test')).toBe(false);
    expect(await verifyStripeSignature(payload, await signedHeader(payload, 'other'), 'whsec_test')).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(await verifyStripeSignature(payload, await signedHeader(payload, 'whsec_test', old), 'whsec_test')).toBe(
      false,
    );
    expect(await verifyStripeSignature(payload, undefined, 'whsec_test')).toBe(false);
  });
});

describe('legacy subscriptions', () => {
  it('imports the payer as legacy, syncs from Stripe and follows webhooks', async () => {
    await importProject({ stripeCustomerId: 'cus_alice' });

    const sync = await call('/api/admin/billing/sync', { method: 'POST', headers: adminHeaders });
    expect(await sync.json()).toEqual({ subscriptions: [{ customer: 'cus_alice', status: 'active' }] });
    const row = await env.DB.prepare('SELECT status, legacy, price_id FROM subscriptions').first<{
      status: string;
      legacy: number;
      price_id: string;
    }>();
    expect(row).toEqual({ status: 'active', legacy: 1, price_id: 'price_old_r40' });

    const event = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_legacy', customer: 'cus_alice', status: 'canceled', items: { data: [] } } },
    });
    const unsigned = await call('/api/stripe/webhook', { method: 'POST', body: event });
    expect(unsigned.status).toBe(400);
    const signed = await call('/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': await signedHeader(event) },
      body: event,
    });
    expect(signed.status).toBe(200);
    const after = await env.DB.prepare('SELECT status, legacy FROM subscriptions').first<{
      status: string;
      legacy: number;
    }>();
    expect(after).toEqual({ status: 'canceled', legacy: 1 });
  });

  it('is off when Stripe is not configured', async () => {
    const response = await app.request('/api/stripe/webhook', { method: 'POST', body: '{}' }, env);
    expect(response.status).toBe(404);
  });
});
