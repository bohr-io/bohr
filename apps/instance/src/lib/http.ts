import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Errors the API reports to its caller as { error, ...details } with this status
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Not signed in.') => new HttpError(401, message);
export const forbidden = (message = 'Not allowed.') => new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string, details?: Record<string, unknown>) => new HttpError(409, message, details);

/**
 * Runs a task after the response, for as long as the Worker may (waitUntil). The task logs its own failure; without
 * an execution context (the tests' app.request) it just runs unawaited.
 */
export function inBackground(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  task: Promise<unknown>,
): void {
  const settled = task.catch((error: unknown) => console.error('[background]', error));
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    // No ExecutionContext: Hono throws when the request came without one
  }
}
