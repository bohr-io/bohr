// llms.txt (llmstxt.org) and llms-full.txt for each language: the index of the pages, with a link to each page's
// Markdown copy and its description, and every page concatenated.
import { type CollectionEntry, getCollection } from 'astro:content';
import { LOOSE_PAGES, SECTIONS } from '../sections';
import { isPortuguese, markdownUrl, PT_BR, pageMarkdown, SITE, sourcePath } from './markdown';

export type Language = 'en' | 'pt-BR';

const TEXT = {
  en: {
    summary:
      'bohr deploys a GitHub repository as a Cloudflare Worker and lets an AI agent change it by conversation (in the web panel or on Telegram). Every change goes to a preview first, and reaches production only when someone approves it. bohr is open source and self-hosted, or run for you as bohr.io Cloud (app.bohr.io).',
    details: [
      "Projects run in their owner's Cloudflare account; the code stays in their GitHub repository. The `bohr` CLI (npm `bohr`) deploys from a terminal, scripts, CI and AI coding agents; `bohr-io/deploy-action@v1` deploys from GitHub Actions.",
      'Each link below is the Markdown copy of a page. The whole documentation in one file: ' +
        `${SITE}/llms-full.txt. Brazilian Portuguese: ${SITE}/pt-br/llms.txt.`,
    ],
    other: 'Other',
    downloads: 'Downloads for AI agents',
    agentsMd: 'AGENTS.md / CLAUDE.md snippet that tells a coding agent how to deploy with the bohr CLI',
    skill: 'SKILL.md: instructions an AI agent loads to deploy bohr projects (Claude Code skill format)',
  },
  'pt-BR': {
    summary:
      'A bohr publica um repositório do GitHub como um Worker da Cloudflare e deixa um agente de IA mudá-lo por conversa (no painel web ou no Telegram). Cada mudança vai primeiro para uma homologação e só chega à produção quando alguém aprova. A bohr é open source e auto-hospedada, ou roda para você como bohr.io Cloud (app.bohr.io).',
    details: [
      'Os projetos rodam na conta da Cloudflare do dono; o código fica no repositório dele no GitHub. A CLI `bohr` (npm `bohr`) publica a partir de um terminal, scripts, CI e agentes de IA de programação; `bohr-io/deploy-action@v1` publica pelo GitHub Actions.',
      'Cada link abaixo é a cópia em Markdown de uma página. A documentação inteira num arquivo: ' +
        `${SITE}/pt-br/llms-full.txt. Em inglês: ${SITE}/llms.txt.`,
    ],
    other: 'Outros',
    downloads: 'Arquivos para agentes de IA',
    agentsMd: 'Trecho de AGENTS.md / CLAUDE.md que ensina um agente de programação a publicar com a CLI do bohr',
    skill:
      'SKILL.md: instruções que um agente de IA carrega para publicar projetos bohr (formato de skill do Claude Code)',
  },
} as const;

type Entry = CollectionEntry<'docs'>;

/** The pages of one language, by section in sidebar order (then by sidebar.order and path). */
async function pagesBySection(language: Language) {
  const entries = (await getCollection('docs')).filter((entry) => isPortuguese(entry) === (language === 'pt-BR'));
  const relative = (entry: Entry) => {
    const path = sourcePath(entry);
    return language === 'pt-BR' ? path.slice(PT_BR.length + 1) || 'index' : path;
  };
  const sorted = (list: Entry[]) =>
    list.sort(
      (a, b) =>
        (a.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER) - (b.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER) ||
        relative(a).localeCompare(relative(b)),
    );
  const home = entries.filter((entry) => relative(entry) === 'index');
  const sections = SECTIONS.map((section) => ({
    title: language === 'pt-BR' ? section.ptBR : section.en,
    pages: sorted(entries.filter((entry) => relative(entry).startsWith(`${section.directory}/`))),
  }));
  const loose = entries.filter((entry) => (LOOSE_PAGES as readonly string[]).includes(relative(entry)));
  return { home, sections, loose };
}

const link = (entry: Entry) =>
  `- [${entry.data.title}](${SITE}${markdownUrl(entry)})${entry.data.description ? `: ${entry.data.description}` : ''}`;

export async function llmsTxt(language: Language): Promise<string> {
  const text = TEXT[language];
  const { home, sections, loose } = await pagesBySection(language);
  const prefix = language === 'pt-BR' ? `/${PT_BR}` : '';
  const lines = ['# bohr', '', `> ${text.summary}`, '', ...text.details.flatMap((line) => [line, ''])];
  for (const section of sections) {
    if (section.pages.length === 0) continue;
    lines.push(`## ${section.title}`, '', ...section.pages.map(link), '');
  }
  lines.push(
    `## ${text.downloads}`,
    '',
    `- [AGENTS.md](${SITE}${prefix}/downloads/AGENTS.md): ${text.agentsMd}`,
    `- [SKILL.md](${SITE}${prefix}/downloads/bohr-deploy/SKILL.md): ${text.skill}`,
    '',
    '## Optional',
    '',
    ...[...home, ...loose].map(link),
    '',
  );
  return lines.join('\n');
}

export async function llmsFullTxt(language: Language): Promise<string> {
  const text = TEXT[language];
  const { home, sections, loose } = await pagesBySection(language);
  const pages = [...home, ...sections.flatMap((section) => section.pages), ...loose];
  const header = ['# bohr', '', `> ${text.summary}`, ''].join('\n');
  return `${header}\n${pages.map((entry) => pageMarkdown(entry)).join('\n---\n\n')}`;
}

export const textResponse = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
