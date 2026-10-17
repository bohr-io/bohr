// After `astro build`: every page has its Markdown copy, and the files for AI tools and crawlers are there.
// (Internal links are validated during the build by starlight-links-validator.)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const docs = join(root, 'src/content/docs');
const problems = [];

const sources = readdirSync(docs, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => relative(docs, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));

for (const source of sources) {
  const path = source.replace(/\.md$/, '');
  const page = path.replace(/(^|\/)index$/, '');
  const html = join(dist, page, 'index.html');
  const markdown = join(dist, `${path}.md`);
  if (!existsSync(html)) problems.push(`missing page ${html}`);
  if (!existsSync(markdown)) problems.push(`missing Markdown copy ${markdown}`);
  else if (existsSync(html) && !readFileSync(html, 'utf8').includes(`type="text/markdown" href="/${path}.md"`)) {
    problems.push(`${html} does not link to /${path}.md`);
  }
}

const required = [
  'llms.txt',
  'llms-full.txt',
  'pt-br/llms.txt',
  'pt-br/llms-full.txt',
  'robots.txt',
  'sitemap-index.xml',
  '404.html',
  'downloads/AGENTS.md',
  'downloads/bohr-deploy/SKILL.md',
  'pt-br/downloads/AGENTS.md',
  'pt-br/downloads/bohr-deploy/SKILL.md',
];
for (const file of required) {
  if (!existsSync(join(dist, file))) problems.push(`missing ${file}`);
}

for (const file of ['llms.txt', 'pt-br/llms.txt']) {
  const path = join(dist, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('# bohr\n\n> ')) problems.push(`${file} does not start with an H1 and a summary`);
  const links = [...text.matchAll(/\]\(https:\/\/docs\.bohr\.io(\/[^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (!existsSync(join(dist, link))) problems.push(`${file} links to ${link}, which is not built`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-dist: ${sources.length} pages, each with its Markdown copy; llms.txt and downloads in place.`);
