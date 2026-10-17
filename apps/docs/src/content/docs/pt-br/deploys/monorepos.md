---
title: Monorepos e pastas de trabalho
description: Faça o deploy de um projeto que fica numa subpasta do repositório.
sidebar:
  order: 7
---

Um projeto não precisa ficar na raiz do repositório. Aponte o `directory` do [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/) para a pasta com o `package.json` e a config do wrangler do site:

```json
{
  "directory": "apps/web",
  "packageManager": "pnpm",
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm build"
}
```

- O workflow de deploy roda todos os passos (`install`, `build`, migrations e `deploy`) nessa pasta (`defaults.run.working-directory`).
- As ferramentas de workspace encontram a raiz do repositório a partir dali: `pnpm install` em `apps/web` instala o workspace inteiro.
- A bohr encontra o nome do Worker de produção no `wrangler.jsonc` dessa pasta.
- A [CLI](/pt-br/cli/deploy/) lê o `.bohr/deploy.json` na raiz do repositório e faz o deploy a partir de `directory`, ou de `--dir`.

O `.bohr/deploy.json` e o `.bohr/preview.json` em si ficam sempre na raiz do repositório.

## A homologação

Os comandos do `.bohr/preview.json` rodam a partir da raiz do repositório. Mude de pasta no comando quando precisar:

```json
{
  "install": "pnpm install",
  "command": "pnpm --filter web dev --host 0.0.0.0 --port 5173",
  "port": 5173
}
```

## Um repositório, um projeto

Cada repositório pode ser um projeto da bohr. Para publicar dois sites a partir de um repositório, divida-os em dois repositórios, ou publique o segundo você mesmo, com um workflow próprio.
