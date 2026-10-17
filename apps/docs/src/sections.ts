// The documentation's sections, in sidebar order: the folder under src/content/docs (and src/content/docs/pt-br)
// and its name in each language. The sidebar (astro.config.mjs) and llms.txt (src/lib/llms.ts) both read it.

export type Section = { directory: string; en: string; ptBR: string; collapsed?: boolean };

export const SECTIONS: readonly Section[] = [
  { directory: 'introduction', en: 'Introduction', ptBR: 'Introdução' },
  { directory: 'getting-started', en: 'Getting started', ptBR: 'Primeiros passos' },
  { directory: 'agent', en: 'The agent', ptBR: 'O agente' },
  { directory: 'projects', en: 'Projects', ptBR: 'Projetos' },
  { directory: 'deploys', en: 'Deploys', ptBR: 'Deploys' },
  { directory: 'cli', en: 'CLI', ptBR: 'CLI' },
  { directory: 'github-action', en: 'GitHub Action', ptBR: 'GitHub Action' },
  { directory: 'ai-agents', en: 'For AI agents', ptBR: 'Para agentes de IA' },
  { directory: 'organizations', en: 'Organizations', ptBR: 'Organizações' },
  { directory: 'account', en: 'Account', ptBR: 'Conta' },
  { directory: 'billing', en: 'Billing', ptBR: 'Assinatura' },
  { directory: 'self-hosting', en: 'Self-hosting', ptBR: 'Auto-hospedagem', collapsed: true },
  { directory: 'migrating-from-v1', en: 'Migrating from bohr v1', ptBR: 'Migração da bohr v1', collapsed: true },
  { directory: 'reference', en: 'Reference', ptBR: 'Referência' },
];

/** Pages outside the sections, listed last. */
export const LOOSE_PAGES = ['changelog'] as const;
