// bohr.io Cloud's subscription, as the instance reports it (GET /api/billing).
import type { DeployStatus } from '@bohr/ui';

/** Price of bohr.io Cloud, per month. v1 customers keep their old price. */
export const CLOUD_PRICE_USD = 20;

/** Statuses that count as a current subscription (the instance's ACTIVE_STATUSES). */
const ACTIVE = ['active', 'trialing', 'past_due'];

const KNOWN = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'imported',
] as const;

export type KnownStatus = (typeof KNOWN)[number];

export function isActiveSubscription(status: string | undefined): boolean {
  return status !== undefined && ACTIVE.includes(status);
}

export function isKnownStatus(status: string): status is KnownStatus {
  return (KNOWN as readonly string[]).includes(status);
}

export function subscriptionIndicator(status: string): DeployStatus {
  if (status === 'active' || status === 'trialing') return 'success';
  if (status === 'past_due' || status === 'imported' || status === 'incomplete') return 'warning';
  return 'error';
}
