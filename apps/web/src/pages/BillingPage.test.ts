import { useToast } from '@bohr/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from '../session';
import { createTestContext, type FakeRoute, fakeApi, ME } from '../test-utils';
import BillingPage from './BillingPage.vue';

async function mountBilling(billing: FakeRoute | FakeRoute[], path = '/billing') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/billing': billing,
    'POST /api/billing/checkout': { body: { url: 'https://checkout.stripe.com/c/pay/cs_test' } },
    'POST /api/billing/portal': { body: { url: 'https://billing.stripe.com/p/session/test' } },
  });
  await loadSession(true);
  const context = await createTestContext(path);
  const wrapper = mount(BillingPage, { global: { plugins: [...context.plugins] } });
  await flushPromises();
  return { ...context, api, wrapper };
}

const button = (wrapper: Awaited<ReturnType<typeof mountBilling>>['wrapper'], text: string) =>
  wrapper.findAll('button').find((candidate) => candidate.text() === text);

describe('billing page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useToast().clear();
  });

  it('shows an active subscription and opens the Stripe portal', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { wrapper, missing } = await mountBilling({
      body: {
        subscription: { status: 'active', legacy: true, currentPeriodEnd: '2026-11-11T12:00:00.000Z', priceId: 'p' },
      },
    });

    expect(wrapper.text()).toContain('Ativa');
    expect(wrapper.text()).toContain('Preço da versão anterior da bohr');
    expect(button(wrapper, 'Assinar o bohr.io Cloud')).toBeUndefined();

    await button(wrapper, 'Gerenciar na Stripe')?.trigger('click');
    await flushPromises();
    expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test');
    expect(missing).toEqual([]);
  });

  it('subscribes through Stripe Checkout', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    const { wrapper, api } = await mountBilling({ body: { subscription: null } });

    expect(wrapper.text()).toContain('Você ainda não tem assinatura.');
    await button(wrapper, 'Assinar o bohr.io Cloud')?.trigger('click');
    await flushPromises();

    expect(api.callsTo('POST /api/billing/checkout')).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test');
  });

  it('waits for the subscription after paying', async () => {
    vi.useFakeTimers();
    try {
      const { wrapper } = await mountBilling(
        [
          { body: { subscription: { status: 'incomplete', legacy: false, currentPeriodEnd: null, priceId: 'p' } } },
          { body: { subscription: { status: 'active', legacy: false, currentPeriodEnd: null, priceId: 'p' } } },
        ],
        '/billing?billing=success',
      );
      expect(wrapper.text()).toContain('Estamos confirmando a assinatura');

      await vi.advanceTimersByTimeAsync(3_000);
      await flushPromises();
      expect(wrapper.text()).toContain('Assinatura ativa!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains when the instance does not charge (self-hosted)', async () => {
    const { wrapper } = await mountBilling({
      status: 404,
      body: { error: 'Billing is not enabled on this instance.' },
    });

    expect(wrapper.text()).toContain('Esta instância não cobra assinatura.');
  });
});
