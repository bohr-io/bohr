// Screenshots of the projects' production sites, for the panel's project cards (bohr v1 had one per project).
// Cloudflare Browser Rendering takes them (the BROWSER binding, deps.screenshotter); they live in the BUNDLES
// bucket under screenshots/. A picture is taken after each successful production deploy and, when the panel asks
// for one that is missing or stale, in the background of that request: a request never waits for a browser.
// Sites behind password protection get no picture (it would show the browser's sign-in error, and the picture
// must not show what the password protects); one taken before the protection is no longer served.
import { and, desc, eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { ALL_BRANCHES, deployments, hostnames, siteConfig } from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';

/** A picture older than this is taken again when the panel shows it. */
export const SCREENSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** After an attempt (failed, or still running), the panel's requests leave the project alone this long. */
export const SCREENSHOT_RETRY_MS = 60 * 60 * 1000;
/** A deploy's picture waits for another one of the same project this long, so two quick deploys take one. */
const DEPLOY_RETRY_MS = 60 * 1000;
/** Browsers one instance isolate runs at a time; Browser Rendering bills browser time and limits sessions. */
export const MAX_CONCURRENT_CAPTURES = 2;

export const screenshotKey = (projectId: string) => `screenshots/${projectId}.webp`;
const attemptKey = (projectId: string) => `screenshots/${projectId}.attempt`;

let running = 0;

export type ScreenshotResult = 'captured' | 'skipped' | 'failed';

/**
 * Whether this instance takes pictures: Browser Rendering and the bucket are bound, and it is not a local
 * instance reading production (wrangler.prod-db.jsonc), whose writes would be real.
 */
export function capturesScreenshots(env: Env): boolean {
  if (env.BUNDLES === undefined) return false;
  if (env.LOCAL_PRODUCTION_DB === '1' && env.LOCAL_ALLOW_WRITES !== '1') return false;
  return deps.screenshotter(env) !== null;
}

/** The address of the project's production site: a live one first, then any (a v1 address still serves it). */
export async function productionAddress(db: Db, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ hostname: hostnames.hostname, status: hostnames.status })
    .from(hostnames)
    .where(and(eq(hostnames.projectId, projectId), eq(hostnames.isProduction, true)))
    .all();
  const named = rows.filter((row) => !row.hostname.startsWith('*.'));
  const row = named.find((candidate) => candidate.status === 'live') ?? named[0];
  return row === undefined ? null : `https://${row.hostname}`;
}

/** Whether the site asks for a password (site protection, services/protection.ts). */
export async function isProtected(db: Db, projectId: string): Promise<boolean> {
  const row = await db
    .select({ auth: siteConfig.auth })
    .from(siteConfig)
    .where(and(eq(siteConfig.projectId, projectId), eq(siteConfig.branch, ALL_BRANCHES)))
    .get();
  return row?.auth?.type === 'basic';
}

/** Missing, older than SCREENSHOT_MAX_AGE_MS, or older than the latest production deploy. */
export async function isStale(db: Db, project: Project, taken: Date | null, now = Date.now()): Promise<boolean> {
  if (taken === null || now - taken.getTime() > SCREENSHOT_MAX_AGE_MS) return true;
  const latest = await db
    .select({ finishedAt: deployments.finishedAt })
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, project.id),
        eq(deployments.branch, project.productionBranch),
        eq(deployments.status, 'success'),
      ),
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1)
    .get();
  return latest?.finishedAt != null && latest.finishedAt.getTime() > taken.getTime();
}

/**
 * Takes the picture of the project's production site and stores it. `deploy`: right after a production deploy;
 * `stale`: the panel found it missing or old. Never throws: a site that does not load keeps its old picture.
 */
export async function refreshScreenshot(
  db: Db,
  env: Env,
  project: Project,
  reason: 'deploy' | 'stale',
  now = Date.now(),
): Promise<ScreenshotResult> {
  const bucket = env.BUNDLES;
  const screenshotter = deps.screenshotter(env);
  if (bucket === undefined || screenshotter === null || !capturesScreenshots(env)) return 'skipped';
  if (running >= MAX_CONCURRENT_CAPTURES) return 'skipped';
  running++;
  try {
    const url = await productionAddress(db, project.id);
    if (url === null || (await isProtected(db, project.id))) return 'skipped';
    // One attempt at a time per project, across isolates, and a failing site is not retried on every view
    const attempt = await bucket.head(attemptKey(project.id));
    const wait = reason === 'deploy' ? DEPLOY_RETRY_MS : SCREENSHOT_RETRY_MS;
    if (attempt !== null && now - attempt.uploaded.getTime() < wait) return 'skipped';
    await bucket.put(attemptKey(project.id), new Date(now).toISOString());

    const shot = await screenshotter.capture(url);
    // An error page is not the site; the last good picture stays
    if (shot.status !== null && shot.status >= 400) {
      console.warn('[screenshots]', project.id, url, 'answered', shot.status);
      return 'failed';
    }
    await bucket.put(screenshotKey(project.id), shot.image, {
      httpMetadata: { contentType: shot.contentType },
      customMetadata: { url },
    });
    return 'captured';
  } catch (error) {
    console.error('[screenshots]', project.id, error);
    return 'failed';
  } finally {
    running--;
  }
}

/** The stored picture, for the panel; null when there is none or the site is password protected. */
export async function readScreenshot(
  db: Db,
  env: Env,
  project: Project,
  etag?: string,
): Promise<R2ObjectBody | R2Object | null> {
  if (env.BUNDLES === undefined || (await isProtected(db, project.id))) return null;
  return env.BUNDLES.get(screenshotKey(project.id), etag ? { onlyIf: { etagDoesNotMatch: etag } } : undefined);
}

/** A deleted project's pictures. */
export async function deleteScreenshots(env: Env, projectId: string): Promise<void> {
  await env.BUNDLES?.delete([screenshotKey(projectId), attemptKey(projectId)]);
}
