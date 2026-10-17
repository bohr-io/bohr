import {
  type CloudflareClient,
  createWorkerRoute,
  deleteWorkerRoute,
  findZoneForHostname,
  listWorkerRoutes,
  updateWorkerRoute,
} from '@bohr/cloudflare';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Hostname, Project } from '../db/client';
import { ALL_BRANCHES, hostnames, type RouteChange, type SiteAuth, siteConfig } from '../db/schema';
import type { Env } from '../env';
import { cloudEnv } from '../lib/cloud';
import { conflict } from '../lib/http';
import { defaultHostname, scriptName } from '../lib/names';

// The record cloud/dispatcher reads from the ROUTES KV namespace (docs/managed-hosting.md)
export type RouteRecord = {
  v: 1;
  projectId: string;
  script: string;
  auth?: SiteAuth;
  headers?: Record<string, string>;
  suspended: boolean;
};

export async function buildRouteRecord(db: Db, project: Project, branch: string): Promise<RouteRecord> {
  const configs = await db
    .select()
    .from(siteConfig)
    .where(and(eq(siteConfig.projectId, project.id), inArray(siteConfig.branch, [ALL_BRANCHES, branch])))
    .all();
  const general = configs.find((config) => config.branch === ALL_BRANCHES);
  const specific = configs.find((config) => config.branch === branch);
  const auth = specific?.auth ?? general?.auth ?? null;
  const headers = { ...general?.headers, ...specific?.headers };

  const record: RouteRecord = {
    v: 1,
    projectId: project.id,
    script: await scriptName(project.id, branch),
    suspended: project.status === 'suspended',
  };
  if (auth !== null && auth.type !== 'none') record.auth = auth;
  if (Object.keys(headers).length > 0) record.headers = headers;
  return record;
}

export async function branchHostnames(db: Db, projectId: string, branch: string) {
  return db
    .select()
    .from(hostnames)
    .where(and(eq(hostnames.projectId, projectId), eq(hostnames.branch, branch)))
    .all();
}

// Writes the route record of every hostname of a branch; the dispatcher only sees them once traffic is cut over
export async function writeBranchRoutes(db: Db, env: Env, project: Project, branch: string) {
  const rows = await branchHostnames(db, project.id, branch);
  const record = JSON.stringify(await buildRouteRecord(db, project, branch));
  await Promise.all(rows.map((row) => cloudEnv(env).ROUTES.put(row.hostname, record)));
  return rows;
}

export async function writeProjectRoutes(db: Db, env: Env, project: Project) {
  const rows = await db.select().from(hostnames).where(eq(hostnames.projectId, project.id)).all();
  for (const branch of new Set(rows.map((row) => row.branch))) {
    await writeBranchRoutes(db, env, project, branch);
  }
}

// Points the hostname's Worker route at the dispatcher, remembering what it pointed at before
export async function cutoverHostname(db: Db, env: Env, cf: CloudflareClient, row: Hostname) {
  if (row.hostname.startsWith('*.') && row.status !== 'live') {
    // A zone-wide wildcard would also capture other sites still served by the v1 edge
    throw conflict(`Wildcard hostname ${row.hostname} must be cut over by hand.`);
  }
  const zoneId = row.zoneId ?? (await findZoneForHostname(cf, row.hostname))?.id;
  if (zoneId === undefined) throw conflict(`No Cloudflare zone in the account covers ${row.hostname}.`);

  const pattern = `${row.hostname}/*`;
  const existing = (await listWorkerRoutes(cf, zoneId)).find((route) => route.pattern === pattern);
  let change: RouteChange;
  if (existing === undefined) {
    const created = await createWorkerRoute(cf, zoneId, pattern, cloudEnv(env).DISPATCHER_SCRIPT);
    change = { zoneId, pattern, routeId: created.id, previousScript: null };
  } else if (existing.script === cloudEnv(env).DISPATCHER_SCRIPT) {
    change = row.routes?.[0] ?? { zoneId, pattern, routeId: existing.id, previousScript: null };
  } else {
    await updateWorkerRoute(cf, zoneId, existing.id, pattern, cloudEnv(env).DISPATCHER_SCRIPT);
    change = { zoneId, pattern, routeId: existing.id, previousScript: existing.script ?? null };
  }

  await db
    .update(hostnames)
    .set({ status: 'live', zoneId, routes: [change] })
    .where(eq(hostnames.hostname, row.hostname))
    .run();
  return change;
}

// Undoes cutoverHostname: routes go back to what they pointed at, or are removed if the cutover created them
export async function rollbackHostname(db: Db, cf: CloudflareClient, row: Hostname) {
  for (const change of row.routes ?? []) {
    if (change.previousScript === null) {
      await deleteWorkerRoute(cf, change.zoneId, change.routeId);
    } else {
      await updateWorkerRoute(cf, change.zoneId, change.routeId, change.pattern, change.previousScript);
    }
  }
  await db.update(hostnames).set({ status: 'pending', routes: null }).where(eq(hostnames.hostname, row.hostname)).run();
}

// A branch deployed for the first time gets "<branch>-<repo>-<owner>.<domain>" and goes live right away
export async function ensureBranchHostnames(db: Db, env: Env, cf: CloudflareClient, project: Project, branch: string) {
  const existing = await branchHostnames(db, project.id, branch);
  if (existing.length > 0) return existing;

  let hostname = await defaultHostname(project, branch, cloudEnv(env).BOHR_DOMAIN);
  const taken = await db.select().from(hostnames).where(eq(hostnames.hostname, hostname)).get();
  if (taken !== undefined) hostname = `${project.id}-${hostname}`;

  await db
    .insert(hostnames)
    .values({
      hostname,
      projectId: project.id,
      branch,
      isProduction: branch === project.productionBranch,
      zoneId: cloudEnv(env).BOHR_ZONE_ID,
    })
    .run();
  await writeBranchRoutes(db, env, project, branch);
  const row = await db.select().from(hostnames).where(eq(hostnames.hostname, hostname)).get();
  if (row !== undefined) await cutoverHostname(db, env, cf, row);
  return branchHostnames(db, project.id, branch);
}
