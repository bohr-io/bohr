// bohr's documentation (docs.bohr.io): Astro Starlight, built to static files in dist/ and served by a Cloudflare
// Worker with static assets (wrangler.jsonc). English at /, Brazilian Portuguese at /pt-br/.
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import { SECTIONS } from './src/sections.ts';

export default defineConfig({
  site: 'https://docs.bohr.io',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'bohr docs',
      description:
        'Documentation of bohr: deploy a GitHub repository to Cloudflare and change it with an AI agent, with a preview to approve before production.',
      logo: { src: './src/assets/logo.svg', alt: 'bohr' },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'pt-br': { label: 'Português (Brasil)', lang: 'pt-BR' },
      },
      social: [
        { icon: 'discord', label: 'Discord', href: 'https://discord.com/invite/p3hhfGg2Uy' },
        { icon: 'email', label: 'contact@bohr.io', href: 'mailto:contact@bohr.io' },
      ],
      customCss: ['./src/styles/bohr.css'],
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '32x32' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0e171d' } },
      ],
      // Adds <link rel="alternate" type="text/markdown"> to each page (src/route-middleware.ts)
      routeMiddleware: './src/route-middleware.ts',
      lastUpdated: false,
      credits: false,
      sidebar: [
        ...SECTIONS.map((section) => ({
          label: section.en,
          translations: { 'pt-BR': section.ptBR },
          collapsed: section.collapsed ?? false,
          items: [{ autogenerate: { directory: section.directory } }],
        })),
        {
          label: 'Changelog',
          translations: { 'pt-BR': 'Novidades' },
          link: '/changelog/',
        },
      ],
      plugins: [
        starlightLinksValidator({
          errorOnInconsistentLocale: true,
          errorOnFallbackPages: true,
          // Plain files next to the pages: raw Markdown, llms.txt and the downloads for AI agents
          exclude: [
            '/llms.txt',
            '/llms-full.txt',
            '/pt-br/llms.txt',
            '/pt-br/llms-full.txt',
            '/downloads/**',
            '/pt-br/downloads/**',
          ],
        }),
      ],
    }),
  ],
});
