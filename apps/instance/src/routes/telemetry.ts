import { like } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '../db/client';
import { instanceSettings } from '../db/schema';
import type { AppEnv } from '../env';
import { bearerToken, isAdminToken } from '../lib/admin';
import { hasCloud } from '../lib/cloud';
import { badRequest, notFound, unauthorized } from '../lib/http';
import { recordTelemetry, setTelemetry, telemetryPingSchema, telemetryView } from '../services/telemetry';
import { requireAdminUser } from './manage';

// bohr.io Cloud receives the opt-in pings of self-hosted instances (services/telemetry.ts)
export const telemetryRoutes = new Hono<AppEnv>();

telemetryRoutes.post('/telemetry', async (c) => {
  if (!hasCloud(c.env)) throw notFound('Not found.');
  const parsed = telemetryPingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Invalid telemetry ping.');
  await recordTelemetry(createDb(c.env.DB), parsed.data);
  return c.body(null, 204);
});

// Operator summary: how many instances pinged, recently, and on which versions
telemetryRoutes.get('/admin/telemetry', async (c) => {
  if (!(await isAdminToken(c.env, bearerToken(c.req.header('Authorization'))))) throw unauthorized();
  const rows = await createDb(c.env.DB)
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(like(instanceSettings.key, 'telemetry_ping:%'))
    .all();
  const pings = rows.map((row) => JSON.parse(row.value) as { version: string; projects: number; lastSeen: number });
  const weekAgo = Date.now() - 7 * 24 * 60 * 60_000;
  const active = pings.filter((ping) => ping.lastSeen >= weekAgo);
  const versions: Record<string, number> = {};
  for (const ping of active) versions[ping.version] = (versions[ping.version] ?? 0) + 1;
  return c.json({
    instances: pings.length,
    activeLast7Days: active.length,
    projectsLast7Days: active.reduce((sum, ping) => sum + ping.projects, 0),
    versions,
  });
});

// Instance admins turn the telemetry of their self-hosted instance on or off, seeing exactly what is sent
telemetryRoutes.use('/manage/telemetry', requireAdminUser);

telemetryRoutes.get('/manage/telemetry', async (c) => c.json(await telemetryView(createDb(c.env.DB), c.env)));

telemetryRoutes.put('/manage/telemetry', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  if (enabled && hasCloud(c.env)) throw badRequest('bohr.io Cloud does not send telemetry.');
  return c.json(await setTelemetry(createDb(c.env.DB), c.env, enabled));
});
