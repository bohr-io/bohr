import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import type { GithubAppCredentials } from '../services/github-app';
import { appUrl } from './app-url';
import { safeRedirect } from './session';

// GitHub's user authorization with the App's client, shared by signing in (routes/auth.ts) and new projects from a
// template (routes/templates.ts). GitHub always comes back to /auth/github/callback, the App's registered callback.

export const STATE_COOKIE = '__Host-bohr_oauth';

/** Appends ?error=<message> (and &code=<code>) to a local path (before any #fragment). */
export function withError(path: string, message: string, code?: string) {
  const [base = '/', hash] = path.split('#');
  const query = `error=${encodeURIComponent(message)}${code === undefined ? '' : `&code=${encodeURIComponent(code)}`}`;
  const url = `${base}${base.includes('?') ? '&' : '?'}${query}`;
  return hash === undefined ? url : `${url}#${hash}`;
}

/**
 * Why GitHub's user authorization runs: signing in, linking GitHub to the signed-in account, or creating a
 * repository from a template with the user's token (routes/templates.ts), which is used once and never kept.
 */
export type AuthorizeMode = 'signin' | 'link' | 'template';

/**
 * Starts GitHub's user authorization with the App's client: the state cookie (`state|redirect|mode`) and the
 * URL to send the browser to.
 */
export async function startGithubAuthorization(
  c: Context<AppEnv>,
  app: GithubAppCredentials,
  options: { state: string; redirect: string; mode: AuthorizeMode },
): Promise<string> {
  // Redirects never contain "|" (safeRedirect)
  setCookie(c, STATE_COOKIE, `${options.state}|${safeRedirect(options.redirect)}|${options.mode}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', `${await appUrl(c)}/auth/github/callback`);
  url.searchParams.set('state', options.state);
  return url.toString();
}
