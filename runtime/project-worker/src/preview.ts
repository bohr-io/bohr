import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env';

/** Entry point of the preview Worker (a service binding): all its traffic goes to the project's container. */
export class Preview extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return this.env.PROJECT.getByName(this.env.PROJECT_ID).fetch(request);
  }
}

/** Source of the small Worker published at the preview URL. It only forwards to the Preview entry point. */
export const PREVIEW_WORKER_SOURCE = `export default {
  fetch(request, env) {
    return env.PROJECT.fetch(request);
  },
};
`;

export function previewPage(title: string, text: string, refreshSeconds: number | null): Response {
  const escapeHtml = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const refresh = refreshSeconds === null ? '' : `<meta http-equiv="refresh" content="${refreshSeconds}">`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">${refresh}<title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e171d;color:#fff;font:16px/1.5 Helvetica,Arial,sans-serif}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;background:linear-gradient(90deg,#f4cc3a,#f26419,#e84855);-webkit-background-clip:text;background-clip:text;color:transparent}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`;
  return new Response(html, {
    status: refreshSeconds === null ? 404 : 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'cache-control': 'no-store',
      ...(refreshSeconds === null ? {} : { 'retry-after': String(refreshSeconds) }),
    },
  });
}
