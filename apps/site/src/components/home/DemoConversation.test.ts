import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSiteI18n } from '../../i18n';
import DemoConversation from './DemoConversation.vue';
import { FINAL_STEP, LOOP_DURATION, STEP_DELAYS } from './demoTimeline';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** An IntersectionObserver that reports the chat as visible right away. */
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
}

async function mountDemo() {
  const wrapper = mount(DemoConversation, { global: { plugins: [createSiteI18n('pt-BR')] } });
  await flushPromises();
  return wrapper;
}

const visibleRows = (wrapper: Awaited<ReturnType<typeof mountDemo>>) =>
  wrapper.findAll('.demo__row').filter((row) => row.classes('is-visible')).length;

describe('DemoConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the final conversation statically with reduced motion', async () => {
    mockReducedMotion(true);
    const wrapper = await mountDemo();

    expect(visibleRows(wrapper)).toBe(4);
    expect(wrapper.find('.demo__key--approve').classes()).toContain('is-tapped');
    expect(wrapper.find('.demo__toggle').exists()).toBe(false);

    vi.advanceTimersByTime(LOOP_DURATION * 2);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(4);
  });

  it('plays the conversation step by step and loops', async () => {
    mockReducedMotion(false);
    const wrapper = await mountDemo();
    expect(visibleRows(wrapper)).toBe(0);

    const [toRequest = 0, toWorking = 0, toPreview = 0, toTap = 0, toPublished = 0] = STEP_DELAYS;

    vi.advanceTimersByTime(toRequest);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(1);

    vi.advanceTimersByTime(toWorking + toPreview);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(3);
    expect(wrapper.find('.demo__key--approve').classes()).not.toContain('is-tapped');

    vi.advanceTimersByTime(toTap);
    await flushPromises();
    expect(wrapper.find('.demo__key--approve').classes()).toContain('is-tapped');

    vi.advanceTimersByTime(toPublished);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(4);

    vi.advanceTimersByTime(STEP_DELAYS[FINAL_STEP] ?? 0);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(0);
  });

  it('pauses and resumes', async () => {
    mockReducedMotion(false);
    const wrapper = await mountDemo();
    const toggle = wrapper.get('.demo__toggle');
    expect(toggle.text()).toContain('Pausar animação');

    await toggle.trigger('click');
    expect(toggle.text()).toContain('Retomar animação');
    vi.advanceTimersByTime(LOOP_DURATION);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(0);

    await toggle.trigger('click');
    vi.advanceTimersByTime(STEP_DELAYS[0]);
    await flushPromises();
    expect(visibleRows(wrapper)).toBe(1);
  });

  it('keeps a complete transcript for screen readers', async () => {
    mockReducedMotion(false);
    const wrapper = await mountDemo();
    const transcript = wrapper.get('.demo__transcript').text();

    expect(wrapper.get('.demo__messages').attributes('aria-hidden')).toBe('true');
    expect(transcript).toContain('Troca a cor do botão “Comprar” para verde');
    expect(transcript).toContain('loja-homolog.workers.dev');
    expect(transcript).toContain('Você tocou em “Aprovar”.');
    expect(transcript).toContain('PR #42 mesclado. Se precisar, é só mandar /rollback.');
  });
});
