// Starlight route middleware: every page points at its raw Markdown copy (<link rel="alternate">), which AI
// tools read instead of the HTML.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { markdownUrl } from './lib/markdown';

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  if (route.isFallback) return;
  route.head.push({
    tag: 'link',
    attrs: { rel: 'alternate', type: 'text/markdown', href: markdownUrl(route.entry), title: 'Markdown' },
  });
});
