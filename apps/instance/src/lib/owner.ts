import { and, eq, isNull } from 'drizzle-orm';
import type { Project } from '../db/client';
import { cfConnections, projects, subscriptions } from '../db/schema';

/**
 * Who a resource belongs to: a person (their personal space) or an organization. Subscriptions, Cloudflare
 * connections, agent settings and projects all have one.
 */
export type Owner = { kind: 'user'; id: string } | { kind: 'org'; id: string };

export const userOwner = (id: string): Owner => ({ kind: 'user', id });
export const orgOwner = (id: string): Owner => ({ kind: 'org', id });

/** The org's, for an organization project; otherwise the person who created it. */
export const projectOwner = (project: Pick<Project, 'orgId' | 'ownerUserId'>): Owner =>
  project.orgId !== null ? orgOwner(project.orgId) : userOwner(project.ownerUserId);

/** The owner's Cloudflare connections (a user's are only the personal ones). */
export const connectionsOf = (owner: Owner) =>
  owner.kind === 'org'
    ? eq(cfConnections.orgId, owner.id)
    : and(eq(cfConnections.userId, owner.id), isNull(cfConnections.orgId));

/** The owner's subscriptions (a user's are only the personal ones). */
export const subscriptionsOf = (owner: Owner) =>
  owner.kind === 'org'
    ? eq(subscriptions.orgId, owner.id)
    : and(eq(subscriptions.userId, owner.id), isNull(subscriptions.orgId));

/** The owner's projects: a user's personal projects, or an org's. */
export const projectsOf = (owner: Owner) =>
  owner.kind === 'org' ? eq(projects.orgId, owner.id) : and(eq(projects.ownerUserId, owner.id), isNull(projects.orgId));

/** What the audit log names as the target of a change to the owner's settings. */
export const ownerTarget = (owner: Owner) => (owner.kind === 'org' ? `org:${owner.id}` : owner.id);
