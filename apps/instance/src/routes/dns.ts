import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createDb, type Db } from '../db/client';
import { orgs } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { hasCloud } from '../lib/cloud';
import { notFound } from '../lib/http';
import {
  allZones,
  createRecord,
  deleteRecord,
  exportZone,
  RECORD_TYPES,
  updateRecord,
  userZones,
  type ZoneAccess,
  zoneAccess,
  zoneActor,
  zoneRecords,
} from '../services/dns';
import { requireUser } from './api';

// DNS of the domains whose zone bohr hosts (bohr.io Cloud only: zones bohr v1 kept in its Cloudflare account).
// Owners and org admins change records; org members read them. Records bohr needs to serve sites are read-only.
export const dnsRoutes = new Hono<AppEnv>();

// Other instances host no zones: the routes do not exist there
const requireCloud = createMiddleware<AppEnv>(async (c, next) => {
  if (!hasCloud(c.env)) throw notFound();
  await next();
});
dnsRoutes.use('/dns/*', requireCloud, requireUser);

const recordFields = {
  type: z.enum(RECORD_TYPES),
  // "@" is the domain itself; "www" or "www.example.com"
  name: z.string().max(253),
  content: z.string().max(4096),
  // 1: automatic
  ttl: z.number().int(),
  proxied: z.boolean(),
  priority: z.number().int().min(0).max(65535).nullish(),
};
const recordBody = z.object({
  ...recordFields,
  ttl: recordFields.ttl.default(1),
  proxied: recordFields.proxied.default(false),
});
// A change: the fields left out keep their values
const recordPatch = z.object(recordFields).partial();

async function zoneView(db: Db, env: Env, { zone, canEdit, access }: ZoneAccess) {
  const org =
    zone.orgId === null
      ? undefined
      : await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs).where(eq(orgs.id, zone.orgId)).get();
  return {
    zone: { name: zone.name, canEdit, access, org: org ?? null },
    records: await zoneRecords(db, env, zone),
  };
}

dnsRoutes.get('/dns/zones', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  return c.json({ zones: user.role === 'admin' ? await allZones(db, c.env) : await userZones(db, user.id) });
});

dnsRoutes.get('/dns/zones/:name/records', async (c) => {
  const db = createDb(c.env.DB);
  return c.json(await zoneView(db, c.env, await zoneAccess(db, c.env, c.req.param('name'), c.get('user'))));
});

dnsRoutes.post('/dns/zones/:name/records', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const access = await zoneAccess(db, c.env, c.req.param('name'), user, 'edit');
  const input = recordBody.parse(await c.req.json());
  await createRecord(
    db,
    c.env,
    access.zone,
    { ...input, priority: input.priority ?? null },
    zoneActor(user, access.access),
  );
  return c.json(await zoneView(db, c.env, access), 201);
});

dnsRoutes.patch('/dns/zones/:name/records/:id', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const access = await zoneAccess(db, c.env, c.req.param('name'), user, 'edit');
  const patch = recordPatch.parse(await c.req.json());
  await updateRecord(db, c.env, access.zone, c.req.param('id'), patch, zoneActor(user, access.access));
  return c.json(await zoneView(db, c.env, access));
});

dnsRoutes.delete('/dns/zones/:name/records/:id', async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get('user');
  const access = await zoneAccess(db, c.env, c.req.param('name'), user, 'edit');
  await deleteRecord(db, c.env, access.zone, c.req.param('id'), zoneActor(user, access.access));
  return c.json(await zoneView(db, c.env, access));
});

// The zone file (BIND), to import the records elsewhere: moving the domain to the owner's own Cloudflare account
dnsRoutes.get('/dns/zones/:name/export', async (c) => {
  const db = createDb(c.env.DB);
  const { zone } = await zoneAccess(db, c.env, c.req.param('name'), c.get('user'));
  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${zone.name}.txt"`);
  c.header('Cache-Control', 'no-store');
  return c.body(await exportZone(c.env, zone));
});
