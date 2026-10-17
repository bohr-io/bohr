// What an organization has set up (GET /api/orgs/:slug), as the panel needs it.
import type { OrgDetail } from '../api';

/** The subscription counts only where the instance charges (bohr.io Cloud). */
export function orgSubscribed(detail: Pick<OrgDetail, 'org' | 'billing'>): boolean {
  return !detail.billing.enabled || detail.org.status.subscription || detail.billing.subscribed;
}

/** New projects need the subscription, the Cloudflare account and the GitHub App on the GitHub organization. */
export function orgReady(detail: Pick<OrgDetail, 'org' | 'billing'>): boolean {
  return orgSubscribed(detail) && detail.org.status.cloudflare && detail.org.status.installation;
}
