import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { projects, users } from '../src/db/schema';
import { deps } from '../src/deps';
import { BOHR_VERSION } from '../src/generated/version';
import { sendTelemetry, setTelemetry, TELEMETRY_ENDPOINT, telemetryView } from '../src/services/telemetry';
import { adminHeaders, call, resetStorage } from './helpers';

const db = createDb(env.DB);
// A self-hosted instance: no managed hosting settings
const selfHosted = { ...env, CF_API_TOKEN: undefined, CF_ACCOUNT_ID: undefined };
let sent: Request[] = [];

beforeEach(async () => {
  await resetStorage();
  sent = [];
  deps.fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push(request.clone());
    // The Cloud receives the ping
    return call(new URL(request.url).pathname, {
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
  };
  await db.insert(users).values({ id: 'u_ana', name: 'Ana' }).run();
  await db
    .insert(projects)
    .values({
      id: 'p_1',
      ownerUserId: 'u_ana',
      name: 'Loja',
      repoOwner: 'ana',
      repoName: 'loja',
      repoKey: 'ana/loja',
      productionBranch: 'main',
      mode: 'byo',
    })
    .run();
});

describe('telemetry', () => {
  it('is off until an admin turns it on, and then sends only the instance ID, version and project count', async () => {
    expect(await sendTelemetry(db, selfHosted)).toBe(false);
    expect(sent).toEqual([]);

    const view = await setTelemetry(db, selfHosted, true);
    expect(view).toMatchObject({ available: true, enabled: true, endpoint: TELEMETRY_ENDPOINT });
    expect(view.lastSentAt).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(TELEMETRY_ENDPOINT);
    expect(sent[0]?.headers.get('user-agent')).toBe(`bohr/${BOHR_VERSION} (+https://bohr.io)`);
    const body = JSON.parse((await sent[0]?.clone().text()) ?? '{}');
    expect(body).toEqual({ instanceId: view.instanceId, version: BOHR_VERSION, projects: 1 });

    // Once a day
    expect(await sendTelemetry(db, selfHosted)).toBe(false);
    expect(await sendTelemetry(db, selfHosted, Date.now() + 25 * 60 * 60_000)).toBe(true);
    expect(sent).toHaveLength(2);

    // The Cloud kept the last ping of the instance
    const summary = await (await call('/api/admin/telemetry', { headers: adminHeaders })).json();
    expect(summary).toEqual({
      instances: 1,
      activeLast7Days: 1,
      projectsLast7Days: 1,
      versions: { [BOHR_VERSION]: 1 },
    });

    await setTelemetry(db, selfHosted, false);
    expect(await sendTelemetry(db, selfHosted, Date.now() + 60 * 60 * 60_000)).toBe(false);
  });

  it('never sends from bohr.io Cloud or when BOHR_TELEMETRY=off', async () => {
    expect((await setTelemetry(db, env, true)).available).toBe(false);
    expect(await sendTelemetry(db, env)).toBe(false);
    const off = { ...selfHosted, BOHR_TELEMETRY: 'off' };
    const view = await setTelemetry(db, off, true);
    expect(view).toMatchObject({ enabled: false, forcedOff: true });
    expect(sent).toEqual([]);
  });

  it('accepts only well-formed pings, on the Cloud', async () => {
    const post = (body: unknown) =>
      call('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ instanceId: 'x', version: '1', projects: 1 })).status).toBe(400);
    expect((await post({ instanceId: crypto.randomUUID(), version: '2.0.0', projects: 3 })).status).toBe(204);
    expect((await telemetryView(db, selfHosted)).payload.projects).toBe(1);
  });
});
