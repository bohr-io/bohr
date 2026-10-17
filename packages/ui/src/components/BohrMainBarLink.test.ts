import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BohrMainBarLink from './BohrMainBarLink.vue';

describe('BohrMainBarLink', () => {
  it('writes the label under the icon, keeping it as the tooltip and the accessible name', () => {
    const wrapper = mount(BohrMainBarLink, {
      props: { label: 'Projects', href: '/projects' },
      slots: { default: '<svg />' },
    });
    const anchor = wrapper.get('a');

    expect(anchor.attributes('title')).toBe('Projects');
    expect(wrapper.get('.bohr-main-bar-link__label').text()).toBe('Projects');
    const caption = wrapper.get('.bohr-main-bar-link__caption');
    expect(caption.text()).toBe('Projects');
    expect(caption.attributes('aria-hidden')).toBe('true');
  });

  it('shows a shorter caption when given one, and none for an empty one', () => {
    const short = mount(BohrMainBarLink, { props: { label: 'Organization settings', caption: 'Settings' } });
    expect(short.get('.bohr-main-bar-link__caption').text()).toBe('Settings');
    expect(short.get('a').attributes('title')).toBe('Organization settings');

    const none = mount(BohrMainBarLink, { props: { label: 'Home', caption: '' } });
    expect(none.find('.bohr-main-bar-link__caption').exists()).toBe(false);
  });
});
