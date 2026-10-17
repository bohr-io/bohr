import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import BohrButton from './BohrButton.vue';

describe('BohrButton', () => {
  it('renders a primary, medium, default button by default', () => {
    const wrapper = mount(BohrButton, { slots: { default: 'Deploy' } });
    const button = wrapper.get('button');

    expect(button.attributes('type')).toBe('button');
    expect(button.classes()).toEqual(
      expect.arrayContaining(['bohr-button', 'bohr-button--default', 'bohr-button--md', 'bohr-button--primary']),
    );
    expect(button.text()).toBe('Deploy');
  });

  it.each([
    ['ghost', 'sm', 'secondary'],
    ['text', 'lg', 'black'],
    ['default', 'md', 'tertiary'],
  ] as const)('applies the %s variant, %s size and %s color', (variant, size, color) => {
    const wrapper = mount(BohrButton, { props: { variant, size, color } });

    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([`bohr-button--${variant}`, `bohr-button--${size}`, `bohr-button--${color}`]),
    );
  });

  it('marks danger and full width buttons', () => {
    const wrapper = mount(BohrButton, { props: { danger: true, fullWidth: true } });

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['bohr-button--danger', 'bohr-button--full-width']));
  });

  it('renders a link when given href, passing extra attributes through', () => {
    const wrapper = mount(BohrButton, {
      props: { href: 'https://github.com/bohr-io/bohr' },
      attrs: { target: '_blank', rel: 'noreferrer' },
      slots: { default: 'GitHub' },
    });
    const link = wrapper.get('a');

    expect(wrapper.find('button').exists()).toBe(false);
    expect(link.attributes('href')).toBe('https://github.com/bohr-io/bohr');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('type')).toBeUndefined();
  });

  it('drops the destination of a disabled link', () => {
    const wrapper = mount(BohrButton, { props: { href: '/somewhere', disabled: true } });
    const link = wrapper.get('a');

    expect(link.attributes('href')).toBeUndefined();
    expect(link.attributes('aria-disabled')).toBe('true');
  });

  it('disables a native button', () => {
    const wrapper = mount(BohrButton, { props: { disabled: true, type: 'submit' } });

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').attributes('type')).toBe('submit');
    expect(wrapper.classes()).toContain('is-disabled');
  });

  it('renders a custom root component', () => {
    const FakeLink = defineComponent({
      props: { to: { type: String, required: true } },
      setup:
        (props, { slots }) =>
        () =>
          h('a', { href: props.to, 'data-fake': '' }, slots.default?.()),
    });
    const wrapper = mount(BohrButton, { props: { as: FakeLink }, attrs: { to: '/pt/' } });

    expect(wrapper.get('a').attributes('href')).toBe('/pt/');
    expect(wrapper.get('a').attributes('data-fake')).toBeDefined();
  });

  it('wraps icon slots', () => {
    const wrapper = mount(BohrButton, {
      slots: { default: 'Go', iconLeft: '<svg class="left" />', iconRight: '<svg class="right" />' },
    });

    expect(wrapper.findAll('.bohr-button__icon')).toHaveLength(2);
    expect(wrapper.find('.left').exists()).toBe(true);
    expect(wrapper.find('.right').exists()).toBe(true);
  });
});
