import { useToast } from '@bohr/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onBeforeUnmount, onMounted } from 'vue';
import { useProjectActions } from '../../chat/actions';
import { createChatFeed } from '../../chat/feed';
import { chatEntry, conversation, createTestI18n, fakeApi, projectState } from '../../test-utils';
import ChatPanel from './ChatPanel.vue';

const STATE = 'GET /api/projects/p1/agent/state';
const MESSAGES = 'GET /api/projects/p1/agent/messages';

/** The chat as the project page wires it: a feed for project p1, its actions, approve without confirmation. */
const Harness = defineComponent({
  setup() {
    const feed = createChatFeed('p1', { isVisible: () => true });
    const actions = useProjectActions(feed);
    onMounted(() => feed.start());
    onBeforeUnmount(() => feed.stop());
    return () =>
      feed.state.project === null
        ? null
        : h(ChatPanel, {
            feed,
            project: feed.state.project,
            actions,
            onDecide: (action: 'approve' | 'discard') => actions.decide(action),
          });
  },
});

async function mountChat() {
  const { i18n, missing } = createTestI18n();
  const wrapper = mount(Harness, { global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, missing };
}

const pending = (version: number) => ({ status: 'pending' as const, version, headSha: 'abc', changes: [] });

describe('ChatPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('renders each kind of entry', async () => {
    const chat = conversation([
      chatEntry(1, { kind: 'user', author: { key: 'u:u_1', name: 'Ana' }, text: 'Troca a cor do botão' }),
      chatEntry(2, { kind: 'progress', text: 'Editando src/App.vue' }),
      chatEntry(3, { kind: 'agent', text: 'Pronto! Homologação: https://loja-preview.example.workers.dev' }),
      chatEntry(4, { kind: 'user', author: { key: 'u:u_2', name: 'Bia' }, text: 'Ficou ótimo' }),
      chatEntry(5, { kind: 'system', text: 'Ana aprovou.' }),
    ]);
    fakeApi({ [STATE]: { body: projectState() }, [MESSAGES]: chat.route });

    const { wrapper, missing } = await mountChat();
    const items = wrapper.findAll('.entry');

    expect(
      items.map((item) => item.classes().find((name) => /^entry--(user|agent|progress|system)$/.test(name))),
    ).toEqual(['entry--user', 'entry--progress', 'entry--agent', 'entry--user', 'entry--system']);
    expect(items[0]?.get('.entry__author').text()).toBe('Você');
    expect(items[3]?.get('.entry__author').text()).toBe('Bia');
    expect(items[2]?.get('a').attributes()).toMatchObject({
      href: 'https://loja-preview.example.workers.dev',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('shows the decision card on the newest preview and approves the version in the state', async () => {
    const chat = conversation([
      chatEntry(1, { actions: ['approve', 'discard'], text: 'Versão antiga' }),
      chatEntry(2, { kind: 'user', author: { key: 'u:u_1', name: 'Ana' } }),
      chatEntry(3, { actions: ['approve', 'discard'], text: 'Pronto! Veja a homologação.' }),
    ]);
    const api = fakeApi({
      [STATE]: { body: projectState({ homolog: pending(7) }) },
      [MESSAGES]: chat.route,
      'POST /api/projects/p1/agent/decisions': { body: { message: 'Ana aprovou. Publicando…' } },
    });

    const { wrapper } = await mountChat();
    const [old, , latest] = wrapper.findAll('.entry');

    expect(old?.find('button').exists()).toBe(false);
    expect(old?.text()).toContain('Esta homologação já foi decidida ou substituída.');
    expect(latest?.classes()).toContain('is-active');
    expect(latest?.text()).toContain('versão 7');

    const approve = latest?.findAll('button').find((button) => button.text() === 'Aprovar e publicar');
    await approve?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/projects/p1/agent/decisions').map((call) => call.body)).toEqual([
      { action: 'approve', version: 7 },
    ]);
    expect(useToast().toasts.map((toast) => toast.message)).toContain('Ana aprovou. Publicando…');
    wrapper.unmount();
  });

  it('has no decision buttons when the preview equals production', async () => {
    fakeApi({
      [STATE]: { body: projectState() },
      [MESSAGES]: conversation([chatEntry(1, { actions: ['approve', 'discard'] })]).route,
    });

    const { wrapper } = await mountChat();

    expect(wrapper.findAll('button').some((button) => button.text() === 'Aprovar e publicar')).toBe(false);
    wrapper.unmount();
  });

  it('answers a question with the chosen option', async () => {
    const api = fakeApi({
      [STATE]: { body: projectState() },
      [MESSAGES]: conversation([
        chatEntry(1, { requestId: 'req_9', actions: ['answer'], options: ['Azul', 'Verde'], text: 'Qual cor?' }),
      ]).route,
      'POST /api/projects/p1/agent/answers': { body: { requestId: 'req_10', message: 'Anotado.' } },
    });

    const { wrapper } = await mountChat();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Verde')
      ?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/projects/p1/agent/answers')[0]?.body).toEqual({ requestId: 'req_9', option: 1 });
    wrapper.unmount();
  });

  it('shows the running request and the queue', async () => {
    const request = {
      id: 'req_1',
      status: 'running' as const,
      text: 'Muda o rodapé',
      author: { key: 'u:u_1', name: 'Ana' },
      source: 'web' as const,
      createdAt: '2026-10-11T12:00:00.000Z',
      startedAt: '2026-10-11T12:00:01.000Z',
      finishedAt: null,
      summary: null,
      costUsd: null,
      progress: 'Rodando npm run build',
    };
    const api = fakeApi({
      [STATE]: { body: projectState({ current: request, queue: [{ ...request, id: 'req_2', status: 'queued' }] }) },
      [MESSAGES]: conversation([chatEntry(1, { kind: 'user' })]).route,
      'POST /api/projects/p1/agent/requests/req_1/cancel': { body: { message: 'Pedido cancelado.' } },
    });

    const { wrapper } = await mountChat();
    const working = wrapper.get('.chat__working');

    expect(working.text()).toContain('Rodando npm run build');
    expect(wrapper.get('.chat__status').text()).toContain('Pedidos na fila: 1');

    await working.get('button').trigger('click');
    await flushPromises();
    expect(api.callsTo('POST /api/projects/p1/agent/requests/req_1/cancel')).toHaveLength(1);
    wrapper.unmount();
  });

  it('sends with Enter and breaks the line with Shift+Enter', async () => {
    const chat = conversation([]);
    const api = fakeApi({
      [STATE]: { body: projectState() },
      [MESSAGES]: chat.route,
      'POST /api/projects/p1/agent/messages': (call) => {
        chat.add(chatEntry(1, { kind: 'user', text: String((call.body as { text: string }).text) }));
        return { body: { requestId: 'req_1', message: 'Trabalhando…' } };
      },
    });

    const { wrapper } = await mountChat();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('Troca o título');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(api.callsTo('POST /api/projects/p1/agent/messages')).toHaveLength(0);

    await textarea.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(api.callsTo('POST /api/projects/p1/agent/messages')[0]?.body).toEqual({ text: 'Troca o título' });
    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
    expect(wrapper.text()).toContain('Troca o título');
    wrapper.unmount();
  });

  it('explains why the composer is off when the agent has no provider', async () => {
    const state = projectState();
    fakeApi({
      [STATE]: { body: { ...state, project: { ...state.project, agentEnabled: false } } },
      [MESSAGES]: conversation([]).route,
    });

    const { wrapper } = await mountChat();
    const textarea = wrapper.get('textarea');

    expect(textarea.attributes('disabled')).toBeDefined();
    const hint = wrapper.get(`#${textarea.attributes('aria-describedby')}`);
    expect(hint.text()).toContain('ainda não tem um provedor');
    wrapper.unmount();
  });
});
