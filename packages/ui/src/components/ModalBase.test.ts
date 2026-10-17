import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ModalBase from './ModalBase.vue';

function pressKey(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('ModalBase', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('renders nothing while closed', () => {
    mount(ModalBase, { props: { open: false }, slots: { default: 'Hello' } });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', async () => {
    const wrapper = mount(ModalBase, { props: { open: true }, slots: { default: 'Hello' } });
    await flushPromises();

    pressKey('Escape');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    wrapper.unmount();
  });

  it('locks body scroll while open and unlocks it when closed', async () => {
    document.body.style.overflow = 'auto';
    const wrapper = mount(ModalBase, { props: { open: false }, slots: { default: 'Hello' } });

    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Hello');

    await wrapper.setProps({ open: false });
    expect(document.body.style.overflow).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('');

    // Escape no longer reaches a closed modal.
    pressKey('Escape');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('releases the lock when unmounted while open', async () => {
    const wrapper = mount(ModalBase, { props: { open: true } });
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps focus inside the dialog and restores it on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = mount(ModalBase, {
      props: { open: true, withCloseButton: true, closeLabel: 'Close' },
      slots: { default: '<input id="first" />' },
      attachTo: document.body,
    });
    await flushPromises();

    const first = document.getElementById('first');
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(document.activeElement).toBe(first);

    close?.focus();
    pressKey('Tab');
    expect(document.activeElement).toBe(first);

    pressKey('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(close);

    close?.click();
    expect(wrapper.emitted('close')).toHaveLength(1);

    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it('closes on a backdrop click only when allowed', async () => {
    const wrapper = mount(ModalBase, { props: { open: true, closeOnBackdrop: false } });
    await flushPromises();
    const backdrop = document.querySelector<HTMLElement>('.bohr-modal');

    backdrop?.click();
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.setProps({ closeOnBackdrop: true });
    backdrop?.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
