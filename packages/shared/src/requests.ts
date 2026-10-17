// A request is one thing a member asked for. The project runs one at a time, in order.
// The preview ("homolog") accumulates the changes of finished requests until a member
// approves them (they go to production) or discards them.

export const REQUEST_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs_input'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'needs_input'],
  succeeded: [],
  failed: [],
  cancelled: [],
  // The answer becomes a new request that resumes the same agent session.
  needs_input: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function isFinalRequestStatus(status: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[status].length === 0;
}

export const HOMOLOG_STATUSES = ['clean', 'pending', 'publishing'] as const;
/**
 * clean: the work branch equals production.
 * pending: it has changes nobody approved yet; the preview shows them.
 * publishing: a member approved; the pull request is being merged.
 */
export type HomologStatus = (typeof HOMOLOG_STATUSES)[number];

export type HomologEvent =
  | { type: 'changes_pushed' }
  | { type: 'approved' }
  | { type: 'merged' }
  | { type: 'merge_failed' }
  | { type: 'discarded' };

/** Next preview status, or null when the event does not apply in this status. */
export function nextHomologStatus(status: HomologStatus, event: HomologEvent): HomologStatus | null {
  switch (event.type) {
    case 'changes_pushed':
      // A request may finish while an approval is merging; its commits wait for the next approval.
      return status === 'publishing' ? 'publishing' : 'pending';
    case 'approved':
      return status === 'pending' ? 'publishing' : null;
    case 'merged':
      return status === 'publishing' ? 'clean' : null;
    case 'merge_failed':
      return status === 'publishing' ? 'pending' : null;
    case 'discarded':
      return status === 'pending' ? 'clean' : null;
  }
}

export const RELEASE_STATUSES = ['deploying', 'live', 'failed', 'rolled_back'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
