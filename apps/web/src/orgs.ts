// The user's organizations and the current context (the personal account or one organization), shared by the
// main bar's switcher, the projects list and the new project page. The context of org pages is in their URL
// (/orgs/:slug/...); the last one chosen is remembered in this browser for the projects list.
import { reactive, readonly } from 'vue';
import { api, type OrgSummary } from './api';
import { readJson, writeJson } from './lib/storage';

const CONTEXT_KEY = 'bohr.context';

const state = reactive({
  /** null until loaded; an instance without organizations (or that did not answer) leaves it empty. */
  list: null as OrgSummary[] | null,
  /** The organization's slug, or null for the personal account. */
  context: readContext(),
  /** The last load failed: the list may be incomplete, so the remembered context is kept. */
  failed: false,
});

let pending: Promise<OrgSummary[]> | null = null;

export const orgs = readonly(state);

function readContext(): string | null {
  const value = readJson<unknown>(CONTEXT_KEY, null);
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The user's organizations, loaded once (force reloads them). A failure counts as none. */
export function loadOrgs(force = false): Promise<OrgSummary[]> {
  if (!force && state.list !== null) return Promise.resolve(state.list);
  pending ??= api
    .orgs()
    .then(({ orgs: list }) => {
      state.failed = false;
      return list;
    })
    .catch(() => {
      state.failed = true;
      return [] as OrgSummary[];
    })
    .then((list) => {
      state.list = [...list].sort((a, b) => a.name.localeCompare(b.name));
      return state.list;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Remembers the context: an organization's slug, or null for the personal account. */
export function setContext(slug: string | null): void {
  state.context = slug;
  writeJson(CONTEXT_KEY, slug);
}

/** The remembered organization, when the user is still one of its members; null otherwise (and it is forgotten). */
export async function contextOrg(): Promise<OrgSummary | null> {
  const slug = state.context;
  if (slug === null) return null;
  const list = await loadOrgs();
  const org = list.find((candidate) => candidate.slug === slug) ?? null;
  if (org === null && !state.failed) setContext(null);
  return org;
}

/** Signed out or another account: nothing of the previous one stays. */
export function resetOrgs(): void {
  state.list = null;
}
