import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEntry, conversation, fakeApi, projectState } from '../test-utils';
import { createChatFeed, FAST_POLL_MS, SLOW_POLL_MS } from './feed';

const STATE = 'GET /api/projects/p1/agent/state';
const MESSAGES = 'GET /api/projects/p1/agent/messages';

/** Lets pending fetches and the poller's promise chain settle (fake timers do not run microtasks). */
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

const afterParams = (calls: { query: URLSearchParams }[]) => calls.map((call) => Number(call.query.get('after')));

describe('chat feed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the conversation, then asks only for what came after the highest seq', async () => {
    const chat = conversation([chatEntry(1), chatEntry(2), chatEntry(3)]);
    const api = fakeApi({ [STATE]: { body: projectState() }, [MESSAGES]: chat.route });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();

    expect(feed.state.status).toBe('ready');
    expect(feed.state.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(feed.state.hasOlder).toBe(false);

    chat.add(chatEntry(4, { kind: 'user', text: 'Troca a cor do botão' }));
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();

    expect(feed.state.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    // The head request (after=0&limit=1), the first page, then only what is new.
    expect(afterParams(api.callsTo(MESSAGES))).toEqual([0, 0, 3]);

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();
    expect(afterParams(api.callsTo(MESSAGES)).at(-1)).toBe(4);
    feed.stop();
  });

  it('starts from the newest page and loads older entries on demand', async () => {
    const chat = conversation(Array.from({ length: 250 }, (_, index) => chatEntry(index + 1)));
    fakeApi({ [STATE]: { body: projectState() }, [MESSAGES]: chat.route });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();

    expect(feed.state.entries).toHaveLength(100);
    expect(feed.state.entries[0]?.seq).toBe(151);
    expect(feed.state.hasOlder).toBe(true);

    await feed.loadOlder();
    expect(feed.state.entries[0]?.seq).toBe(51);
    expect(feed.state.entries).toHaveLength(200);
    expect(feed.state.hasOlder).toBe(true);

    await feed.loadOlder();
    expect(feed.state.entries[0]?.seq).toBe(1);
    expect(feed.state.entries.at(-1)?.seq).toBe(250);
    expect(feed.state.hasOlder).toBe(false);
    feed.stop();
  });

  it('pages through a burst of new entries in one poll', async () => {
    const chat = conversation([chatEntry(1)]);
    const api = fakeApi({ [STATE]: { body: projectState() }, [MESSAGES]: chat.route });
    const feed = createChatFeed('p1', { isVisible: () => true, pageSize: 10 });

    feed.start();
    await settle();
    for (let seq = 2; seq <= 26; seq++) chat.add(chatEntry(seq));
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();

    expect(feed.state.entries).toHaveLength(26);
    expect(afterParams(api.callsTo(MESSAGES)).slice(-3)).toEqual([1, 11, 21]);
    feed.stop();
  });

  it('polls every 2 s while visible or while a request runs, every 10 s otherwise', async () => {
    let visible = false;
    let state = projectState();
    const chat = conversation([chatEntry(1)]);
    const api = fakeApi({ [STATE]: () => ({ body: state }), [MESSAGES]: chat.route });
    const feed = createChatFeed('p1', { isVisible: () => visible });

    feed.start();
    await settle();
    const polls = () => api.callsTo(MESSAGES).length;
    const afterLoad = polls();

    // Hidden and idle: nothing at 2 s, one poll at 10 s.
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    expect(polls()).toBe(afterLoad);
    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS - FAST_POLL_MS);
    await settle();
    expect(polls()).toBe(afterLoad + 1);

    // A request starts (seen in the state): fast even while hidden.
    state = projectState({
      current: {
        id: 'req_1',
        status: 'running',
        text: 'Muda o rodapé',
        author: { key: 'u:u_1', name: 'Ana' },
        source: 'web',
        createdAt: '2026-10-11T12:00:00.000Z',
        startedAt: '2026-10-11T12:00:01.000Z',
        finishedAt: null,
        summary: null,
        costUsd: null,
        progress: 'Editando o rodapé',
      },
    });
    chat.add(chatEntry(2, { kind: 'user' }));
    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS);
    await settle();
    expect(feed.state.project?.current?.progress).toBe('Editando o rodapé');
    const busy = polls();
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();
    expect(polls()).toBe(busy + 1);

    // Idle again but visible: still fast.
    state = projectState();
    visible = true;
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();
    const visibleIdle = polls();
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();
    expect(polls()).toBe(visibleIdle + 1);
    feed.stop();
  });

  it('decides on the preview version of the current state', async () => {
    const api = fakeApi({
      [STATE]: { body: projectState({ homolog: { status: 'pending', version: 7, headSha: 'abc', changes: [] } }) },
      [MESSAGES]: conversation([chatEntry(1, { actions: ['approve', 'discard'] })]).route,
      'POST /api/projects/p1/agent/decisions': { body: { message: 'Ana aprovou.' } },
    });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();
    const message = await feed.decide('approve');

    expect(message).toBe('Ana aprovou.');
    expect(api.callsTo('POST /api/projects/p1/agent/decisions')[0]?.body).toEqual({ action: 'approve', version: 7 });
    feed.stop();
  });

  it('stops polling when the user is not a member', async () => {
    const api = fakeApi({
      [STATE]: { status: 403, body: { error: 'not_a_member' } },
      [MESSAGES]: { status: 403, body: { error: 'not_a_member' } },
    });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();
    const calls = api.calls.length;
    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS * 3);

    expect(feed.state.status).toBe('not_member');
    expect(api.calls.length).toBe(calls);

    // Coming back to the tab does not wake a stopped feed.
    feed.visibilityChanged();
    await settle();
    expect(api.calls.length).toBe(calls);
  });

  it('polls right away when the page comes back into view', async () => {
    let visible = false;
    const api = fakeApi({ [STATE]: { body: projectState() }, [MESSAGES]: conversation([chatEntry(1)]).route });
    const feed = createChatFeed('p1', { isVisible: () => visible });

    feed.start();
    await settle();
    const polls = api.callsTo(MESSAGES).length;
    visible = true;
    feed.visibilityChanged();
    await settle();

    expect(api.callsTo(MESSAGES).length).toBe(polls + 1);
    feed.stop();
  });

  it('waits for a runtime that is still being set up', async () => {
    const chat = conversation([chatEntry(1)]);
    const notReady = { status: 409, body: { error: 'The project is still being set up.' } };
    fakeApi({
      [STATE]: [notReady, { body: projectState() }],
      [MESSAGES]: [notReady, chat.route],
    });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();
    expect(feed.state.status).toBe('not_ready');

    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS);
    await settle();
    expect(feed.state.status).toBe('ready');
    expect(feed.state.entries).toHaveLength(1);
    feed.stop();
  });

  it('keeps the conversation and retries when a poll fails', async () => {
    const chat = conversation([chatEntry(1)]);
    let down = false;
    fakeApi({
      [STATE]: { body: projectState() },
      [MESSAGES]: (call) => (down ? { status: 502, body: { error: 'Bad gateway.' } } : chat.route(call)),
    });
    const feed = createChatFeed('p1', { isVisible: () => true });

    feed.start();
    await settle();
    down = true;
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    await settle();

    expect(feed.state.status).toBe('ready');
    expect(feed.state.error?.status).toBe(502);
    expect(feed.state.entries).toHaveLength(1);

    down = false;
    chat.add(chatEntry(2));
    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS);
    await settle();
    expect(feed.state.error).toBeNull();
    expect(feed.state.entries).toHaveLength(2);
    feed.stop();
  });
});
