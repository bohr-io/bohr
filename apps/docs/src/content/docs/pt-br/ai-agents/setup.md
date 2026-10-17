---
title: Configurar um token para um agente
description: Crie um token da bohr com escopo e entregue a um agente de IA sem expô-lo.
sidebar:
  order: 2
---

## 1. Crie um token com escopo

No painel, abra **Conta › Tokens** e preencha **Novo token**:

| Campo | Recomendação |
| --- | --- |
| **Nome** | Algo que você vá reconhecer depois, como `claude code - shop` |
| **Projetos** | **Só estes projetos**, e escolha só aqueles em que o agente trabalha. Evite **Todos os meus projetos, inclusive os que eu entrar depois**. |
| **Expira** | **Em 30 dias**, **Em 90 dias** ou **Em 365 dias**. Prefira um prazo curto; crie um token novo quando ele expirar. |

Clique em **Criar token** e copie o token: o painel o mostra uma única vez (*"Quem tiver o token publica como você."*).

Um token age como **você**, nos projetos dos quais você é membro, limitado aos que ele lista. Ele pode fazer deploy de homologações; deploy de produção só nos projetos que são seus, e de projetos na conta Cloudflare do dono só quando eles são seus (homologações incluídas). Ele nunca carrega o papel de administrador da instância.

## 2. Entregue o token ao agente

Defina o token como a variável de ambiente `BOHR_TOKEN` onde o agente roda comandos. Nunca cole o token no chat nem num arquivo do repositório.

```sh
# um shell a partir do qual você inicia o agente
export BOHR_TOKEN=bohr_…
claude
```

- **Claude Code**: exporte no shell antes de iniciar o `claude`, ou adicione ao `env` das suas configurações de usuário (`~/.claude/settings.json`), nunca ao `.claude/settings.json` do repositório.
- **Cursor, Windsurf**: defina no ambiente que o terminal do editor herda.
- **Codex e agentes na nuvem**: adicione como secret do ambiente do agente.
- **CI**: um secret de CI mascarado (veja [Uso em CI](/pt-br/cli/ci/)).

Confira se funciona:

```sh
npx --yes bohr@latest whoami --json
```

## 3. Não interativo por padrão

A CLI nunca faz perguntas e nunca abre o navegador quando não há terminal, quando `CI` está definida ou com `--json`. Os agentes devem sempre passar `--json`. Os agentes não devem rodar `bohr login`: ele precisa de uma pessoa para aprovar num navegador.

## Revogar

**Conta › Tokens › Revogar** para o token na hora. Os deploys que ele já publicou continuam no ar. Cada token mostra quando foi **usado** pela última vez.
