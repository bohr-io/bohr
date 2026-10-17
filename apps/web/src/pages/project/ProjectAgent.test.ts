import { useToast } from '@bohr/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, type RouteRecordRaw, RouterView } from 'vue-router';
import { authGuard, reloadOnStaleChunks, routes } from '../../router';
import { loadSession } from '../../session';
import {
  chatEntry,
  conversation,
  createTestI18n,
  type FakeRoute,
  fakeApi,
  ME,
  projectState,
  projectSummary,
} from '../../test-utils';

const AGENT = '/api/projects/p1/agent';

/** The routes, with the full-screen view's code gone from the server (a deploy replaced it). */
function withStaleSiteView(records: readonly RouteRecordRaw[]): RouteRecordRaw[] {
  return records.map((record) => {
    if (record.name === 'project-site') {
      return {
        ...record,
        component: () =>
          Promise.reject(
            new TypeError(
              'Failed to fetch dynamically imported module: https://app.bohr.io/assets/ProjectOverview-0ld.js',
            ),
          ),
      } as RouteRecordRaw;
    }
    return record.children ? ({ ...record, children: withStaleSiteView(record.children) } as RouteRecordRaw) : record;
  });
}

function fakeProject(
  state = projectState({ homolog: { status: 'pending', version: 3, headSha: 'abc', changes: [] } }),
  extra: Record<string, FakeRoute> = {},
) {
  return fakeApi({
    ...extra,
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects: [projectSummary()] } },
    [`GET ${AGENT}/state`]: { body: state },
    [`GET ${AGENT}/messages`]: conversation([
      chatEntry(1, { kind: 'user', author: { key: 'u:u_1', name: 'Ana' }, text: 'Muda o título' }),
      chatEntry(2, { actions: ['approve', 'discard'], text: 'Pronto! A mudança já está na homologação.' }),
    ]).route,
  });
}

async function mountAgentPage(options: { stale?: boolean; reload?: (path: string) => void } = {}) {
  await loadSession(true);
  const { i18n } = createTestI18n();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: options.stale ? withStaleSiteView(routes) : routes,
  });
  router.beforeEach(authGuard);
  if (options.reload) reloadOnStaleChunks(router, options.reload);
  await router.push('/projects/p1/agente');
  await router.isReady();
  const Root = defineComponent({ render: () => h(RouterView) });
  const wrapper = mount(Root, { global: { plugins: [router, i18n] }, attachTo: document.body });
  await vi.waitFor(
    () => expect(wrapper.findAll('button').some((button) => button.text() === 'Ver a homologação')).toBe(true),
    { timeout: 10_000 },
  );
  const seePreview = () => wrapper.findAll('button').find((button) => button.text() === 'Ver a homologação');
  return { wrapper, router, seePreview };
}

describe('the chat’s “See the preview”', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it("opens the preview in the overview's full-screen view, with the chat beside it", async () => {
    fakeProject();
    const { wrapper, router, seePreview } = await mountAgentPage();

    await seePreview()?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('project-site'), { timeout: 10_000 });
    expect(router.currentRoute.value.query).toEqual({ deploy: 'preview', chat: '1' });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.find('.site-stage.is-full').exists()).toBe(true), { timeout: 10_000 });
    expect(wrapper.get('.site-stage iframe').attributes('src')).toBe('https://loja-preview.example.workers.dev');
    expect(wrapper.find('[data-chat-drawer] .chat').exists()).toBe(true);
    wrapper.unmount();
  });

  // What made the button "do nothing": the tab was opened before a deploy, so the page's code (a file named by
  // its hash) was gone; the navigation failed quietly and the chat stayed on screen.
  it('loads the full-screen view from the server when its code went stale with a deploy', async () => {
    fakeProject();
    const quiet = await mountAgentPage({ stale: true });
    await quiet.seePreview()?.trigger('click');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(quiet.router.currentRoute.value.name).toBe('project-agent');
    quiet.wrapper.unmount();

    fakeProject();
    const reload = vi.fn();
    const fixed = await mountAgentPage({ stale: true, reload });
    await fixed.seePreview()?.trigger('click');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith('/projects/p1/site?deploy=preview&chat=1'), {
      timeout: 10_000,
    });
    fixed.wrapper.unmount();
  });

  it('says why there is no preview yet instead of a frame that only says it is starting', async () => {
    const state = projectState({ homolog: { status: 'pending', version: 3, headSha: 'abc', changes: [] } });
    fakeProject({ ...state, project: { ...state.project, importStatus: 'running', previewState: 'not_configured' } });
    const { wrapper, router, seePreview } = await mountAgentPage();

    await seePreview()?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-agent');
    expect(useToast().toasts.map((toast) => toast.message)).toContain(
      'O agente está preparando o repositório agora. A homologação aparece quando ele terminar.',
    );
    wrapper.unmount();
  });
});
