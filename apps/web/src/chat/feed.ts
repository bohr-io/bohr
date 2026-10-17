// The project conversation: the newest page of entries first, then only what comes after the highest
// seq we have (GET /messages?after=<seq>), together with the project state (current request, queue,
// preview version). Polls every 2 s while the page is visible or a request runs, every 10 s otherwise.
import type { ChatEntry, ProjectState } from '@bohr/shared';
import { onBeforeUnmount, onMounted, reactive } from 'vue';
import { type AgentApi, ApiError, agentApi, type Submitted } from '../api';
import { createPoller } from '../lib/poller';
import { isBusy } from './decisions';

export const PAGE_SIZE = 100;
export const FAST_POLL_MS = 2_000;
export const SLOW_POLL_MS = 10_000;
/** While nothing runs, the state is refreshed when new entries arrive and on every Nth poll. */
export const STATE_EVERY = 5;
const MAX_BACKOFF_MS = 30_000;

export type FeedStatus = 'loading' | 'ready' | 'not_member' | 'not_ready' | 'not_found' | 'error';

export interface ChatFeedState {
  status: FeedStatus;
  project: ProjectState | null;
  /** Ordered by seq. */
  entries: ChatEntry[];
  hasOlder: boolean;
  loadingOlder: boolean;
  /** Why the feed is not ready; while ready, the last failed poll (connection trouble). */
  error: ApiError | null;
}

export interface ChatFeedOptions {
  api?: AgentApi;
  pageSize?: number;
  /** Hidden pages poll slowly unless a request runs. */
  isVisible?: () => boolean;
}

const pageIsVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function createChatFeed(projectId: string, options: ChatFeedOptions = {}) {
  const client = options.api ?? agentApi(projectId);
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const isVisible = options.isVisible ?? pageIsVisible;

  const state = reactive<ChatFeedState>({
    status: 'loading',
    project: null,
    entries: [],
    hasOlder: false,
    loadingOlder: false,
    error: null,
  });

  /** Highest seq we have; the next poll asks for what came after it. */
  let lastSeq = 0;
  let pollsSinceState = 0;
  let failures = 0;

  /** Adds entries we did not have, keeping seq order. Returns how many were new. */
  function merge(incoming: readonly ChatEntry[]): number {
    const known = new Set(state.entries.map((entry) => entry.seq));
    const fresh = incoming.filter((entry) => !known.has(entry.seq));
    if (fresh.length === 0) return 0;
    state.entries = [...state.entries, ...fresh].sort((a, b) => a.seq - b.seq);
    for (const entry of fresh) lastSeq = Math.max(lastSeq, entry.seq);
    return fresh.length;
  }

  async function fetchNewer(): Promise<number> {
    let added = 0;
    for (;;) {
      const before = lastSeq;
      const page = await client.messages(lastSeq, pageSize);
      added += merge(page.messages);
      // A full page may have more behind it.
      if (page.messages.length < pageSize || lastSeq >= page.last || lastSeq === before) return added;
    }
  }

  async function refreshState(): Promise<void> {
    pollsSinceState = 0;
    state.project = await client.state();
  }

  function fail(error: unknown): void {
    const apiError = error instanceof ApiError ? error : new ApiError(0, 'unexpected', String(error));
    state.error = apiError;
    failures += 1;
    if (apiError.status === 403 && apiError.code === 'not_a_member') {
      state.status = 'not_member';
      poller.stop();
    } else if (apiError.status === 404) {
      state.status = 'not_found';
      poller.stop();
    } else if (apiError.status === 409) {
      // The instance answers 409 while the project runtime is being set up; keep checking slowly.
      state.status = 'not_ready';
    } else if (state.status !== 'ready') {
      state.status = 'error';
    }
  }

  async function load(): Promise<void> {
    try {
      const [project, head] = await Promise.all([client.state(), client.messages(0, 1)]);
      state.project = project;
      // Only the newest page; older entries load on demand.
      const start = Math.max(0, head.last - pageSize);
      state.entries = [];
      lastSeq = start;
      state.hasOlder = start > 0;
      if (head.last > start) await fetchNewer();
      state.status = 'ready';
      state.error = null;
      failures = 0;
    } catch (error) {
      fail(error);
    }
  }

  async function poll(): Promise<void> {
    if (state.status !== 'ready') return load();
    try {
      const busy = isBusy(state.project);
      pollsSinceState += 1;
      const [added] = await Promise.all([fetchNewer(), busy ? refreshState() : undefined]);
      if (!busy && (added > 0 || pollsSinceState >= STATE_EVERY)) await refreshState();
      state.error = null;
      failures = 0;
    } catch (error) {
      fail(error);
    }
  }

  function delay(): number {
    if (state.status === 'not_ready') return SLOW_POLL_MS;
    const base = isBusy(state.project) || isVisible() ? FAST_POLL_MS : SLOW_POLL_MS;
    return failures === 0 ? base : Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 4));
  }

  const poller = createPoller(poll, delay);

  /** Polls now, including the project state. */
  function refresh(): Promise<void> {
    pollsSinceState = STATE_EVERY;
    return poller.trigger();
  }

  async function loadOlder(): Promise<void> {
    const first = state.entries[0]?.seq;
    if (first === undefined || state.loadingOlder) return;
    state.loadingOlder = true;
    try {
      const after = Math.max(0, first - 1 - pageSize);
      const page = await client.messages(after, pageSize);
      merge(page.messages.filter((entry) => entry.seq < first));
      state.hasOlder = after > 0;
    } finally {
      state.loadingOlder = false;
    }
  }

  async function send(text: string): Promise<Submitted> {
    const result = await client.send(text);
    await refresh();
    return result;
  }

  /** Approves or discards the preview version in the current state, the one the member is looking at. */
  async function decide(action: 'approve' | 'discard'): Promise<string> {
    const version = state.project?.homolog.version;
    if (version === undefined) throw new ApiError(0, 'not_loaded', 'The project is not loaded yet.');
    const { message } = await client.decide(action, version);
    await refresh();
    return message;
  }

  async function answer(entry: ChatEntry, option: number): Promise<Submitted> {
    if (entry.requestId === null) throw new ApiError(0, 'not_a_question', 'This entry asks nothing.');
    const result = await client.answer(entry.requestId, option);
    await refresh();
    return result;
  }

  async function cancel(requestId: string): Promise<string> {
    const { message } = await client.cancel(requestId);
    await refresh();
    return message;
  }

  return {
    state,
    api: client,
    start: () => poller.start(),
    stop: () => poller.stop(),
    /** Starts over, e.g. after joining the project. */
    restart() {
      poller.stop();
      state.status = 'loading';
      state.error = null;
      poller.start();
    },
    /** Back on screen: poll now. Hidden: slow down. Nothing happens while the feed is stopped. */
    visibilityChanged() {
      if (!poller.active) return;
      if (isVisible()) void poller.trigger();
      else poller.reschedule();
    },
    refresh,
    loadOlder,
    send,
    decide,
    answer,
    cancel,
  };
}

export type ChatFeed = ReturnType<typeof createChatFeed>;

/** createChatFeed tied to the component: polls while mounted and follows the page's visibility. */
export function useChatFeed(projectId: string, options?: ChatFeedOptions): ChatFeed {
  const feed = createChatFeed(projectId, options);
  const onVisibility = () => feed.visibilityChanged();
  onMounted(() => {
    feed.start();
    document.addEventListener('visibilitychange', onVisibility);
  });
  onBeforeUnmount(() => {
    feed.stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });
  return feed;
}
