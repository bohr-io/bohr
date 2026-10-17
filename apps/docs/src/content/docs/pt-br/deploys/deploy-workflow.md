---
title: O workflow de deploy
description: O workflow do GitHub Actions que a bohr escreve a partir do .bohr/deploy.json, passo a passo.
sidebar:
  order: 2
---

A bohr escreve o `.github/workflows/bohr-deploy.yml` a partir do [`.bohr/deploy.json`](/pt-br/deploys/deploy-json/), com um modelo fixo. **Mude o `.bohr/deploy.json`, não o workflow**: a bohr reescreve o workflow sempre que o trabalho do agente muda as configurações de deploy, e a primeira linha dele avisa isso:

```yaml
# Written by bohr from .bohr/deploy.json. Change that file instead: bohr rewrites this one.
```

A bohr só substitui um `bohr-deploy.yml` que começa com essa linha. Um workflow que a sua equipe escreveu com esse nome continua fazendo deploy como está.

## Como ele é

Para `{"install": "npm ci", "build": "npm run build"}` no branch de produção `main` (scripts longos encurtados):

```yaml
name: bohr deploy
on:
  push:
    branches: ["main"]
concurrency:
  group: bohr-deploy
  cancel-in-progress: false
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: "."
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@v5
        with:
          node-version: "24"
      - name: Build variables
        # carrega as variáveis do build que versões antigas da bohr guardavam como secrets de Actions BOHR_BUILD_<NAME>
      - name: bohr credentials
        id: bohr-credentials
        uses: bohr-io/deploy-action@v1
        with:
          credentials: "true"
      - name: Install
        run: "npm ci"
      - name: Build
        run: "npm run build"
      - name: D1 migrations
        # só quando a config do wrangler tem bancos D1 com migrations_dir
      - name: Deploy
        # envolve o site na barreira de senha e depois roda:
        # npx wrangler deploy --message "bohr" --tag "bohr-${GITHUB_SHA::12}"
        env:
          CLOUDFLARE_API_TOKEN: ${{ steps.bohr-credentials.outputs.cloudflare-api-token }}
          CLOUDFLARE_ACCOUNT_ID: ${{ steps.bohr-credentials.outputs.cloudflare-account-id }}
```

## Os passos

| Passo | O que faz |
| --- | --- |
| Gatilho | Só pushes para o branch de produção. Pushes ali só vêm de merges aprovados, reversões ou pessoas com acesso de escrita. |
| `concurrency` | Um deploy por vez; um novo push espera o que está rodando em vez de cancelá-lo. |
| `permissions` | `contents: read` e `id-token: write` (para pedir o token OIDC do GitHub). Nada mais. |
| Preparação | `oven-sh/setup-bun@v2` quando o gerenciador de pacotes é `bun`; `actions/setup-node@v5` com a versão de `node`; `actions/setup-python@v6` quando `python` está definido; `corepack enable` para `pnpm` e `yarn`. |
| **bohr credentials** | [`bohr-io/deploy-action@v1`](/pt-br/github-action/reference/#modo-credenciais) com `credentials: "true"`: pede à bohr as [variáveis do build](/pt-br/projects/variables/#variáveis-do-build) do projeto (exportadas, mascaradas, para os passos seguintes) e o token e a conta da Cloudflare (saídas do passo, só para o passo de deploy). Instâncias self-hosted adicionam a própria `instance-url`. |
| **Install**, **Build** | Os seus comandos, em `directory`. Os secrets do repositório listados em `secrets` são passados só para esses dois passos. |
| **D1 migrations** | `npx wrangler d1 migrations apply <binding> --remote` para cada banco D1 com `migrations_dir`. Veja [Bancos de dados D1](/pt-br/deploys/d1-databases/). |
| **Deploy** | Com o comando padrão, envolve o site na [barreira de senha](/pt-br/projects/password-protection/) e roda `npx wrangler deploy`. Um comando `deploy` próprio roda como está. O token da Cloudflare chega só a este passo (e às migrations). |

## Por que é seguro

- Os comandos são linhas únicas sem expressões do GitHub (`${{ }}`), então não conseguem ler outros secrets nem contextos.
- O token da Cloudflare nunca fica no repositório: a bohr entrega o token só para execuções deste workflow, num push ou numa execução manual (`workflow_dispatch`) no branch de produção. Um pull request, outro branch ou outro workflow não recebe nada.
- O agente não pode editar workflows; a bohr escreve este ela mesma.

## Rodar de novo

Rode de novo uma execução que falhou no GitHub (**Re-run jobs**); a página [Builds](/pt-br/projects/builds/) tem o link de cada execução. Rodar de novo um push para o branch de produção recebe as credenciais outra vez.

## Mudar à mão

Edite o `.bohr/deploy.json` e deixe a próxima mudança do agente gerar o workflow de novo, ou peça direto ao agente: *"Mude o comando de build no .bohr/deploy.json para …"*. Se você precisar de um workflow que a bohr não consegue gerar, escreva o seu próprio `.github/workflows/bohr-deploy.yml` sem a primeira linha da bohr: a bohr não mexe nele. Ele ainda pode pegar as credenciais da Cloudflare com o [passo de credenciais](/pt-br/github-action/reference/#modo-credenciais), já que a bohr confere o caminho e o branch do workflow, não o conteúdo.
