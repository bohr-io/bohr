import { isRecord } from './encoding';

/** A non-2xx REST response, or a GraphQL response carrying `errors`. `body` is the parsed response body. */
export class GithubError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly documentationUrl?: string;

  constructor(status: number, body: unknown) {
    super(`GitHub ${status}: ${describeBody(body)}`);
    this.name = 'GithubError';
    this.status = status;
    this.body = body;
    if (isRecord(body) && typeof body.documentation_url === 'string') this.documentationUrl = body.documentation_url;
  }
}

// GitHub puts the useful part of a 422 in `errors` ("Validation Failed" alone says little); GraphQL only has `errors`
function describeBody(body: unknown): string {
  if (typeof body === 'string') return body.replace(/\s+/g, ' ').trim().slice(0, 200) || 'empty response';
  if (!isRecord(body)) return 'empty response';
  const message = typeof body.message === 'string' ? body.message : undefined;
  const details = Array.isArray(body.errors) ? body.errors.map(describeDetail).filter((detail) => detail !== '') : [];
  if (message !== undefined && details.length > 0) return `${message} (${details.join('; ')})`;
  return message ?? (details.length > 0 ? details.join('; ') : 'no details');
}

function describeDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!isRecord(error)) return '';
  if (typeof error.message === 'string') return error.message;
  return [error.resource, error.field, error.code].filter((part) => typeof part === 'string').join(' ');
}
