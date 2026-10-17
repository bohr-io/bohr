// /<page>.md: the raw Markdown of every page, in both languages.

import { type CollectionEntry, getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { pageMarkdown, sourcePath } from '../lib/markdown';

export const getStaticPaths = (async () => {
  const entries = await getCollection('docs');
  return entries.map((entry) => ({ params: { slug: sourcePath(entry) }, props: { entry } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = ({ props }) =>
  new Response(pageMarkdown(props.entry), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
