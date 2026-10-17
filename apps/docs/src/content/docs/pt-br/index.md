---
title: Documentação da bohr
description: A bohr faz o deploy do seu repositório do GitHub na Cloudflare e deixa um agente de IA mudá-lo por conversa, com uma homologação que você aprova antes de qualquer coisa chegar à produção.
---

**Pergunte mais, programe menos.** A bohr transforma um repositório do GitHub em um site que roda na Cloudflare e que você muda conversando com um agente de IA, no painel web ou no Telegram. Toda mudança vai primeiro para a homologação. Nada chega à produção até alguém aprovar.

## Comece por aqui

- [Como funciona](/pt-br/introduction/how-it-works/): o caminho de um repositório até a produção, passo a passo.
- [bohr.io Cloud ou auto-hospedada](/pt-br/introduction/cloud-and-self-hosted/): as duas formas de rodar a bohr e quanto custa cada uma.
- [Primeiros passos](/pt-br/getting-started/sign-in/): entre, conecte a Cloudflare e o GitHub e crie seu primeiro projeto.

## Use a bohr

- [O agente](/pt-br/agent/chat/): peça mudanças, revise a homologação, aprove ou descarte, reverta.
- [Projetos](/pt-br/projects/overview/): builds, versões, membros, variáveis, proteção por senha e domínios.
- [Deploys](/pt-br/deploys/how-deploys-work/): como um projeto faz o build e publica, e os arquivos que o descrevem.
- [Organizações](/pt-br/organizations/overview/): trabalhe em equipe, com membros que espelham a sua organização do GitHub.

## Automatize

- [A CLI `bohr`](/pt-br/cli/install/): faça deploy do seu terminal, de scripts e do CI.
- [Para agentes de IA](/pt-br/ai-agents/overview/): deixe o Claude Code, o Cursor, o Codex e outros agentes de código fazerem deploy com a CLI.
- [GitHub Action](/pt-br/github-action/reference/): `bohr-io/deploy-action@v1`.

## Rode a sua

- [Auto-hospedagem](/pt-br/self-hosting/overview/): instale a instância open source na sua própria conta da Cloudflare.
- [Migrando da bohr v1](/pt-br/migrating-from-v1/overview/): o que aconteceu com os projetos da v1 e como movê-los para a sua própria conta.

:::tip[Para ferramentas de IA]
Toda página tem uma cópia em Markdown: acrescente `.md` ao endereço dela (por exemplo [`/pt-br/cli/deploy.md`](https://docs.bohr.io/pt-br/cli/deploy.md)). O índice de todas as páginas está em [`/pt-br/llms.txt`](https://docs.bohr.io/pt-br/llms.txt), e a documentação inteira em um único arquivo em [`/pt-br/llms-full.txt`](https://docs.bohr.io/pt-br/llms-full.txt).
:::
