---
title: The deploy workflow
description: The GitHub Actions workflow bohr writes from .bohr/deploy.json, step by step.
sidebar:
  order: 2
---

bohr writes `.github/workflows/bohr-deploy.yml` from [`.bohr/deploy.json`](/deploys/deploy-json/), from a fixed template. **Change `.bohr/deploy.json`, not the workflow**: bohr rewrites the workflow whenever the agent's work changes the deploy settings, and its first line says so:

```yaml
# Written by bohr from .bohr/deploy.json. Change that file instead: bohr rewrites this one.
```

bohr only replaces a `bohr-deploy.yml` that starts with that line. A workflow your team wrote under that name keeps deploying as it is.

## What it looks like

For `{"install": "npm ci", "build": "npm run build"}` on the production branch `main` (long scripts shortened):

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
        # loads build variables older versions of bohr kept as BOHR_BUILD_<NAME> Actions secrets
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
        # only when the wrangler config has D1 databases with a migrations_dir
      - name: Deploy
        # wraps the site in the password gate, then:
        # npx wrangler deploy --message "bohr" --tag "bohr-${GITHUB_SHA::12}"
        env:
          CLOUDFLARE_API_TOKEN: ${{ steps.bohr-credentials.outputs.cloudflare-api-token }}
          CLOUDFLARE_ACCOUNT_ID: ${{ steps.bohr-credentials.outputs.cloudflare-account-id }}
```

## The steps

| Step | What it does |
| --- | --- |
| Trigger | Only pushes to the production branch. Pushes there only come from approved merges, rollbacks, or people with write access. |
| `concurrency` | One deploy at a time; a new push waits for the running one instead of cancelling it. |
| `permissions` | `contents: read` and `id-token: write` (to request the GitHub OIDC token). Nothing else. |
| Setup | `oven-sh/setup-bun@v2` when the package manager is `bun`; `actions/setup-node@v5` with the `node` version; `actions/setup-python@v6` when `python` is set; `corepack enable` for `pnpm` and `yarn`. |
| **bohr credentials** | [`bohr-io/deploy-action@v1`](/github-action/reference/#credentials-mode) with `credentials: "true"`: asks bohr for the project's [build variables](/projects/variables/#build-variables) (exported, masked, for the next steps) and the Cloudflare token and account (step outputs, for the deploy step only). Self-hosted instances add their `instance-url`. |
| **Install**, **Build** | Your commands, in `directory`. The repository secrets listed in `secrets` are passed to these two steps only. |
| **D1 migrations** | `npx wrangler d1 migrations apply <binding> --remote` for each D1 database with a `migrations_dir`. See [D1 databases](/deploys/d1-databases/). |
| **Deploy** | With the default command, wraps the site in the [password gate](/projects/password-protection/) and runs `npx wrangler deploy`. A custom `deploy` command runs as it is. The Cloudflare token reaches this step (and the migrations) only. |

## Why it is safe

- The commands are single lines without GitHub expressions (`${{ }}`), so they cannot read other secrets or contexts.
- The Cloudflare token never lives in the repository: bohr hands it only to runs of this workflow, on a push or a manual run (`workflow_dispatch`) on the production branch. A pull request, another branch or another workflow gets nothing.
- The agent cannot edit workflows; bohr writes this one itself.

## Running it again

Re-run a failed run on GitHub (**Re-run jobs**); the [Builds](/projects/builds/) page links to each run. A re-run of a push to the production branch gets the credentials again.

## Changing it by hand

Edit `.bohr/deploy.json` and let the agent's next change regenerate the workflow, or ask the agent directly: *"Change the build command in .bohr/deploy.json to …"*. If you need a workflow bohr cannot generate, write your own `.github/workflows/bohr-deploy.yml` without bohr's first line: bohr leaves it alone. It can still get the Cloudflare credentials with the [credentials step](/github-action/reference/#credentials-mode), since bohr checks the workflow's path and branch, not its contents.
