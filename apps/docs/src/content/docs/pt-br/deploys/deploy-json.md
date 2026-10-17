---
title: .bohr/deploy.json
description: Referência do arquivo que descreve como a bohr faz o build e o deploy de produção.
sidebar:
  order: 3
---

O `.bohr/deploy.json` diz à bohr como fazer o build e o deploy do seu site de produção. O agente escreve o arquivo quando prepara o repositório e o mantém funcionando; você também pode editá-lo. A bohr gera [o workflow de deploy](/pt-br/deploys/deploy-workflow/) a partir dele, e a [CLI](/pt-br/cli/deploy/) roda o `install` e o `build` dele antes do deploy.

```json
{
  "directory": ".",
  "node": "24",
  "packageManager": "npm",
  "install": "npm ci",
  "build": "npm run build"
}
```

## Campos

| Campo | Padrão | Descrição |
| --- | --- | --- |
| `directory` | `"."` | Pasta com o `package.json` e a config do wrangler do projeto, relativa à raiz do repositório. `"."` ou um caminho relativo como `"apps/web"`: sem `..`, sem pastas que começam com ponto. |
| `node` | `"24"` | Versão major do Node.js para o build, com dois dígitos (`"22"`, `"24"`). |
| `packageManager` | `"npm"` | `npm`, `pnpm`, `yarn` ou `bun`. `pnpm` e `yarn` vêm do Corepack; `bun` é configurado com `oven-sh/setup-bun`. |
| `python` | — | Versão do Python quando o build precisa dele (Python Workers), como `"3.12"`. |
| `install` | — | Instala as dependências, por exemplo `"npm ci"`. Omita para pular. |
| `build` | — | Faz o build de produção, por exemplo `"npm run build"`. Omita para pular. |
| `deploy` | `"npx wrangler deploy"` | Publica o build na sua conta da Cloudflare. Mantenha o padrão, a menos que o framework precise de um comando próprio (por exemplo `"npx opennextjs-cloudflare deploy"`): a [proteção por senha](/pt-br/projects/password-protection/) só vale com o padrão. |
| `secrets` | `[]` | Nomes de **secrets do repositório no GitHub** de que os passos de install e build precisam, por exemplo `["SENTRY_AUTH_TOKEN"]`. Até 50. |

### Regras para os comandos

`install`, `build` e `deploy` são linhas únicas de shell com até 500 caracteres, sem quebras de linha e sem expressões do GitHub (`${{ … }}`). Encadeie comandos com `&&`.

### Regras para os secrets

Os nomes usam `A-Z`, `0-9` e `_`. Nomes que começam com `GITHUB_` (reservado pelo GitHub) ou `CLOUDFLARE_` (as credenciais da Cloudflare só vão para o passo de deploy, que a bohr escreve) são recusados.

Raramente você precisa de `secrets`: prefira as [variáveis do build](/pt-br/projects/variables/#variáveis-do-build), que você define no painel da bohr e que chegam ao install e ao build sem mexer nas configurações do repositório. Use `secrets` para valores que você já guarda como secrets do GitHub Actions.

## Quando ele é inválido

Se o arquivo tiver um problema, o workflow de deploy não é atualizado e o chat avisa: *"O arquivo .bohr/deploy.json tem um problema (…), então o deploy de produção não foi atualizado. Peça para eu corrigi-lo."* A CLI para com `.bohr/deploy.json is invalid: …` (código de saída 2).

## Exemplos

Um site estático feito com Vite:

```json
{ "install": "npm ci", "build": "npm run build" }
```

Um app num monorepo pnpm:

```json
{
  "directory": "apps/web",
  "packageManager": "pnpm",
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm build"
}
```

Next.js com OpenNext:

```json
{
  "node": "22",
  "install": "npm ci",
  "build": "npx opennextjs-cloudflare build",
  "deploy": "npx opennextjs-cloudflare deploy"
}
```
