import type http from 'node:http';

// The small JSON-over-HTTP helpers of the runner's control server, shared with the dedicated sign-in server
// (runtime/claude-login).

export interface Reply {
  status: number;
  body: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(String(body.error));
  }
}

export function allow(request: http.IncomingMessage, method: 'GET' | 'POST'): void {
  if (request.method !== method) throw new HttpError(405, { error: 'method_not_allowed' }, { allow: method });
}

export async function readJson(request: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const body = await readBody(request, maxBytes);
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, { error: 'invalid_json' });
  }
}

export async function readBody(request: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Reads to the end even when the body is too large: leaving the loop early would destroy the socket
  // before the 413 could be sent.
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size <= maxBytes) chunks.push(buffer);
  }
  if (size > maxBytes) throw new HttpError(413, { error: 'body_too_large', maxBytes });
  return Buffer.concat(chunks).toString('utf8');
}

export function send(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(payload);
}
