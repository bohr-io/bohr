---
title: Exemplos
description: Workflows que usam a bohr-io/deploy-action@v1.
sidebar:
  order: 2
---

## Deploy de todos os branches de um projeto que a bohr hospeda

```yaml
name: Deploy
on: { push: { branches: ['**'] } }
permissions: { contents: read, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci && npm run build   # o build do próprio projeto
      - id: deploy
        uses: bohr-io/deploy-action@v1
      - run: echo "Deployed to ${{ steps.deploy.outputs.url }}"
```

## Um projeto numa subpasta

```yaml
      - run: npm ci && npm run build
        working-directory: apps/web
      - uses: bohr-io/deploy-action@v1
        with:
          working-directory: apps/web
```

## Uma instância auto-hospedada

```yaml
      - uses: bohr-io/deploy-action@v1
        with:
          instance-url: https://bohr.example.com
```

## Credenciais para o wrangler (projetos na sua própria conta)

Esta é a parte do workflow que a bohr escreve para você ([workflow completo](/pt-br/deploys/deploy-workflow/)). O arquivo precisa ser `.github/workflows/bohr-deploy.yml`, rodando em pushes para o branch de produção:

```yaml
permissions: { contents: read, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
      - name: bohr credentials
        id: bohr-credentials
        uses: bohr-io/deploy-action@v1
        with:
          credentials: "true"
      - run: npm ci && npm run build   # vê as variáveis de build
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ steps.bohr-credentials.outputs.cloudflare-api-token }}
          CLOUDFLARE_ACCOUNT_ID: ${{ steps.bohr-credentials.outputs.cloudflare-account-id }}
```

## A CLI como um step simples

O mesmo deploy sem a action:

```yaml
      - id: bohr
        run: npx --yes bohr@latest deploy
      - run: echo "Deployed to ${{ steps.bohr.outputs.url }}"
```

Veja [Uso em CI](/pt-br/cli/ci/).
