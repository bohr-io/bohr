import http from 'node:http';
import { claudeLoginErrorReply, claudeLoginRoute, type LoginControl } from '@bohr/agent/claude-login-routes';
import { allow, HttpError, type Reply, send } from '@bohr/agent/http';
import { type Logger, silentLogger } from '@bohr/agent/log';
import { errorMessage } from '@bohr/agent/text';
import { RUNNER_PATHS } from '@bohr/shared';

// The sign-in container's only server: the runner's sign-in endpoints (RUNNER_PATHS.claudeLogin*, the same code
// as in every project container) and a health check, on AGENT_PORT. Nothing else listens in the container.

export interface LoginServerOptions {
  version: string;
  /** The sign-in manager (ClaudeLogin): one `claude setup-token` at a time. */
  logins: LoginControl & { readonly running: boolean };
  log?: Logger;
  maxBodyBytes?: number;
}

/** What `GET /health` answers: the instance waits for it after starting the container. */
export interface LoginHealth {
  ok: true;
  version: string;
  /** A sign-in is waiting for its code. */
  busy: boolean;
}

export function createLoginServer(options: LoginServerOptions): http.Server {
  const log = options.log ?? silentLogger;
  return http.createServer((request, response) => {
    route(request, options)
      .then(({ status, body }) => send(response, status, body))
      .catch((error: unknown) => {
        if (error instanceof HttpError) {
          send(response, error.status, error.body, error.headers);
          return;
        }
        // The sign-in's refusals keep their statuses; the code and the token are never logged
        const refused = claudeLoginErrorReply(error);
        if (refused !== undefined) {
          send(response, refused.status, refused.body);
          return;
        }
        log.error('request failed', { method: request.method, path: request.url, error: errorMessage(error) });
        send(response, 500, { error: 'internal_error', message: errorMessage(error) });
      });
  });
}

async function route(request: http.IncomingMessage, options: LoginServerOptions): Promise<Reply> {
  const url = new URL(request.url ?? '/', 'http://claude-login');
  if (url.pathname === RUNNER_PATHS.health) {
    allow(request, 'GET');
    const health: LoginHealth = { ok: true, version: options.version, busy: options.logins.running };
    return { status: 200, body: health };
  }
  const login = await claudeLoginRoute(request, url.pathname, options.logins, options.maxBodyBytes);
  return login ?? { status: 404, body: { error: 'not_found' } };
}
