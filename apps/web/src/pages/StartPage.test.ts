import { useToast } from '@bohr/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Onboarding, OnboardingStep } from '../api';
import { loadSession } from '../session';
import { createTestContext, type FakeRoute, fakeApi, ME, onboarding } from '../test-utils';
import StartPage from './StartPage.vue';

const ONBOARDING = 'GET /api/onboarding';
/** bohr.io Cloud, before the subscription. */
const CLOUD = { enabled: true, subscribed: false };
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test';

/** Mounts the wizard at /start (or `path`) with the instance answering `routes`. */
async function mountWizard(routes: Record<string, FakeRoute | FakeRoute[]>, path = '/start') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects: [] } },
    ...routes,
  });
  // The session is shared by the whole app; read it again from this test's instance.
  await loadSession(true);
  const context = await createTestContext(path);
  const wrapper = mount(StartPage, { global: { plugins: [...context.plugins] }, attachTo: document.body });
  await flushPromises();
  return { ...context, api, wrapper };
}

const step = (wrapper: Awaited<ReturnType<typeof mountWizard>>['wrapper']) =>
  wrapper.find('[data-step]').attributes('data-step');
const currentPhase = (wrapper: Awaited<ReturnType<typeof mountWizard>>['wrapper']) => {
  const current = wrapper.find('[aria-current="step"]');
  return current.exists() ? current.text() : null;
};
const button = (wrapper: Awaited<ReturnType<typeof mountWizard>>['wrapper'], text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

describe('onboarding wizard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it.each([
    ['subscription', { billing: CLOUD }, 'subscription', 'Assinatura'],
    ['cloudflare', {}, 'cloudflare', 'Cloudflare'],
    ['cloudflare_account', { pendingAccounts: [{ id: 'acc1', name: 'Acme' }] }, 'cloudflare_account', 'Cloudflare'],
    ['github', {}, 'github', 'GitHub'],
    // Every required step is done: the summary leads to the first project.
    ['done', {}, 'done', null],
  ] as const satisfies readonly [OnboardingStep, Partial<Onboarding>, string, string | null][])(
    'step %s shows the %s screen',
    async (serverStep, extra, screen, phase) => {
      const { wrapper, missing } = await mountWizard({
        [ONBOARDING]: { body: onboarding({ step: serverStep, ...extra }) },
      });

      expect(step(wrapper)).toBe(screen);
      if (phase === null) expect(currentPhase(wrapper)).toBeNull();
      else expect(currentPhase(wrapper)).toContain(phase);
      expect(missing).toEqual([]);
      wrapper.unmount();
    },
  );

  it('shows the subscription phase only on bohr.io Cloud, and always the Cloudflare one', async () => {
    const labels = (wrapper: Awaited<ReturnType<typeof mountWizard>>['wrapper']) =>
      wrapper.findAll('.wizard-progress__label').map((label) => label.text());

    const selfHosted = await mountWizard({ [ONBOARDING]: { body: onboarding({ step: 'github' }) } });
    expect(labels(selfHosted.wrapper)).toEqual(['Cloudflare', 'GitHub']);
    selfHosted.wrapper.unmount();

    const cloud = await mountWizard({
      [ONBOARDING]: { body: onboarding({ step: 'github', billing: { enabled: true, subscribed: true } }) },
    });
    expect(labels(cloud.wrapper)).toEqual(['Assinatura', 'Cloudflare', 'GitHub']);
    expect(cloud.wrapper.findAll('.wizard-progress__item.is-done')).toHaveLength(2);
    cloud.wrapper.unmount();
  });

  it('explains bohr.io Cloud and sends the user to Stripe Checkout', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { wrapper, api } = await mountWizard({
      [ONBOARDING]: { body: onboarding({ step: 'subscription', billing: CLOUD }) },
      'POST /api/onboarding/subscription': { body: { status: 'payment_required', checkoutUrl: CHECKOUT } },
    });

    expect(wrapper.text()).toContain('US$');
    expect(wrapper.text()).toContain('sua própria conta da Cloudflare');
    expect(wrapper.text()).toContain('tokens da Anthropic');
    await button(wrapper, 'Assinar')?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/onboarding/subscription')).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith(CHECKOUT);
    wrapper.unmount();
  });

  it('moves on to Cloudflare when the subscription is already active', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { wrapper, api } = await mountWizard({
      [ONBOARDING]: [
        { body: onboarding({ step: 'subscription', billing: CLOUD }) },
        { body: onboarding({ step: 'cloudflare', billing: { enabled: true, subscribed: true } }) },
      ],
      'POST /api/onboarding/subscription': { body: { status: 'ready' } },
    });

    await button(wrapper, 'Assinar')?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/onboarding/subscription')).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(step(wrapper)).toBe('cloudflare');
    wrapper.unmount();
  });

  it('waits for the subscription after Stripe sends the user back', async () => {
    const { wrapper } = await mountWizard(
      { [ONBOARDING]: { body: onboarding({ step: 'subscription', billing: CLOUD }) } },
      '/start?billing=success',
    );

    expect(wrapper.text()).toContain('confirmando a assinatura');
    expect(button(wrapper, 'Assinar')?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('follows the subscription after paying, and moves on once it is active', async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, api } = await mountWizard(
        {
          [ONBOARDING]: [
            { body: onboarding({ step: 'subscription', billing: CLOUD }) },
            { body: onboarding({ step: 'cloudflare', billing: { enabled: true, subscribed: true } }) },
          ],
        },
        '/start?billing=success',
      );
      expect(step(wrapper)).toBe('subscription');

      await vi.advanceTimersByTimeAsync(3_000);
      await flushPromises();

      expect(api.callsTo(ONBOARDING)).toHaveLength(2);
      expect(step(wrapper)).toBe('cloudflare');
      expect(useToast().toasts.map((toast) => toast.message)).toContain(
        'Assinatura ativa! Vamos seguir com a configuração.',
      );
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks the token format before calling the instance, and lists missing permissions', async () => {
    const { wrapper, api } = await mountWizard({
      [ONBOARDING]: { body: onboarding({ step: 'cloudflare' }) },
      'POST /api/onboarding/cloudflare': {
        body: {
          status: 'missing',
          missing: ['workers_scripts'],
          errors: { workers_scripts: 'Authentication error' },
        },
      },
    });

    expect(wrapper.get('a[href*="dash.cloudflare.com"]').attributes('target')).toBe('_blank');
    // Containers are optional: a free account connects, and the step only mentions them for the agent
    expect(wrapper.text()).toContain('inclusive o gratuito');
    expect(wrapper.findAll('.wizard-steps li')).toHaveLength(2);
    expect(wrapper.get('[data-note="containers"]').text()).toContain('Workers Paid');
    expect(wrapper.get('[data-note="containers"]').text()).toContain('Containers: Edit');
    await wrapper.get('input[type="password"]').setValue('short');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.callsTo('POST /api/onboarding/cloudflare')).toHaveLength(0);
    expect(wrapper.text()).toContain('não parece um token');

    await wrapper.get('input[type="password"]').setValue('x'.repeat(40));
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.callsTo('POST /api/onboarding/cloudflare')[0]?.body).toEqual({ token: 'x'.repeat(40) });
    expect(wrapper.get('[role="alert"]').text()).toContain('Workers Scripts: Edit');
    expect(wrapper.get('[role="alert"]').text()).not.toContain('Containers');
    expect(wrapper.text()).toContain('Authentication error');
    wrapper.unmount();
  });

  it('ends with the way to the first project and, without agent settings, to them', async () => {
    const { wrapper, api } = await mountWizard({
      [ONBOARDING]: { body: onboarding({ step: 'done', agent: { configured: false } }) },
    });

    expect(step(wrapper)).toBe('done');
    expect(wrapper.findAll('.wizard-progress__item.is-done')).toHaveLength(2);
    expect(wrapper.get('[data-notice="agent"]').text()).toContain('Falta configurar o agente');
    expect(wrapper.get('a[href="/projects/new"]').text()).toBe('Novo projeto');
    expect(wrapper.get('a[href="/account/agente"]').text()).toBe('Configurar o agente');
    // The wizard no longer creates projects nor skips steps.
    expect(api.calls.map((call) => call.path)).not.toContain('/api/onboarding/skip');
    wrapper.unmount();

    const configured = await mountWizard({ [ONBOARDING]: { body: onboarding({ step: 'done' }) } });
    expect(configured.wrapper.find('[data-notice="agent"]').exists()).toBe(false);
    expect(configured.wrapper.get('a[href="/account/agente"]').text()).toBe('Configurações do agente');
    configured.wrapper.unmount();
  });
});
