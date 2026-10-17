import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { deployments, projectMembers, projects, sessions, siteConfig, users } from '../src/db/schema';
import { deps, type Screenshot } from '../src/deps';
import { app } from '../src/index';
import { sha256Hex } from '../src/lib/crypto';
import {
  capturesScreenshots,
  isStale,
  refreshScreenshot,
  SCREENSHOT_MAX_AGE_MS,
  SCREENSHOT_RETRY_MS,
  screenshotKey,
} from '../src/services/screenshots';
import { baseMetadata, importProject, oidcToken, resetStorage, useFakes } from './helpers';

const db = createDb(env.DB);
const originalScreenshotter = deps.screenshotter;
const IMAGE = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

let captured: string[];
let answer: () => Screenshot;

/** A request whose background work (waitUntil) has finished when it returns. */
async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await app.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function deploy(branch: string) {
  const token = await oidcToken('acme/store', branch);
  const session = await call('/api/deploy/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest: {}, assetsConfig: {} }),
  });
  const { sessionId } = (await session.json()) as { sessionId: string };
  const form = new FormData();
  form.append('metadata', JSON.stringify(baseMetadata));
  form.append('index.js', new File(['export default {};'], 'index.js', { type: 'application/javascript+module' }));
  const response = await call(`/api/deploy/sessions/${sessionId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  expect(response.status).toBe(200);
}

/** The imported project (store.example.com) and its owner's session. */
async function ownerProject() {
  const { project } = await importProject();
  const projectId = String(project?.projectId);
  const owner = await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).all();
  const userId = owner.find((row) => row.role === 'owner')?.userId ?? '';
  await db
    .insert(sessions)
    .values({ idHash: await sha256Hex('session-owner'), userId, expiresAt: new Date(Date.now() + 3_600_000) })
    .run();
  const row = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (row === undefined) throw new Error('No project');
  return { project: row, headers: { Cookie: '__Host-bohr_session=session-owner' } };
}

beforeEach(async () => {
  await resetStorage();
  const cloudflare = useFakes();
  cloudflare.zones.set('example.com', 'zone-example');
  captured = [];
  answer = () => ({ status: 200, image: IMAGE, contentType: 'image/webp' });
  deps.screenshotter = () => ({
    async capture(url) {
      captured.push(url);
      return answer();
    },
  });
});

afterEach(() => {
  deps.screenshotter = originalScreenshotter;
});

describe('project screenshots', () => {
  it("takes the production site's picture after a production deploy, not after a preview's", async () => {
    const { project, headers } = await ownerProject();

    await deploy('feature');
    expect(captured).toEqual([]);

    await deploy('main');
    expect(captured).toEqual(['https://store.example.com']);
    const stored = await env.BUNDLES.get(screenshotKey(project.id));
    expect(stored?.httpMetadata?.contentType).toBe('image/webp');

    const response = await call(`/api/projects/${project.id}/screenshot`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE);
    // Fresh: the panel's view takes no new picture, and a cached copy is confirmed without the image
    expect(captured).toHaveLength(1);
    const etag = response.headers.get('ETag') ?? '';
    const again = await call(`/api/projects/${project.id}/screenshot`, {
      headers: { ...headers, 'If-None-Match': etag },
    });
    expect(again.status).toBe(304);
  });

  it('answers 404 until there is a picture, and takes the missing one after the response', async () => {
    const { project, headers } = await ownerProject();

    const missing = await call(`/api/projects/${project.id}/screenshot`, { headers });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    expect(captured).toEqual(['https://store.example.com']);

    const found = await call(`/api/projects/${project.id}/screenshot`, { headers });
    expect(found.status).toBe(200);
    expect(captured).toHaveLength(1);
  });

  it('keeps the projects of others to their members', async () => {
    const { project } = await ownerProject();
    await db.insert(users).values({ id: 'u_stranger', name: 'Stranger' }).run();
    await db
      .insert(sessions)
      .values({
        idHash: await sha256Hex('session-stranger'),
        userId: 'u_stranger',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .run();

    const response = await call(`/api/projects/${project.id}/screenshot`, {
      headers: { Cookie: '__Host-bohr_session=session-stranger' },
    });
    expect(response.status).toBe(404);
    expect(captured).toEqual([]);
    expect((await call(`/api/projects/${project.id}/screenshot`)).status).toBe(401);
  });

  it('neither takes nor serves the picture of a password-protected site', async () => {
    const { project, headers } = await ownerProject();
    await env.BUNDLES.put(screenshotKey(project.id), IMAGE);
    await db
      .insert(siteConfig)
      .values({ projectId: project.id, branch: '*', auth: { type: 'basic', users: [] } })
      .onConflictDoUpdate({
        target: [siteConfig.projectId, siteConfig.branch],
        set: { auth: { type: 'basic', users: [] } },
      })
      .run();

    expect((await call(`/api/projects/${project.id}/screenshot`, { headers })).status).toBe(404);
    expect(await refreshScreenshot(db, env, project, 'deploy')).toBe('skipped');
    expect(captured).toEqual([]);
  });

  it('keeps the last good picture when the site answers an error, and waits before trying again', async () => {
    const { project } = await ownerProject();
    const now = Date.now();
    expect(await refreshScreenshot(db, env, project, 'stale', now)).toBe('captured');

    answer = () => ({ status: 503, image: new Uint8Array([0]), contentType: 'image/webp' });
    expect(await refreshScreenshot(db, env, project, 'deploy', now + 120_000)).toBe('failed');
    expect(
      new Uint8Array(await ((await env.BUNDLES.get(screenshotKey(project.id))) as R2ObjectBody).arrayBuffer()),
    ).toEqual(IMAGE);
    // The attempt markers are stamped by R2 with the real time: a retry needs the wait to have passed
    expect(await refreshScreenshot(db, env, project, 'stale', Date.now() + 1000)).toBe('skipped');
    expect(await refreshScreenshot(db, env, project, 'stale', Date.now() + SCREENSHOT_RETRY_MS + 1000)).toBe('failed');
    expect(captured).toHaveLength(3);
  });

  it('is stale when missing, older than a week or older than the latest production deploy', async () => {
    const { project } = await ownerProject();
    const now = Date.now();
    expect(await isStale(db, project, null, now)).toBe(true);
    expect(await isStale(db, project, new Date(now - SCREENSHOT_MAX_AGE_MS - 1), now)).toBe(true);
    expect(await isStale(db, project, new Date(now - 60_000), now)).toBe(false);

    await db
      .insert(deployments)
      .values({
        id: 'd_new',
        projectId: project.id,
        branch: 'main',
        script: `${project.id}-main`,
        status: 'success',
        actor: 'test',
        finishedAt: new Date(now - 1000),
      })
      .run();
    expect(await isStale(db, project, new Date(now - 60_000), now)).toBe(true);
    expect(await isStale(db, project, new Date(now - 500), now)).toBe(false);
  });

  it('takes no pictures without Browser Rendering, or on a local instance reading production', async () => {
    const { project, headers } = await ownerProject();
    expect(capturesScreenshots({ ...env, LOCAL_PRODUCTION_DB: '1' })).toBe(false);
    expect(capturesScreenshots({ ...env, LOCAL_PRODUCTION_DB: '1', LOCAL_ALLOW_WRITES: '1' })).toBe(true);

    deps.screenshotter = originalScreenshotter;
    expect(capturesScreenshots(env)).toBe(false);
    expect((await call(`/api/projects/${project.id}/screenshot`, { headers })).status).toBe(404);
    expect(await refreshScreenshot(db, env, project, 'deploy')).toBe('skipped');
    expect(captured).toEqual([]);
  });
});
