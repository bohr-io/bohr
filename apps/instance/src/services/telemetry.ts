// Anonymous, opt-in telemetry of self-hosted instances: once a day, an instance whose admin turned it on
// sends its random ID, its version and how many projects it has. Nothing else: no names, URLs, users or
// repositories. bohr.io Cloud receives the pings (POST /api/telemetry) and never sends any.
// Documented in README.md#telemetry; BOHR_TELEMETRY=off turns it off whatever the panel says.
import { count } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { projects } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { BOHR_VERSION } from '../generated/version';
import { hasCloud } from '../lib/cloud';
import { USER_AGENT } from '../lib/user-agent';
import { readSetting, writeSetting } from './settings';

export const TELEMETRY_ENDPOINT = 'https://app.bohr.io/api/telemetry';
const INTERVAL_MS = 24 * 60 * 60_000;

const SETTING = 'telemetry';
const INSTANCE_ID = 'instance_id';
const PING_PREFIX = 'telemetry_ping:';

type TelemetrySetting = { enabled: boolean; lastSentAt: number | null };

export const telemetryPingSchema = z.object({
  instanceId: z.string().uuid(),
  version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
  projects: z.number().int().min(0).max(1_000_000),
});
export type TelemetryPing = z.infer<typeof telemetryPingSchema>;

export type TelemetryView = {
  /** False on bohr.io Cloud, which only receives pings. */
  available: boolean;
  enabled: boolean;
  /** BOHR_TELEMETRY=off: the panel cannot turn it on. */
  forcedOff: boolean;
  instanceId: string;
  lastSentAt: string | null;
  endpoint: string;
  /** Exactly what is sent. */
  payload: TelemetryPing;
};

const forcedOff = (env: Env) => ['off', '0', 'false'].includes((env.BOHR_TELEMETRY ?? '').toLowerCase());

/** The instance's random ID, created on first use; it identifies nothing but the instance. */
export async function instanceId(db: Db): Promise<string> {
  const existing = await readSetting<string>(db, INSTANCE_ID);
  if (existing !== null) return existing;
  const created = crypto.randomUUID();
  await writeSetting(db, INSTANCE_ID, created);
  return created;
}

export async function telemetryPayload(db: Db): Promise<TelemetryPing> {
  const [row] = await db.select({ total: count() }).from(projects).all();
  return { instanceId: await instanceId(db), version: BOHR_VERSION, projects: row?.total ?? 0 };
}

export async function telemetryView(db: Db, env: Env): Promise<TelemetryView> {
  const setting = (await readSetting<TelemetrySetting>(db, SETTING)) ?? { enabled: false, lastSentAt: null };
  const payload = await telemetryPayload(db);
  return {
    available: !hasCloud(env),
    enabled: setting.enabled && !forcedOff(env) && !hasCloud(env),
    forcedOff: forcedOff(env),
    instanceId: payload.instanceId,
    lastSentAt: setting.lastSentAt === null ? null : new Date(setting.lastSentAt).toISOString(),
    endpoint: TELEMETRY_ENDPOINT,
    payload,
  };
}

export async function setTelemetry(db: Db, env: Env, enabled: boolean): Promise<TelemetryView> {
  const setting = (await readSetting<TelemetrySetting>(db, SETTING)) ?? { enabled: false, lastSentAt: null };
  await writeSetting(db, SETTING, { ...setting, enabled } satisfies TelemetrySetting);
  // The first ping goes out right away, so the admin sees it was sent
  if (enabled) await sendTelemetry(db, env);
  return telemetryView(db, env);
}

/** Hourly from the cron: sends the ping when telemetry is on and a day has passed since the last one. */
export async function sendTelemetry(db: Db, env: Env, now = Date.now()): Promise<boolean> {
  if (hasCloud(env) || forcedOff(env)) return false;
  const setting = await readSetting<TelemetrySetting>(db, SETTING);
  if (!setting?.enabled) return false;
  if (setting.lastSentAt !== null && now - setting.lastSentAt < INTERVAL_MS) return false;
  const response = await deps
    .fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(await telemetryPayload(db)),
    })
    .catch(() => null);
  if (response === null || !response.ok) return false;
  await writeSetting(db, SETTING, { ...setting, lastSentAt: now } satisfies TelemetrySetting);
  return true;
}

/** bohr.io Cloud: keeps the last ping of each instance. */
export async function recordTelemetry(db: Db, ping: TelemetryPing, now = Date.now()): Promise<void> {
  const key = `${PING_PREFIX}${ping.instanceId}`;
  const previous = await readSetting<{ firstSeen: number }>(db, key);
  await writeSetting(db, key, { ...ping, firstSeen: previous?.firstSeen ?? now, lastSeen: now });
}
