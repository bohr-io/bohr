import { renderSSRHead } from '@unhead/vue/server';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import { CLOUD_URL, CONTACT_EMAIL, DEPLOY_BUTTON_URL, DISCORD_URL, docsUrl, GITHUB_URL } from '../config';
import { ALL_PATHS } from '../i18n/locales';
import { createTestContext, stubFetch } from '../test-utils';

async function mountPage(path: string) {
  const context = await createTestContext(path);
  const wrapper = mount(App, { global: { plugins: [...context.plugins] } });
  await flushPromises();
  return { ...context, wrapper };
}

describe('pages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(stubFetch(404, { message: 'Not Found' })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(ALL_PATHS)('%s renders without missing translations', async (path) => {
    const { wrapper, missing } = await mountPage(path);

    expect(missing).toEqual([]);
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.find('main#main').exists()).toBe(true);
    expect(wrapper.find('header').exists()).toBe(true);
    expect(wrapper.find('footer').exists()).toBe(true);
  });

  it.each([
    ['/', 'en', 'Ask more,'],
    ['/pt/', 'pt-BR', 'Peça mais,'],
    ['/es/', 'es', 'Pide más,'],
  ])('%s is the %s home page', async (path, lang, headline) => {
    const { wrapper, head } = await mountPage(path);
    const { headTags, htmlAttrs } = await renderSSRHead(head);

    expect(wrapper.get('h1').text()).toContain(headline);
    expect(htmlAttrs).toContain(`lang="${lang}"`);
    expect(headTags).toContain('<link rel="alternate" hreflang="en" href="https://bohr.io/">');
    expect(headTags).toContain('<link rel="alternate" hreflang="pt-BR" href="https://bohr.io/pt/">');
    expect(headTags).toContain('<link rel="alternate" hreflang="es" href="https://bohr.io/es/">');
    expect(headTags).toContain('<link rel="alternate" hreflang="x-default" href="https://bohr.io/">');
    expect(headTags).toContain(`<link rel="canonical" href="https://bohr.io${path}">`);
  });

  it('gives the migration page its own localized head', async () => {
    const { head } = await mountPage('/es/migration');
    const { headTags, htmlAttrs } = await renderSSRHead(head);

    expect(htmlAttrs).toContain('lang="es"');
    expect(headTags).toContain('<title>Migración a la nueva bohr — bohr.io</title>');
    expect(headTags).toContain('<link rel="alternate" hreflang="pt-BR" href="https://bohr.io/pt/migration">');
  });

  it('has every home section, in order, with the external destinations', async () => {
    const { wrapper } = await mountPage('/pt/');
    const ids = wrapper.findAll('main section[id]').map((section) => section.attributes('id'));
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));

    expect(ids).toEqual([
      'demo',
      'how-it-works',
      'self-hosted',
      'accounts',
      'security',
      'stack',
      'plans',
      'customers',
      'community',
      'faq',
      'get-started',
    ]);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '#self-hosted',
        CLOUD_URL,
        DEPLOY_BUTTON_URL,
        GITHUB_URL,
        DISCORD_URL,
        docsUrl('pt-BR'),
        `mailto:${CONTACT_EMAIL}`,
        '/pt/migration',
      ]),
    );
    expect(wrapper.findAll('#faq details')).toHaveLength(7);
    expect(wrapper.findAll('#stack img[alt]')).toHaveLength(9);
  });

  it('switches language to the same page', async () => {
    const { wrapper } = await mountPage('/pt/migration');
    const switcher = wrapper.get('footer nav');
    const links = switcher.findAll('a').map((link) => [link.attributes('href'), link.attributes('hreflang')]);

    expect(links).toEqual([
      ['/migration', 'en'],
      ['/pt/migration', 'pt-BR'],
      ['/es/migration', 'es'],
    ]);
    expect(switcher.get('[aria-current="page"]').text()).toBe('Português');
  });
});
