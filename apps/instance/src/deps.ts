import { CloudflareClient } from '@bohr/cloudflare';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { Env } from './env';
import { cloudEnv } from './lib/cloud';
import { USER_AGENT } from './lib/user-agent';
import type { ProvisionParams } from './workflows/provision';

let githubJwks: JWTVerifyGetKey | undefined;

/** A picture of a page: the image and the HTTP status of the page's own response (null when it gave none). */
export type Screenshot = { status: number | null; image: Uint8Array; contentType: string };
export type Screenshotter = { capture(url: string): Promise<Screenshot> };

// The browser's window, and how long a page gets to load before its picture is taken anyway
const SCREENSHOT_VIEWPORT = { width: 1280, height: 800 };
const SCREENSHOT_LOAD_TIMEOUT_MS = 20_000;

// External services, replaced in tests
export const deps = {
  githubOidcKeys(): JWTVerifyGetKey {
    githubJwks ??= createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
    return githubJwks;
  },
  cloudflare(env: Env): CloudflareClient {
    const cloud = cloudEnv(env);
    return new CloudflareClient({
      apiToken: cloud.CF_API_TOKEN,
      accountId: cloud.CF_ACCOUNT_ID,
      userAgent: USER_AGENT,
    });
  },
  // A user's (or the instance's) Cloudflare account, for project runtimes
  userCloudflare(apiToken: string, accountId: string): CloudflareClient {
    return new CloudflareClient({
      apiToken,
      accountId,
      fetch: (input, init) => deps.fetch(input, init),
      userAgent: USER_AGENT,
    });
  },
  // Starts the provisioning Workflow; tests record the call instead
  async startProvisioning(env: Env, params: ProvisionParams): Promise<void> {
    await env.PROVISION.create({ id: `provision-${params.projectId}-${Date.now()}`, params });
  },
  // Sends through the EMAIL binding (Cloudflare Email Service); tests capture the messages instead
  async sendEmail(env: Env, message: EmailMessageBuilder): Promise<void> {
    if (env.EMAIL === undefined) throw new Error('The EMAIL binding is not configured.');
    await env.EMAIL.send(message);
  },
  // The dedicated sign-in container of an owner (`user:<id>` or `org:<id>`), through the CLAUDE_LOGIN Durable
  // Object: POSTs a sign-in step (RUNNER_PATHS.claudeLogin*) to its server. Tests fake the server instead.
  claudeLoginServer(env: Env, owner: string): (path: string, body: unknown) => Promise<Response> {
    const namespace = env.CLAUDE_LOGIN;
    if (namespace === undefined) throw new Error('The CLAUDE_LOGIN binding is not configured.');
    const stub = namespace.getByName(owner);
    return (path, body) =>
      stub.fetch(`https://claude-login${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  },
  // Screenshots through Cloudflare Browser Rendering (the BROWSER binding); null without it. Tests fake it.
  screenshotter(env: Env): Screenshotter | null {
    const binding = env.BROWSER;
    if (binding === undefined) return null;
    return {
      async capture(url) {
        // Loaded on the first capture only: most requests never take a picture
        const { default: puppeteer } = await import('@cloudflare/puppeteer');
        const browser = await puppeteer.launch(binding);
        try {
          const page = await browser.newPage();
          await page.setViewport(SCREENSHOT_VIEWPORT);
          let status: number | null = null;
          try {
            const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: SCREENSHOT_LOAD_TIMEOUT_MS });
            status = response?.status() ?? null;
          } catch (error) {
            // A page that never goes quiet (polling, streaming, analytics) still gets its picture as it is
            if (!(error instanceof Error && error.name === 'TimeoutError')) throw error;
          }
          const image = await page.screenshot({ type: 'webp', quality: 70 });
          return { status, image: new Uint8Array(image), contentType: 'image/webp' };
        } finally {
          await browser.close();
        }
      },
    };
  },
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  },
  // Waits between polls of an outside service; tests skip the wait
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
