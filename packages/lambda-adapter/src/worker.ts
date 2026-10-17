import { toLambdaEvent } from './event';
import { prepareNodeHttp } from './node-http';
import { fromLambdaResult } from './result';
import type { LambdaCallback, LambdaContext, LambdaFunctionUrlEvent, LambdaHandler } from './types';

export interface LambdaWorkerOptions {
  /** Requests it rejects go to env.ASSETS, or get a 404 without that binding. Default: all go to the handler. */
  match?: (url: URL) => boolean;
  /** Removed once from the start of the path before the handler sees it, e.g. "/api". */
  stripPrefix?: string;
  /** Copy string bindings from env into process.env on the first request. Default: true. */
  populateProcessEnv?: boolean;
  /** context.functionName, also used in the ARN and log names. Default: "bohr-function". */
  functionName?: string;
  /** Budget reported by context.getRemainingTimeInMillis(); nothing enforces it. Default: 30000. */
  timeoutMs?: number;
  /**
   * "v1": CORS as bohr v1's Function URLs answered it (any https origin, credentials, every method and
   * header, max-age 600). Preflights never reach the handler, and the CORS headers it sets are replaced.
   */
  cors?: 'v1';
}

/** A Workers module object: `export default createLambdaWorker(handler)`. */
export interface LambdaWorker {
  fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response> | Response;
}

type ContextFields = Omit<LambdaContext, 'done' | 'succeed' | 'fail'>;

const INTERNAL_ERROR_BODY = JSON.stringify({ message: 'Internal Server Error' });

export function createLambdaWorker(handler: LambdaHandler, options: LambdaWorkerOptions = {}): LambdaWorker {
  if (typeof handler !== 'function') {
    throw new TypeError('createLambdaWorker: handler must be a function');
  }
  const functionName = options.functionName ?? 'bohr-function';
  const timeoutMs = options.timeoutMs ?? 30_000;
  let envCopied = options.populateProcessEnv === false;
  let logStreamName: string | undefined;

  async function invokeHandler(request: Request, url: URL): Promise<Response> {
    const requestId = crypto.randomUUID();
    const deadline = Date.now() + timeoutMs;
    logStreamName ??= createLogStreamName();
    try {
      const event = await toLambdaEvent(request, { stripPrefix: options.stripPrefix, requestId });
      const result = await invoke(handler, event, {
        functionName,
        functionVersion: '$LATEST',
        invokedFunctionArn: `arn:aws:lambda:auto:000000000000:function:${functionName}`,
        memoryLimitInMB: '128',
        awsRequestId: requestId,
        logGroupName: `/aws/lambda/${functionName}`,
        logStreamName,
        callbackWaitsForEmptyEventLoop: true,
        getRemainingTimeInMillis: () => Math.max(0, deadline - Date.now()),
      });
      return fromLambdaResult(result);
    } catch (error) {
      // Details stay in the logs; the client only gets a generic body.
      console.error(`[lambda-adapter] ${request.method} ${url.pathname} failed (request ${requestId}):`, error);
      return new Response(INTERNAL_ERROR_BODY, { status: 502, headers: { 'content-type': 'application/json' } });
    }
  }

  return {
    async fetch(request, env) {
      if (!envCopied) {
        envCopied = true;
        copyStringBindings(env);
      }
      await prepareNodeHttp();

      const url = new URL(request.url);
      if (options.match && !options.match(url)) {
        const assets = (env as { ASSETS?: unknown } | undefined)?.ASSETS;
        return isFetcher(assets) ? assets.fetch(request) : new Response('Not Found', { status: 404 });
      }

      const origin = options.cors === 'v1' ? request.headers.get('Origin') : null;
      const corsOrigin = origin?.startsWith('https://') ? origin : null;
      if (corsOrigin !== null && request.method === 'OPTIONS' && request.headers.has('Access-Control-Request-Method')) {
        return new Response(null, { status: 200, headers: preflightHeaders(corsOrigin, request) });
      }
      const response = await invokeHandler(request, url);
      return corsOrigin === null ? response : withCorsHeaders(response, corsOrigin);
    },
  };
}

// v1 Function URLs: AllowOrigins https://*, AllowCredentials, AllowMethods/Headers *, MaxAge 600. With credentials,
// browsers ignore "*", so the requested method and headers are echoed back.
function preflightHeaders(origin: string, request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': request.headers.get('Access-Control-Request-Method') ?? '*',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  });
  const requested = request.headers.get('Access-Control-Request-Headers');
  if (requested) headers.set('Access-Control-Allow-Headers', requested);
  return headers;
}

function withCorsHeaders(response: Response, origin: string): Response {
  const wrapped = new Response(response.body, response);
  for (const name of [...wrapped.headers.keys()]) {
    if (name.startsWith('access-control-')) wrapped.headers.delete(name);
  }
  wrapped.headers.set('Access-Control-Allow-Origin', origin);
  wrapped.headers.set('Access-Control-Allow-Credentials', 'true');
  wrapped.headers.append('Vary', 'Origin');
  return wrapped;
}

/**
 * Runs the handler with the Node.js runtime's completion rules: the first of the callback,
 * context.done/succeed/fail or the returned promise settles the invocation (a promise
 * settles only once), and a non-promise return value is ignored.
 */
function invoke(handler: LambdaHandler, event: LambdaFunctionUrlEvent, fields: ContextFields): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const succeed = (result?: unknown) => resolve(result);
    const fail = (error?: unknown) => reject(error ?? new Error('Lambda handler failed without an error value'));
    // Any error other than null/undefined fails the invocation, as in the Node.js runtime.
    const callback: LambdaCallback = (error, result) => {
      if (error === undefined || error === null) succeed(result);
      else fail(error);
    };
    const context: LambdaContext = { ...fields, done: callback, succeed, fail };

    try {
      const returned = handler(event, context, callback);
      if (isPromiseLike(returned)) returned.then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function copyStringBindings(env: unknown): void {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (!processEnv || typeof env !== 'object' || env === null) return;
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') processEnv[name] = value;
  }
}

// Same shape as Lambda's: 2026/10/11/[$LATEST]<32 hex chars>.
function createLogStreamName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return `${date}/[$LATEST]${crypto.randomUUID().replace(/-/g, '')}`;
}

function isFetcher(value: unknown): value is Fetcher {
  return typeof value === 'object' && value !== null && typeof (value as { fetch?: unknown }).fetch === 'function';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
