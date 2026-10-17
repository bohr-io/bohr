import { encodeBase64 } from './base64';
import type { LambdaFunctionUrlEvent } from './types';

export interface ToLambdaEventOptions {
  /** Removed once from the start of the path, as bohr v1 did for "/api": "/api/users" → "/users", "/api" → "/". */
  stripPrefix?: string;
  /** requestContext.requestId; a random UUID by default. */
  requestId?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Bodies of these types (plus text/*, +json and +xml) are passed as text. Everything else,
// forms and multipart included, is base64-encoded, as Function URLs do.
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/javascript']);

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Converts a Fetch request into a Lambda Function URL event (payload format 2.0). */
export async function toLambdaEvent(
  request: Request,
  options: ToLambdaEventOptions = {},
): Promise<LambdaFunctionUrlEvent> {
  const now = new Date();
  const url = new URL(request.url);
  const path = stripPathPrefix(url.pathname, options.stripPrefix);
  const rawQueryString = url.search.slice(1);
  const sourceIp = request.headers.get('cf-connecting-ip') ?? '';
  const cookies = parseCookies(request.headers.get('cookie'));
  const queryStringParameters = parseQuery(rawQueryString);
  const body = await readBody(request);
  const domainName = url.hostname;
  const domainPrefix = domainName.split('.', 1)[0] ?? domainName;

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString,
    ...(cookies.length > 0 ? { cookies } : {}),
    headers: toEventHeaders(request.headers, url, sourceIp),
    ...(queryStringParameters ? { queryStringParameters } : {}),
    requestContext: {
      accountId: 'anonymous',
      apiId: domainPrefix,
      domainName,
      domainPrefix,
      http: {
        method: request.method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp,
        userAgent: request.headers.get('user-agent') ?? '',
      },
      requestId: options.requestId ?? crypto.randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: formatRequestTime(now),
      timeEpoch: now.getTime(),
    },
    ...(body ? { body: body.value } : {}),
    pathParameters: undefined,
    isBase64Encoded: body?.base64 ?? false,
    stageVariables: undefined,
  };
}

function stripPathPrefix(path: string, prefix: string | undefined): string {
  const trimmed = prefix?.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return path;
  const base = `/${trimmed}`;
  if (path === base) return '/';
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

function toEventHeaders(source: Headers, url: URL, sourceIp: string): Record<string, string> {
  // Map + fromEntries keeps a "__proto__" header an ordinary key.
  const headers = new Map<string, string>();
  // Fetch already lowercases names and joins repeated headers.
  for (const [name, value] of source) {
    if (name !== 'cookie') headers.set(name, value);
  }
  // Function URLs always send these; keep the client's values when present.
  const defaults: [string, string][] = [
    ['host', url.host],
    ['x-forwarded-for', sourceIp],
    ['x-forwarded-port', url.port || (url.protocol === 'http:' ? '80' : '443')],
    ['x-forwarded-proto', url.protocol.slice(0, -1)],
  ];
  for (const [name, value] of defaults) {
    if (value && !headers.has(name)) headers.set(name, value);
  }
  return Object.fromEntries(headers);
}

function parseCookies(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0);
}

function parseQuery(rawQueryString: string): Record<string, string> | undefined {
  const params = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(rawQueryString)) {
    const previous = params.get(key);
    params.set(key, previous === undefined ? value : `${previous},${value}`);
  }
  return params.size > 0 ? Object.fromEntries(params) : undefined;
}

async function readBody(request: Request): Promise<{ value: string; base64: boolean } | undefined> {
  if (request.body === null) return undefined;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return undefined;
  if (isTextual(request.headers.get('content-type'))) {
    try {
      return { value: utf8.decode(bytes), base64: false };
    } catch {
      // Not valid UTF-8: send the bytes base64-encoded rather than corrupt them.
    }
  }
  return { value: encodeBase64(bytes), base64: true };
}

function isTextual(contentType: string | null): boolean {
  const essence = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!essence) return false;
  return (
    essence.startsWith('text/') || TEXT_TYPES.has(essence) || essence.endsWith('+json') || essence.endsWith('+xml')
  );
}

function formatRequestTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${pad(date.getUTCDate())}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
  return `${day}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}
