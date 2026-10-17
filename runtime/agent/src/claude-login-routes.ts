import type http from 'node:http';
import { claudeLoginCancelSchema, claudeLoginFinishSchema, RUNNER_PATHS } from '@bohr/shared';
import { ClaudeLoginError } from './claude-login';
import { allow, type Reply, readBody, readJson } from './http';

// The sign-in endpoints (RUNNER_PATHS.claudeLogin*), served by the runner in each project container and by the
// dedicated sign-in container (runtime/claude-login). The code and the token are never logged.

/** Connecting the owner's Claude subscription with `claude setup-token` (see claude-login.ts). */
export interface LoginControl {
  start(): Promise<{ loginId: string; url: string }>;
  finish(loginId: string, code: string): Promise<{ token: string }>;
  cancel(loginId: string): Promise<boolean>;
}

/** The reply of a sign-in endpoint; undefined when the path is not one of them. */
export async function claudeLoginRoute(
  request: http.IncomingMessage,
  pathname: string,
  logins: LoginControl,
  maxBodyBytes?: number,
): Promise<Reply | undefined> {
  switch (pathname) {
    case RUNNER_PATHS.claudeLoginStart:
      allow(request, 'POST');
      await readBody(request, maxBodyBytes);
      return { status: 200, body: await logins.start() };
    case RUNNER_PATHS.claudeLoginFinish: {
      allow(request, 'POST');
      const parsed = claudeLoginFinishSchema.safeParse(await readJson(request, maxBodyBytes));
      if (!parsed.success) {
        return { status: 400, body: { error: 'invalid_request', message: 'Send the loginId and the code.' } };
      }
      return { status: 200, body: await logins.finish(parsed.data.loginId, parsed.data.code) };
    }
    case RUNNER_PATHS.claudeLoginCancel: {
      allow(request, 'POST');
      const parsed = claudeLoginCancelSchema.safeParse(await readJson(request, maxBodyBytes));
      if (!parsed.success) return { status: 400, body: { error: 'invalid_request', message: 'Send the loginId.' } };
      return { status: 200, body: { cancelled: await logins.cancel(parsed.data.loginId) } };
    }
    default:
      return undefined;
  }
}

/** A sign-in's refusal (ClaudeLoginError) as its own status, error code and message. */
export function claudeLoginErrorReply(error: unknown): Reply | undefined {
  if (!(error instanceof ClaudeLoginError)) return undefined;
  return { status: error.status, body: { error: error.code, message: error.message } };
}
