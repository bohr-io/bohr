import { RUNTIME_API_PREFIX } from '@bohr/shared';
import { readWebhookUpdate } from '@bohr/telegram';
import { verifyInstanceToken } from './auth';
import type { Env } from './env';

export { Gateway } from './gateway';
export { Preview } from './preview';
export { Project } from './project';

export const VERSION = '0.3.16';

const MAX_API_BODY = 64 * 1024;

const project = (env: Env) => env.PROJECT.getByName(env.PROJECT_ID);

async function telegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return new Response(null, { status: 404 });
  const update = await readWebhookUpdate(request, env.TELEGRAM_WEBHOOK_SECRET);
  if (update === null) return new Response(null, { status: 401 });
  try {
    await project(env).telegramUpdate(update);
  } catch (error) {
    // Answer 200 anyway: Telegram would resend the update, and handling it twice is worse.
    console.error('[webhook] Update failed:', error instanceof Error ? error.message : error);
  }
  return new Response(null, { status: 200 });
}

async function runtimeApi(request: Request, env: Env, url: URL): Promise<Response> {
  const caller = await verifyInstanceToken(env, request.headers.get('Authorization'));
  if (caller === null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown = null;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    const text = await request.text();
    if (text.length > MAX_API_BODY) return Response.json({ error: 'too_large' }, { status: 413 });
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
    }
  }
  return project(env).api({
    method: request.method,
    path: url.pathname.slice(RUNTIME_API_PREFIX.length) || '/',
    query: Object.fromEntries(url.searchParams),
    body,
    caller,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__bohr/health') return Response.json({ ok: true, version: VERSION });
    if (url.pathname === '/__bohr/telegram') return telegramWebhook(request, env);
    if (url.pathname === RUNTIME_API_PREFIX || url.pathname.startsWith(`${RUNTIME_API_PREFIX}/`)) {
      return runtimeApi(request, env, url);
    }
    return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  },
} satisfies ExportedHandler<Env>;
