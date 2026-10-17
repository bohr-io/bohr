// The signed-in user, loaded once from GET /api/me and shared by the whole app.
import { reactive, readonly } from 'vue';
import type { Router } from 'vue-router';
import { ApiError, api, type IdentityProvider, type Me } from './api';
import { resetDnsZones } from './dns-zones';
import { resetOrgs } from './orgs';

type SessionStatus = 'unknown' | 'signed-in' | 'signed-out';

const state = reactive({
  me: null as Me | null,
  status: 'unknown' as SessionStatus,
});

let pending: Promise<Me | null> | null = null;

export const session = readonly(state);

/** The current user, or null when signed out. Errors other than 401 are rethrown. */
export function loadSession(force = false): Promise<Me | null> {
  if (!force && state.status !== 'unknown') return Promise.resolve(state.me);
  pending ??= api
    .me()
    .then((me) => {
      state.me = me;
      state.status = 'signed-in';
      return me;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        state.me = null;
        state.status = 'signed-out';
        return null;
      }
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function clearSession(): void {
  state.me = null;
  state.status = 'signed-out';
  resetOrgs();
  resetDnsZones();
}

/** The account was just deleted: the sign-in page says goodbye, with what could not be removed. */
let farewell: { warnings: string[] } | null = null;

export function setFarewell(warnings: string[]): void {
  farewell = { warnings };
}

/** The farewell, once: reading it clears it. */
export function takeFarewell(): { warnings: string[] } | null {
  const message = farewell;
  farewell = null;
  return message;
}

export function isAdmin(me: { readonly role?: string } | null): boolean {
  return me?.role === 'admin';
}

export async function signOut(): Promise<void> {
  await api.logout();
  clearSession();
}

type Identities = { readonly identities: readonly Readonly<Me['identities'][number]>[] };

/** The user's account with a provider (GitHub, Telegram), or null when it is not linked. */
export function identity(me: Identities | null, provider: IdentityProvider) {
  return me?.identities.find((entry) => entry.provider === provider) ?? null;
}

/**
 * A call answered 401. Only a session that really ended sends the user to the sign-in page (keeping
 * the path to come back to); a 401 from elsewhere, such as a project runtime, is left to the page.
 */
export async function handleUnauthorized(router: Router): Promise<void> {
  let me: Me | null;
  try {
    me = await loadSession(true);
  } catch {
    return;
  }
  const current = router.currentRoute.value;
  if (me !== null || current.meta.public) return;
  await router.replace({ name: 'login', query: { redirect: current.fullPath } });
}
