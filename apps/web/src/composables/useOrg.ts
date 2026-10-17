// The organization page's shared state: OrgPage loads the organization once and its sub-pages (projects,
// members, settings) read it from here.
import { type ComputedRef, type InjectionKey, inject, provide, type Ref } from 'vue';
import type { OrgDetail } from '../api';

export interface OrgContext {
  slug: string;
  /** GET /api/orgs/:slug, once loaded. */
  detail: Ref<OrgDetail | null>;
  /** The user is an admin of the organization: they set it up and manage its members. */
  isAdmin: ComputedRef<boolean>;
  /** Reads the organization again (after a change to its setup). */
  reload: () => Promise<void>;
}

const KEY: InjectionKey<OrgContext> = Symbol('org');

export function provideOrg(context: OrgContext): void {
  provide(KEY, context);
}

export function useOrg(): OrgContext {
  const context = inject(KEY);
  if (context === undefined) throw new Error('useOrg() is only available inside the organization page.');
  return context;
}
