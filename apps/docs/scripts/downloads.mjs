// The files AI agents download (public/**/downloads/) are also shown in full on their pages, between the markers
// below. `node scripts/downloads.mjs` copies each file into its pages; the test (docs.test.mjs) checks they match.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'src/content/docs');

/** Each download and the page that embeds it, in both languages. */
export const EMBEDS = [
  { file: 'public/downloads/AGENTS.md', page: 'ai-agents/agents-md.md' },
  { file: 'public/downloads/bohr-deploy/SKILL.md', page: 'ai-agents/skill.md' },
  { file: 'public/pt-br/downloads/AGENTS.md', page: 'pt-br/ai-agents/agents-md.md' },
  { file: 'public/pt-br/downloads/bohr-deploy/SKILL.md', page: 'pt-br/ai-agents/skill.md' },
];

const START = '<!-- download:start -->';
const END = '<!-- download:end -->';

/** The file as the page shows it: without its leading HTML comment, in a four-backtick Markdown block. */
export function embedded(text) {
  const body = text.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
  return `${START}\n\n\`\`\`\`markdown\n${body}\n\`\`\`\`\n\n${END}`;
}

export function withEmbed(page, text) {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start === -1 || end === -1) throw new Error('The page has no download markers.');
  return page.slice(0, start) + embedded(text) + page.slice(end + END.length);
}

export function readEmbed(entry) {
  return {
    text: readFileSync(join(root, entry.file), 'utf8'),
    page: readFileSync(join(docs, entry.page), 'utf8'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const entry of EMBEDS) {
    const { text, page } = readEmbed(entry);
    writeFileSync(join(docs, entry.page), withEmbed(page, text));
    console.log(`${entry.page} ← ${entry.file}`);
  }
}
