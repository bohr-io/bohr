// Custom domains of a project's site. In the owner's account they are Custom Domains of the production
// Worker (Cloudflare creates the DNS record and the certificate); the domain's zone must be in that account.
// Projects bohr hosts keep the hostnames the v1 import brought, served by the dispatcher, until they move.
import {
  attachWorkerDomain,
  detachWorkerDomain,
  findZoneForHostname,
  getWorkersSubdomain,
  listWorkerDomains,
  listZones,
  workersDevUrl,
} from '@bohr/cloudflare';
import { eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { hostnames } from '../db/schema';
import type { Env } from '../env';
import { badRequest, conflict, notFound } from '../lib/http';
import { productionWorker } from './variables';

export type DomainsView =
  | {
      hosting: 'bohr';
      domains: { id: string; hostname: string; status: 'pending' | 'live' }[];
    }
  | {
      hosting: 'own';
      /** False until the site's first deploy created its Worker. */
      deployed: boolean;
      worker: string | null;
      workersDev: string | null;
      domains: { id: string; hostname: string }[];
      /** The zones of the owner's account a domain can be added under. */
      zones: { name: string; status: string }[];
      error?: string;
    };

export async function domainsView(db: Db, env: Env, project: Project): Promise<DomainsView> {
  if (project.mode === 'managed') {
    const rows = await db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all();
    return {
      hosting: 'bohr',
      domains: rows
        .filter((row) => row.isProduction)
        .map((row) => ({ id: row.hostname, hostname: row.hostname, status: row.status })),
    };
  }
  let worker: Awaited<ReturnType<typeof productionWorker>>;
  try {
    worker = await productionWorker(db, env, project);
  } catch (error) {
    // Not deployed yet (or no wrangler config): nothing to attach domains to
    return {
      hosting: 'own',
      deployed: false,
      worker: null,
      workersDev: null,
      domains: [],
      zones: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const [domains, zones, subdomain] = await Promise.all([
    listWorkerDomains(worker.cf, worker.accountId, worker.script),
    listZones(worker.cf),
    getWorkersSubdomain(worker.cf, worker.accountId),
  ]);
  return {
    hosting: 'own',
    deployed: true,
    worker: worker.script,
    workersDev: subdomain === null ? null : workersDevUrl(worker.script, subdomain),
    domains: domains.map((domain) => ({ id: domain.id, hostname: domain.hostname })),
    zones: zones.map((zone) => ({ name: zone.name, status: zone.status })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function addDomain(db: Db, env: Env, project: Project, rawHostname: string): Promise<void> {
  if (project.mode === 'managed') throw conflict('Move the project to your Cloudflare account to change its domains.');
  const hostname = rawHostname.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(hostname)) throw badRequest(`${rawHostname} is not a domain name (wildcards are not supported).`);
  const { cf, accountId, script } = await productionWorker(db, env, project);
  const zone = await findZoneForHostname(cf, hostname);
  if (zone === null) {
    throw conflict(`No zone in your Cloudflare account covers ${hostname}. Add the domain to Cloudflare first.`);
  }
  await attachWorkerDomain(cf, accountId, { hostname, service: script, zoneId: zone.id });
}

export async function removeDomain(db: Db, env: Env, project: Project, domainId: string): Promise<void> {
  if (project.mode === 'managed') throw conflict('Move the project to your Cloudflare account to change its domains.');
  const { cf, accountId, script } = await productionWorker(db, env, project);
  const attached = await listWorkerDomains(cf, accountId, script);
  if (!attached.some((domain) => domain.id === domainId)) throw notFound('That domain is not attached to this site.');
  await detachWorkerDomain(cf, accountId, domainId);
}
