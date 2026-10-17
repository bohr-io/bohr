// The organization the user is working in (the scope): the one in the URL on org pages (/orgs/:slug/...,
// /projects/new?org=), none on the personal projects (/projects), otherwise the remembered context (a project's
// page remembers its organization). null: the personal account.
import { type ComputedRef, computed } from 'vue';
import { useRoute } from 'vue-router';
import type { OrgRole } from '../api';
import { orgs } from '../orgs';

export interface CurrentOrg {
  slug: string;
  name: string;
  avatarUrl: string | null;
  /** The user's role, once the list of organizations has it. */
  role: OrgRole | null;
}

/** The context the URL sets: a slug, null for the personal account, or undefined when the URL says nothing. */
export function urlContext(route: {
  name?: unknown;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
}): string | null | undefined {
  const name = typeof route.name === 'string' ? route.name : '';
  if (name.startsWith('org') && name !== 'org-new' && typeof route.params.slug === 'string') return route.params.slug;
  if (name === 'new-project') return typeof route.query.org === 'string' && route.query.org ? route.query.org : null;
  // The personal projects are the personal scope.
  if (name === 'projects') return null;
  return undefined;
}

export function useCurrentOrg(): ComputedRef<CurrentOrg | null> {
  const route = useRoute();
  return computed(() => {
    const fromUrl = urlContext(route);
    const slug = fromUrl === undefined ? orgs.context : fromUrl;
    if (slug === null) return null;
    const known = orgs.list?.find((org) => org.slug === slug);
    if (known !== undefined) return { slug, name: known.name, avatarUrl: known.avatarUrl, role: known.role };
    // The URL's organization shows by its slug until the list has it; a remembered one counts only for members.
    return fromUrl !== undefined || orgs.list === null ? { slug, name: slug, avatarUrl: null, role: null } : null;
  });
}
