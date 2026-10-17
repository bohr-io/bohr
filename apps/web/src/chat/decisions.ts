// Which buttons of the conversation still work. The runtime clears an entry's actions once they are
// used, but the web chat only fetches new entries (after=<seq>), so it decides from the newest entries
// and the project state instead of trusting old copies.
import type { ChatEntry, ProjectState } from '@bohr/shared';

const isDecision = (entry: ChatEntry) => entry.actions.includes('approve') || entry.actions.includes('discard');

/** The entry whose approve/discard buttons are live: the newest one, while the preview has changes to review. */
export function activeDecisionSeq(entries: readonly ChatEntry[], project: ProjectState | null): number | null {
  if (project?.homolog.status !== 'pending') return null;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry !== undefined && isDecision(entry)) return entry.seq;
  }
  return null;
}

/** GitHub's diff of exactly what approving publishes: production against the preview's pinned commit. */
export function previewDiffUrl(project: ProjectState | null): string | null {
  const head = project?.homolog.headSha;
  if (project === null || head === null || head === undefined) return null;
  const { repository, productionBranch } = project.project;
  return `https://github.com/${repository}/compare/${encodeURIComponent(productionBranch).replaceAll('%2F', '/')}...${head}`;
}

/** The question the agent is waiting on: the newest entry with options, unless a member wrote after it. */
export function activeQuestionSeq(entries: readonly ChatEntry[]): number | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind === 'user') return null;
    if (entry.actions.includes('answer') && entry.options.length > 0 && entry.requestId !== null) return entry.seq;
  }
  return null;
}

/** A request can be cancelled while it runs or waits, by its author or the owner. */
export function canCancel(project: ProjectState | null, requestId: string | null): boolean {
  if (project === null || requestId === null) return false;
  const request = [project.current, ...project.queue].find((candidate) => candidate?.id === requestId);
  if (request === undefined || request === null) return false;
  return project.you.role === 'owner' || request.author.key === project.you.key;
}

/** Something is going on, so the chat polls fast even when the page is hidden. */
export function isBusy(project: ProjectState | null): boolean {
  if (project === null) return false;
  return project.current !== null || project.queue.length > 0 || project.homolog.status === 'publishing';
}
