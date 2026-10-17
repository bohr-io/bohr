// The pictures of the projects' production sites, taken by the instance (services/screenshots.ts).
import type { ProjectSummary } from '../api';

/**
 * Where the panel loads a project's picture; null for a project without a production address. The latest deploy
 * goes in the query: a new deploy brings a new picture, which the browser's cache must not hide.
 */
export function screenshotUrl(project: Pick<ProjectSummary, 'id' | 'productionUrl' | 'lastDeploy'>): string | null {
  if (!project.productionUrl) return null;
  const version = project.lastDeploy?.createdAt;
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return `/api/projects/${encodeURIComponent(project.id)}/screenshot${query}`;
}
