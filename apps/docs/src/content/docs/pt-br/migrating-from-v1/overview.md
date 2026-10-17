---
title: Projetos da bohr v1 na bohr v2
description: O que aconteceu com os projetos da bohr v1, e o que você pode fazer agora.
sidebar:
  order: 1
---

A bohr v2 substitui a bohr v1. Os projetos dos clientes pagantes da bohr v1 foram movidos para a bohr v2 por nós; você não precisou fazer nada.

## O que aconteceu com o seu projeto

- **Ele roda na bohr v2**, hospedado pela bohr na conta da Cloudflare dela, como era na v1. No painel, a hospedagem dele mostra **Hospedado pela bohr**.
- **Mesmos endereços, sem mudanças de DNS.** Os seus domínios próprios e os seus endereços `bohr.io` (`<repo>-<owner>.bohr.io`) continuam funcionando.
- **O seu repositório mantém o workflow.** O workflow da bohr v1 (`.github/workflows/bohr.yml`) continua rodando a cada push, e agora faz deploy na bohr v2. A bohr não escreveu nada no seu repositório: nenhum workflow novo, nenhum arquivo, nenhum secret do Actions.
- **Mesmo preço.** O seu plano mantém o preço que você pagava na v1.
- **As suas configurações vieram junto**: variáveis de ambiente (como [variáveis do build](/pt-br/projects/variables/#variáveis-do-build) e [variáveis do site](/pt-br/projects/variables/#variáveis-do-site)), proteção por senha e domínios.

Entre em [app.bohr.io](https://app.bohr.io) com a mesma conta do GitHub para ver os seus projetos.

## O que você pode fazer agora

| | |
| --- | --- |
| **Deixar como está** | Faça push como antes; cada branch continua ganhando o próprio endereço de homologação. Veja [O que muda](/pt-br/migrating-from-v1/what-changes/). |
| **Ativar o agente** | Mude o site conversando, com homologações e aprovações. No projeto, clique em **Ativar o agente** (precisa de uma assinatura ativa e de um [provedor de modelo](/pt-br/agent/providers/)). |
| **Mover para a sua própria conta da Cloudflare** | Onde rodam os projetos da bohr v2. Veja [Mover para a sua conta da Cloudflare](/pt-br/migrating-from-v1/move-to-your-cloudflare/). |
| **Gerenciar o DNS do seu domínio** | Se a bohr v1 hospedava todo o DNS do seu domínio, os registros estão em **Domínios** no painel. Veja [DNS de domínios hospedados pela bohr](/pt-br/migrating-from-v1/dns/). |
| **Fazer deploy pelo terminal ou por um agente de IA** | O `bohr deploy` publica projetos que a bohr hospeda. Veja [a CLI](/pt-br/cli/deploy/). |

Dúvidas: [Discord](https://discord.com/invite/p3hhfGg2Uy) ou [contact@bohr.io](mailto:contact@bohr.io). Veja também as [Perguntas frequentes](/pt-br/migrating-from-v1/faq/).
