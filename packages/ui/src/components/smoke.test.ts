import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { type Component, createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import * as ui from '../index';

// Minimal props for every exported component, rendered on the server and in the DOM.
const cases: [string, Component, Record<string, unknown>][] = [
  ['AvatarWall', ui.AvatarWall, { people: [{ name: 'ana', avatarUrl: 'https://example.com/a.png', href: '/ana' }] }],
  ['BohrAnimatedLogo', ui.BohrAnimatedLogo, { title: 'Loading' }],
  ['BohrBox', ui.BohrBox, { variant: 'glass', color: 'green', interactive: true }],
  ['BohrButton', ui.BohrButton, { href: '/docs' }],
  ['BohrLogo', ui.BohrLogo, { title: 'bohr.io' }],
  ['BohrMainBar', ui.BohrMainBar, {}],
  ['BohrMainBarLink', ui.BohrMainBarLink, { label: 'Home', href: '/', active: true }],
  ['BohrPageTitle', ui.BohrPageTitle, { title: 'Projects', path: 'acme', shadowText: 'projects' }],
  ['BohrSkeleton', ui.BohrSkeleton, { loading: true, width: '40px', height: '12px' }],
  ['BohrSwitch', ui.BohrSwitch, { label: 'Enabled', modelValue: true }],
  ['BohrTextField', ui.BohrTextField, { label: 'Password', type: 'password', validationStatus: 'warn' }],
  ['BohrTypography', ui.BohrTypography, { variant: 'title4', tag: 'h4' }],
  ['DeployCard', ui.DeployCard, { name: 'main', type: 'branch', status: 'success', hash: '0123456789' }],
  ['LoadingAnimation', ui.LoadingAnimation, { steps: ['Building'], details: ['Step 1'] }],
  ['ModalBase', ui.ModalBase, { open: false }],
  ['NewSiteLink', ui.NewSiteLink, { href: '/new', withText: true }],
  ['SettingsCard', ui.SettingsCard, { danger: true }],
  ['SiteCard', ui.SiteCard, { name: 'site', org: 'acme', href: '/acme/site' }],
  ['SitePreview', ui.SitePreview, { device: 'phonePortrait', src: 'https://example.com', title: 'Preview' }],
  ['StatusIndicator', ui.StatusIndicator, { status: 'warning' }],
  ['ToastDisplay', ui.ToastDisplay, {}],
  ['ArrowIcon', ui.ArrowIcon, { direction: 'right', gradient: true }],
  ['EyeIcon', ui.EyeIcon, { slashed: true }],
  ['XIcon', ui.XIcon, { gradient: true, title: 'Close' }],
];

describe('every component', () => {
  it.each(cases)('%s renders on the server', async (_, component, props) => {
    const html = await renderToString(createSSRApp({ render: () => h(component, props) }));

    expect(html.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s mounts in the DOM', (_, component, props) => {
    const wrapper = mount(component, { props });

    expect(wrapper.html().length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('gives icons stable, unique gradient ids', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => [h(ui.CheckIcon, { gradient: true }), h(ui.CheckIcon, { gradient: true })] }),
    );
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`url(#${id})`);
  });
});
