// The raw Markdown copy of every page: /<page>.md next to /<page>/, for AI tools and people who want the source.
// "index.md" is the home page of each language (/index.md, /pt-br/index.md).

/** Locale folder of Brazilian Portuguese pages (and their URL prefix). */
export const PT_BR = 'pt-br';
export const SITE = 'https://docs.bohr.io';

type DocLike = {
  id: string;
  filePath?: string | undefined;
  body?: string | undefined;
  data: { title: string; description?: string | undefined };
};

/** The page's path under src/content/docs without its extension: "cli/deploy", "pt-br/index". */
export function sourcePath(entry: DocLike): string {
  const file = (entry.filePath ?? '').replace(/\\/g, '/');
  const marker = 'src/content/docs/';
  const start = file.indexOf(marker);
  if (start === -1) return entry.id === '' ? 'index' : entry.id;
  return file.slice(start + marker.length).replace(/\.mdx?$/, '');
}

/** Where the page's Markdown copy is served, e.g. "/cli/deploy.md". */
export function markdownUrl(entry: DocLike): string {
  return `/${sourcePath(entry)}.md`;
}

/** The page's own URL, e.g. "/cli/deploy/" or "/pt-br/". */
export function pageUrl(entry: DocLike): string {
  const path = sourcePath(entry).replace(/(^|\/)index$/, '');
  return path === '' ? '/' : `/${path}/`;
}

export function isPortuguese(entry: DocLike): boolean {
  const path = sourcePath(entry);
  return path === PT_BR || path.startsWith(`${PT_BR}/`);
}

/** The page as Markdown: its title and description, where it lives, then its body. */
export function pageMarkdown(entry: DocLike): string {
  const lines = [`# ${entry.data.title}`, ''];
  if (entry.data.description) lines.push(`> ${entry.data.description}`, '');
  lines.push(`Source: ${SITE}${pageUrl(entry)}`, '');
  // Links between pages become absolute, so the copy works outside the site (llms-full.txt, an agent's context)
  const body = (entry.body ?? '').trim().replace(/\]\(\//g, `](${SITE}/`);
  return `${lines.join('\n')}\n${body}\n`;
}
