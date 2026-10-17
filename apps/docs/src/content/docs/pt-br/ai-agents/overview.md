---
title: Deploy a partir de agentes de IA de programação
description: Como Claude Code, Cursor, Codex e outros agentes de programação fazem deploy de projetos da bohr com a CLI.
sidebar:
  order: 1
---

Agentes de IA de programação (Claude Code, Cursor, Codex, Windsurf, Aider, os seus próprios scripts) conseguem fazer deploy de projetos da bohr com a [CLI do bohr](/pt-br/cli/install/): build, upload e uma URL de homologação para mostrar a você, sem navegador e sem a sua senha.

Esta seção foi escrita para você **e** para o agente. Aponte o seu agente para ela, ou entregue a ele as instruções prontas:

- [Trecho para AGENTS.md / CLAUDE.md](/pt-br/ai-agents/agents-md/): cole no arquivo de instruções do seu repositório.
- [SKILL.md](/pt-br/ai-agents/skill/): um arquivo de skill que o agente carrega quando precisa fazer deploy.

## Versão resumida

```sh
# 1. Você: crie um token no painel (Conta › Tokens), limitado ao projeto, e entregue ao agente
export BOHR_TOKEN=bohr_…

# 2. O agente: encontra o projeto uma vez
npx --yes bohr@latest projects --json

# 3. O agente: faz deploy de uma homologação depois de cada mudança e lê "url" do JSON
npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch agent/new-header --json
```

## Como isso convive com o agente da própria bohr

A bohr já tem um agente que muda o seu site a partir de um chat, com homologação e aprovação. Um agente de programação externo é para quando você trabalha no seu editor ou terminal: ele muda o código localmente e usa o `bohr deploy` para publicar homologações do trabalho dele.

| | O agente da bohr | O seu agente de programação + CLI |
| --- | --- | --- |
| Onde roda | O sandbox na sua conta Cloudflare | A sua máquina, ou o próprio sandbox do agente |
| Homologação | O branch `homolog`, aprovada no painel | Qualquer nome de branch, com `bohr deploy` |
| Produção | Aprovação no painel ou no Telegram | `bohr deploy --prod` (donos), só quando você pedir |

## Continue lendo

1. [Configure um token](/pt-br/ai-agents/setup/): com escopo, não interativo.
2. [O ciclo de deploy](/pt-br/ai-agents/deploy-loop/): `--json`, códigos de saída e a etiqueta de homologação vs `--prod`.
3. [Trecho para AGENTS.md](/pt-br/ai-agents/agents-md/) e [SKILL.md](/pt-br/ai-agents/skill/).

:::note[Projetos na sua própria conta da Cloudflare]
O `bohr deploy` também publica projetos na sua própria conta da Cloudflare, mas só com um token de um dono do projeto (homologações incluídas), já que o wrangler faz o deploy deles com a conexão da Cloudflare do dono. Com o token de qualquer outra pessoa, ele sai com o código 5 (`own_account_not_allowed`); o agente deve então fazer commit num branch e abrir um pull request, e o merge faz o deploy pelo workflow do projeto. As homologações deles usam os bancos D1 da produção. Veja [o ciclo de deploy](/pt-br/ai-agents/deploy-loop/#projetos-na-sua-própria-conta-cloudflare).
:::
