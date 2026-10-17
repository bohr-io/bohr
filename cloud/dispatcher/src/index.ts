import { basicChallenge, isAuthorized } from './auth';
import { errorPage, notFoundPage, suspendedPage, unauthorizedPage } from './pages';
import { findRoute, normalizeHostname, type RouteRecord } from './routes';

// Behaviour: docs/managed-hosting.md, "Dispatcher behaviour".

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = normalizeHostname(url.hostname);
    let record: RouteRecord | null = null;
    let response: Response;
    try {
      record = await findRoute(env.ROUTES, hostname);
      response = await handle(request, env, url, hostname, record);
    } catch (err) {
      // Details stay in the logs; visitors only get the generic page.
      console.error(`dispatcher: request to ${hostname} (script ${record?.script ?? 'none'}) failed`, err);
      response = errorPage();
    }
    return withHeaders(response, record);
  },
} satisfies ExportedHandler<Env>;

async function handle(
  request: Request,
  env: Env,
  url: URL,
  hostname: string,
  record: RouteRecord | null,
): Promise<Response> {
  if (record === null) {
    return hostname.startsWith('www.') ? redirectWithoutWww(url, hostname) : notFoundPage();
  }
  if (record.movedTo !== undefined) {
    // Response.redirect has immutable headers; the security headers are added afterwards
    return new Response(null, { status: 301, headers: { Location: `${record.movedTo}${url.pathname}${url.search}` } });
  }
  if (record.proxyTo !== undefined) {
    // A new response: the Worker's own has immutable headers, and the security headers are added afterwards
    const response = await fetch(new Request(`${record.proxyTo}${url.pathname}${url.search}`, request), {
      redirect: 'manual',
    });
    return new Response(response.body, response);
  }
  if (record.suspended) return suspendedPage();
  // A repository's git data and environment files are never content, even when a deploy uploaded them as assets
  // (static sites served from the repository root)
  if (isPrivatePath(url.pathname)) return notFoundPage();

  const { auth } = record;
  if (auth?.type === 'basic' && !bypassed(url.pathname, auth.bypassPaths)) {
    const authorized = await isAuthorized(hostname, request.headers.get('Authorization'), auth.users);
    if (!authorized) return unauthorizedPage(basicChallenge(hostname));
  }

  return dispatch(env.DISPATCHER, record.script, request);
}

/** A path segment named .git, .env or .env.<name>, also percent-encoded or in another case. */
export function isPrivatePath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: check the raw path
  }
  return decoded.split(/[/\\]/).some((segment) => /^\.(git|env)(\..+)?$/i.test(segment));
}

/** 301 to the same URL without `www.`, keeping path and query. */
function redirectWithoutWww(url: URL, hostname: string): Response {
  const target = new URL(url);
  target.hostname = hostname.slice('www.'.length);
  return new Response(null, { status: 301, headers: { Location: target.href } });
}

async function dispatch(namespace: DispatchNamespace, script: string, request: Request): Promise<Response> {
  let response: Response;
  try {
    response = await namespace.get(script).fetch(request);
  } catch (err) {
    if (isWorkerNotFound(err)) return notFoundPage();
    throw err;
  }
  // Re-wrap: headers of a response from another Worker may be immutable.
  return new Response(response.body, response);
}

/** Workers for Platforms throws "Worker not found..." for scripts missing from the namespace. */
function isWorkerNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message.startsWith('Worker not found')
  );
}

function withHeaders(response: Response, record: RouteRecord | null): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  for (const [name, value] of Object.entries(record?.headers ?? {})) response.headers.set(name, value);
  return response;
}

/** A path that skips Basic Auth: exact, or a prefix when it ends with "*" (as in the panel and the site gate). */
function bypassed(pathname: string, paths: readonly string[] = []): boolean {
  return paths.some((path) => (path.endsWith('*') ? pathname.startsWith(path.slice(0, -1)) : pathname === path));
}
