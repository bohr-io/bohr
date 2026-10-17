import { deps } from '../deps';

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Verifies a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=…]") over the raw body, within a 5 minute tolerance
export async function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  now = Date.now(),
) {
  if (header === undefined || secret === '') return false;
  const parts = header.split(',').map((part) => part.split('=') as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > 300) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const expected = encoder.encode(
    toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))),
  );
  return signatures.some((signature) => {
    const received = encoder.encode(signature);
    return received.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(received, expected);
  });
}

// Stripe's REST API takes form-encoded bodies with bracket notation (line_items[0][price])
export async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com/v1/${path}${method !== 'POST' && body ? `?${body}` : ''}`;
  const response = await deps.fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? body : undefined,
  });
  const result = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Stripe ${method} ${path}: ${result.error?.message ?? response.status}`);
  return result;
}

const CANCELLABLE = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'imported'];

/** Cancels these subscriptions in Stripe right away (bohr.io Cloud); failures become warnings. */
export async function cancelStripeSubscriptions(
  env: { STRIPE_SECRET_KEY?: string },
  rows: { stripeCustomerId: string; stripeSubscriptionId: string | null; status: string }[],
  warnings: string[],
): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  const key = env.STRIPE_SECRET_KEY;
  for (const row of rows.filter((candidate) => CANCELLABLE.includes(candidate.status))) {
    try {
      // v1 payers imported with only their customer: ask Stripe for the subscription
      const ids =
        row.stripeSubscriptionId !== null
          ? [row.stripeSubscriptionId]
          : (
              await stripeRequest<{ data: { id: string; status: string }[] }>(key, 'GET', 'subscriptions', {
                customer: row.stripeCustomerId,
                status: 'all',
              })
            ).data
              .filter((subscription) => CANCELLABLE.includes(subscription.status))
              .map((subscription) => subscription.id);
      for (const id of ids) await stripeRequest(key, 'DELETE', `subscriptions/${encodeURIComponent(id)}`);
    } catch (error) {
      console.error('[billing] cancel subscription', row.stripeCustomerId, error);
      warnings.push(`Stripe subscription (${row.stripeCustomerId}): ${error instanceof Error ? error.message : error}`);
    }
  }
}
