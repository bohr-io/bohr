import { and, eq } from 'drizzle-orm';
import type { Db, Project } from '../db/client';
import { orgMembers, projectMembers, projects } from '../db/schema';
import type { User } from '../env';
import { forbidden, notFound } from './http';

export type ProjectAccess = {
  project: Project;
  role: 'owner' | 'member';
  /** admin: the owner-level access comes from the user's admin role, not from a membership. */
  access: 'member' | 'admin';
};

/**
 * A user's role in a project, or null: project members by their role; for an organization's project, also
 * the org's active members (admins are owners, members are members). The higher role wins.
 */
export async function projectRole(
  db: Db,
  project: Pick<Project, 'id' | 'orgId'>,
  userId: string,
): Promise<'owner' | 'member' | null> {
  const [member, orgMember] = await Promise.all([
    db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)))
      .get(),
    project.orgId === null
      ? undefined
      : db
          .select({ role: orgMembers.role })
          .from(orgMembers)
          .where(
            and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, userId), eq(orgMembers.status, 'active')),
          )
          .get(),
  ]);
  if (member?.role === 'owner' || orgMember?.role === 'admin') return 'owner';
  return member !== undefined || orgMember !== undefined ? 'member' : null;
}

/**
 * What a signed-in user may do with a project: members by their role (org admins own the org's projects);
 * admins get owner-level access to every project. Projects the user cannot see are "not found".
 */
export async function projectAccess(
  db: Db,
  projectId: string,
  user: Pick<User, 'id' | 'role'>,
  required?: 'owner',
): Promise<ProjectAccess> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (project === undefined) throw notFound('Project not found.');
  const role = await projectRole(db, project, user.id);
  if (role === 'owner') return { project, role: 'owner', access: 'member' };
  if (user.role === 'admin') return { project, role: 'owner', access: 'admin' };
  if (role === null) throw notFound('Project not found.');
  if (required === 'owner') throw forbidden('Only the project owner can do this.');
  return { project, role, access: 'member' };
}

/** Who to record in the audit log: changes made through the admin role say so. */
export function auditActor(user: Pick<User, 'id'>, access: ProjectAccess['access']) {
  return { actor: access === 'admin' ? `admin:${user.id}` : `user:${user.id}`, actorUserId: user.id };
}
