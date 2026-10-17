// The project page's shared state: ProjectPage loads it once and its sub-pages (overview, agent,
// versions, builds, members, settings) read it from here.
import type { ProjectState } from '@bohr/shared';
import { type ComputedRef, type InjectionKey, inject, provide, type Ref } from 'vue';
import type { ProjectSummary } from '../api';
import type { ProjectActions } from '../chat/actions';
import type { ChatFeed } from '../chat/feed';

/**
 * loading: reading the project list. deploy-only: no runtime (migrated from v1). activating: the
 * owner's runtime is still being set up. agent: the runtime answers for itself.
 */
export type ProjectMode = 'loading' | 'deploy-only' | 'activating' | 'agent';

export interface ProjectContext {
  id: string;
  feed: ChatFeed;
  actions: ProjectActions;
  /** The instance's view of the project (GET /api/projects); null when it does not list it. */
  summary: Ref<ProjectSummary | null>;
  /** The runtime's state, once the feed loaded it. */
  state: ComputedRef<ProjectState | null>;
  mode: ComputedRef<ProjectMode>;
  isOwner: ComputedRef<boolean>;
  /** The owner can turn the agent on from the web (projects bohr hosts, or a runtime being set up). */
  canActivate: ComputedRef<boolean>;
  /** The owner can move the project out of bohr's hosting (stays on after a move, to show its result). */
  canMove: Ref<boolean>;
  productionUrl: ComputedRef<string | null>;
  previewUrl: ComputedRef<string | null>;
  /** The preview can be shown: it has an address and something to start (.bohr/preview.json). */
  previewReady: ComputedRef<boolean>;
  /** Says, in a toast, why there is no preview to show yet. */
  explainNoPreview: () => void;
  loadSummary: () => Promise<void>;
  /** Approving publishes right away; discarding asks first. */
  requestDecision: (action: 'approve' | 'discard') => void;
  /** Asks the agent to prepare the repository (the import), for the owner; errors become toasts. */
  prepareRepository: () => Promise<void>;
  /** A request to prepare the repository is on its way. */
  preparing: Ref<boolean>;
}

const KEY: InjectionKey<ProjectContext> = Symbol('project');

export function provideProject(context: ProjectContext): void {
  provide(KEY, context);
}

export function useProject(): ProjectContext {
  const context = inject(KEY);
  if (context === undefined) throw new Error('useProject() is only available inside the project page.');
  return context;
}
