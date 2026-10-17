import { decodeBase64 } from './base64';

const JSON_TYPE = 'application/json';

// Fetch cannot attach a body to these statuses.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

// Framing and hop-by-hop headers: the runtime writes its own, as Function URLs do.
const FRAMING_HEADERS = ['connection', 'content-length', 'keep-alive', 'transfer-encoding'];

interface StructuredResult {
  statusCode: unknown;
  headers?: unknown;
  multiValueHeaders?: unknown;
  cookies?: unknown;
  body?: unknown;
  isBase64Encoded?: unknown;
}

/**
 * Converts a handler's output into a Fetch response the way Function URLs interpret it.
 * An object with a statusCode is a structured response. Any other output (a string, an
 * object without statusCode, undefined) is sent as JSON with status 200.
 * Throws on an invalid statusCode or base64 body.
 */
export function fromLambdaResult(result: unknown): Response {
  if (!isStructuredResult(result)) {
    // Strings come back JSON-quoted, as on Function URLs: "Hello" is sent as "\"Hello\"".
    return new Response(JSON.stringify(result ?? null) ?? 'null', { headers: { 'content-type': JSON_TYPE } });
  }

  const status = toStatus(result.statusCode);
  const headers = new Headers();
  for (const [name, value] of entries(result.headers)) {
    if (Array.isArray(value)) {
      headers.delete(name);
      appendAll(headers, name, value);
    } else if (value !== undefined && value !== null) {
      headers.set(name, String(value));
    }
  }
  // As in API Gateway, multiValueHeaders win over headers for the same name.
  for (const [name, values] of entries(result.multiValueHeaders)) {
    headers.delete(name);
    appendAll(headers, name, values);
  }
  appendAll(headers, 'set-cookie', result.cookies);
  for (const name of FRAMING_HEADERS) headers.delete(name);

  const body = toBody(result.body, result.isBase64Encoded === true);
  if (body === null || NULL_BODY_STATUSES.has(status)) {
    return new Response(null, { status, headers });
  }
  // Function URLs default the content type to JSON; Fetch would pick text/plain.
  if (!headers.has('content-type')) headers.set('content-type', JSON_TYPE);
  return new Response(body, { status, headers });
}

function isStructuredResult(value: unknown): value is StructuredResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { statusCode?: unknown }).statusCode != null
  );
}

function toStatus(value: unknown): number {
  const status = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  // Fetch responses only allow 200-599.
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) {
    throw new TypeError(`Invalid statusCode in Lambda result: ${String(value)}`);
  }
  return status;
}

function entries(value: unknown): [string, unknown][] {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : [];
}

function appendAll(headers: Headers, name: string, values: unknown): void {
  for (const value of Array.isArray(values) ? values : [values]) {
    if (value !== undefined && value !== null) headers.append(name, String(value));
  }
}

function toBody(body: unknown, isBase64Encoded: boolean) {
  if (body === undefined || body === null || body === '') return null;
  if (typeof body === 'string') return isBase64Encoded ? decodeBase64(body) : body;
  // Function URLs serialize non-string bodies as JSON.
  return JSON.stringify(body) ?? null;
}
