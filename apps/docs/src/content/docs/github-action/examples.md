---
title: Examples
description: Workflows that use bohr-io/deploy-action@v1.
sidebar:
  order: 2
---

## Deploy every branch of a project bohr hosts

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
      - run: npm ci && npm run build   # the project's own build
      - id: deploy
        uses: bohr-io/deploy-action@v1
      - run: echo "Deployed to ${{ steps.deploy.outputs.url }}"
```

## A project in a subfolder

```yaml
      - run: npm ci && npm run build
        working-directory: apps/web
      - uses: bohr-io/deploy-action@v1
        with:
          working-directory: apps/web
```

## A self-hosted instance

```yaml
      - uses: bohr-io/deploy-action@v1
        with:
          instance-url: https://bohr.example.com
```

## Credentials for wrangler (projects in your own account)

This is the part of the workflow bohr writes for you ([full workflow](/deploys/deploy-workflow/)). The file must be `.github/workflows/bohr-deploy.yml`, running on pushes to the production branch:

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
      - run: npm ci && npm run build   # sees the build variables
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ steps.bohr-credentials.outputs.cloudflare-api-token }}
          CLOUDFLARE_ACCOUNT_ID: ${{ steps.bohr-credentials.outputs.cloudflare-account-id }}
```

## The CLI as a plain step

The same deploy without the action:

```yaml
      - id: bohr
        run: npx --yes bohr@latest deploy
      - run: echo "Deployed to ${{ steps.bohr.outputs.url }}"
```

See [CI usage](/cli/ci/).
