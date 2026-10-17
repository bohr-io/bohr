---
title: Tokens
description: Crie, limite e revogue tokens para a CLI da bohr, scripts e agentes de IA.
sidebar:
  order: 2
---

Um token deixa um script ou um agente de IA usar a bohr por você, com a [CLI da bohr](/pt-br/cli/install/): listar os seus projetos e publicar homologações (produção também, nos projetos que são seus; projetos na conta Cloudflare do dono, só quando são seus). Entregue o token na variável de ambiente `BOHR_TOKEN`. Gerencie os tokens em **Conta › Tokens** (**Gerenciar tokens**).

## Criar um token

Em **Novo token**:

| Campo | |
| --- | --- |
| **Nome** | Um que você reconheça, por exemplo "agente de deploy" ou "CI da loja". |
| **Projetos** | **Todos os meus projetos, inclusive os que eu entrar depois**, ou **Só estes projetos** (escolha pelo menos um). |
| **Expira** | **Em 30 dias**, **Em 90 dias**, **Em 365 dias** ou **Nunca**. |

Clique em **Criar token**. O painel mostra o token **uma única vez**, com o jeito de usar:

```sh
BOHR_TOKEN=bohr_… npx bohr deploy --json
```

Copie agora e guarde em lugar seguro: a bohr não mostra o token de novo, e quem o tiver pode publicar como você. A bohr guarda só um hash dele.

## O que um token pode fazer

- Ele age como **você**, nos projetos de que você é membro (os projetos de uma organização, por meio da organização), limitado aos projetos que ele lista.
- Homologações em qualquer um desses projetos; produção só nos projetos que são seus (ou cuja organização você administra).
- Ele nunca carrega o papel de administrador da instância, mesmo que você o tenha.
- Você pode ter até 50 tokens.

## Seus tokens

**Seus tokens** lista cada token com os projetos dele (**Todos os seus projetos** ou **Projetos: …**), quando foi **Criado**, quando foi **usado** pela última vez (ou *nunca usado*) e quando expira (ou *não expira*). Tokens vencidos mostram **Expirado**.

Cada computador em que você rodou `bohr login` tem um token próprio, marcado como **CLI** e com o nome "CLI on &lt;computador&gt;". O `bohr logout` revoga esse token.

## Revogar

Clique em **Revogar** e confirme: scripts, agentes e computadores que usam o token param de funcionar na hora. Os deploys já publicados continuam no ar.
