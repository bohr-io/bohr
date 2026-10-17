import { isRecord } from './encoding';
import { GithubError } from './errors';

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

/** Options every entry point accepts. `sleep` is only used to wait before retrying a rate-limited call. */
export type TransportOptions = {
  fetch?: Fetch;
  apiBase?: string;
  userAgent?: string;
  sleep?: Sleep;
};

export type Transport = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  apiBase: string;
  userAgent: string;
  sleep: Sleep;
  token?: string;
};

export type Reply = { status: number; headers: Headers; data: unknown };

// Longest wait honored before the single retry of a rate-limited call
const MAX_RETRY_WAIT_SECONDS = 10;
const MAX_PAGES = 20;

export function createTransport(options: TransportOptions, token?: string): Transport {
  const fetchImpl = options.fetch ?? fetch;
  const transport: Transport = {
    // Called detached: Workers throw "Illegal invocation" when fetch runs with a foreign `this`
    fetch: (url, init) => fetchImpl(url, init),
    apiBase: (options.apiBase ?? GITHUB_API).replace(/\/+$/, ''),
    userAgent: options.userAgent ?? 'bohr (+https://bohr.io)',
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  if (token !== undefined) transport.token = token;
  return transport;
}

/** JSON request to a full URL, retried once on a short rate limit. Throws GithubError on non-2xx; no body gives undefined. */
export async function send(transport: Transport, method: string, url: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': transport.userAgent,
  };
  if (transport.token !== undefined) headers.Authorization = `Bearer ${transport.token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response = await transport.fetch(url, init);
  let data = await readBody(response);
  const wait = response.ok ? null : retryWait(response, data);
  if (wait !== null) {
    await transport.sleep(wait);
    response = await transport.fetch(url, init);
    data = await readBody(response);
  }
  if (!response.ok) throw new GithubError(response.status, data);
  return { status: response.status, headers: response.headers, data };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Rate limits answer 403 or 429. Retry once when GitHub asks for a short wait, or on a secondary limit that
// gives no retry-after (GitHub suggests a minute there; one capped wait keeps the call bounded).
function retryWait(response: Response, data: unknown): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = parseRetryAfter(retryAfter);
    return seconds !== null && seconds <= MAX_RETRY_WAIT_SECONDS ? seconds * 1000 : null;
  }
  return isSecondaryRateLimit(data) ? MAX_RETRY_WAIT_SECONDS * 1000 : null;
}

function parseRetryAfter(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function isSecondaryRateLimit(data: unknown): boolean {
  return (
    isRecord(data) && typeof data.message === 'string' && /secondary rate limit|abuse detection/i.test(data.message)
  );
}

/** The `rel="next"` URL of a Link header, or null. */
export function nextPageUrl(link: string | null): string | null {
  if (link === null) return null;
  for (const match of link.matchAll(/<([^>]*)>\s*;\s*rel="([^"]*)"/g)) {
    if (match[2]?.split(/\s+/).includes('next')) return match[1] ?? null;
  }
  return null;
}

/** GETs `url` and follows Link rel="next" for up to 20 pages, collecting what `pick` takes from each page. */
export async function paginate<Page, Item>(
  transport: Transport,
  url: string,
  pick: (page: Page) => Item[],
): Promise<Item[]> {
  const origin = new URL(transport.apiBase).origin;
  const items: Item[] = [];
  let next: URL | null = new URL(url);
  for (let page = 0; next !== null && page < MAX_PAGES; page++) {
    const reply = await send(transport, 'GET', next.href);
    items.push(...pick(reply.data as Page));
    const link = nextPageUrl(reply.headers.get('link'));
    next = link === null ? null : new URL(link, next);
    // The token goes with every page, so never follow a link off the API host
    if (next !== null && next.origin !== origin) {
      throw new Error(`Refusing to follow a pagination link to ${next.origin}`);
    }
  }
  return items;
}

/** GitHub Enterprise Server serves REST under /api/v3 and GraphQL at /api/graphql. */
export function graphqlUrl(apiBase: string): string {
  return `${apiBase.replace(/\/api\/v3$/, '/api')}/graphql`;
}

/** One encoded URL path segment. Refuses empty, `.` and `..`: URL parsing would drop the last two, changing the endpoint. */
export function segment(value: string | number): string {
  const text = String(value);
  if (text === '' || text === '.' || text === '..') throw new Error(`Invalid GitHub path segment: "${text}"`);
  return encodeURIComponent(text);
}

/** A branch name or file path: keeps the `/` separators and encodes everything else. */
export function segments(value: string): string {
  return value.split('/').map(segment).join('/');
}

export function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
