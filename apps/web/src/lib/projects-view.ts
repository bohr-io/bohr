// The projects page's two views (cards or a list), remembered per user in this browser, and deleting several
// projects at once from the list.
import { api, type ProjectSummary } from '../api';
import { readJson, writeJson } from './storage';

export type ProjectsView = 'cards' | 'list';

const VIEW_KEY = 'bohr.projectsView';

/** The view this user chose last in this browser; cards until they choose. */
export function readProjectsView(userId: string | null | undefined): ProjectsView {
  const views = readJson<unknown>(VIEW_KEY, null);
  if (views === null || typeof views !== 'object') return 'cards';
  return (views as Record<string, unknown>)[userId ?? ''] === 'list' ? 'list' : 'cards';
}

export function writeProjectsView(userId: string | null | undefined, view: ProjectsView): void {
  const views = readJson<unknown>(VIEW_KEY, null);
  const current = views !== null && typeof views === 'object' ? (views as Record<string, unknown>) : {};
  writeJson(VIEW_KEY, { ...current, [userId ?? '']: view });
}

/** Deleting is for the project's owners (an organization's admins own its projects), as in its danger zone. */
export const canDeleteProject = (project: Pick<ProjectSummary, 'role'>) => project.role === 'owner';

export type DeleteOutcome =
  | { status: 'pending' | 'working' }
  | { status: 'deleted'; warnings: string[] }
  | { status: 'failed'; error: unknown };

/**
 * Deletes the projects one after another through DELETE /api/projects/:id (the danger zone's call, confirmed with
 * each project's name), reporting each one's outcome as it goes. A failure does not stop the others.
 * deleteSite: also the sites of the projects in their owner's Cloudflare account (byo), as in the danger zone.
 */
export async function deleteProjects(
  projects: readonly Pick<ProjectSummary, 'id' | 'name' | 'mode'>[],
  options: { deleteSite: boolean },
  report: (projectId: string, outcome: DeleteOutcome) => void,
): Promise<Map<string, DeleteOutcome>> {
  const outcomes = new Map<string, DeleteOutcome>();
  const set = (projectId: string, outcome: DeleteOutcome) => {
    outcomes.set(projectId, outcome);
    report(projectId, outcome);
  };
  for (const project of projects) set(project.id, { status: 'pending' });
  for (const project of projects) {
    set(project.id, { status: 'working' });
    try {
      const { warnings } = await api.deleteProject(project.id, {
        confirm: project.name,
        deleteSite: options.deleteSite && project.mode === 'byo',
      });
      set(project.id, { status: 'deleted', warnings });
    } catch (error) {
      set(project.id, { status: 'failed', error });
    }
  }
  return outcomes;
}
