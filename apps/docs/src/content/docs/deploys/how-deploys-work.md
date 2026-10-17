---
title: How deploys work
description: How a bohr project builds and publishes to Cloudflare, and the files that describe it.
sidebar:
  order: 1
---

A bohr project's production site is a **Cloudflare Worker with static assets**. It is built and published by **GitHub Actions**, from the production branch, after every approved change.

```
.bohr/deploy.json ──(bohr writes)──▶ .github/workflows/bohr-deploy.yml
                                            │ on push to the production branch
                                            ▼
               checkout → setup Node.js → bohr credentials (OIDC) → install → build
                                            │
                                            ▼
                       D1 migrations (if any) → wrangler deploy → your Cloudflare account
```

## The files

| File | Who writes it | What it says |
| --- | --- | --- |
| [`.bohr/deploy.json`](/deploys/deploy-json/) | The agent (you can edit it) | How to build production: folder, Node.js version, package manager, install, build and deploy commands |
| [`.github/workflows/bohr-deploy.yml`](/deploys/deploy-workflow/) | bohr, from `.bohr/deploy.json` | The GitHub Actions workflow that runs on pushes to the production branch |
| [`wrangler.jsonc`](/deploys/wrangler-config/) | The agent or you | The Worker: its name, entry point, static assets, bindings |
| [`.bohr/preview.json`](/deploys/preview-json/) | The agent (you can edit it) | How the preview runs the dev server in the sandbox |

## What triggers a deploy

- **Approving a preview**: bohr merges `homolog` into the production branch; the push runs the workflow.
- **Rolling back**: the revert is merged; same thing.
- **Any push to the production branch**, by you or another tool.
- **`bohr deploy --prod`** from the [CLI](/cli/deploy/#projects-in-your-own-cloudflare-account), by a project owner.

In GitHub Actions, only the production branch deploys. The agent's preview is not a deploy: it is the dev server in the agent's sandbox. Owners can also upload preview versions of any branch with `bohr deploy`; those never change production.

## Credentials

No Cloudflare token is stored in your repository. When the workflow runs, its first bohr step asks the bohr instance for your Cloudflare credentials and the project's [build variables](/projects/variables/#build-variables), proving who it is with a **GitHub OIDC token**. bohr only answers runs of `bohr-deploy.yml` on a push (or manual run) to the production branch of a project in its owner's account. See [Security model](/reference/security/#deploy-credentials).

## Never taking the site down

`wrangler deploy` uploads the new version and switches to it in one step. If the build or the deploy fails, production keeps serving the previous version, and the chat links to the failed run.

## Projects hosted by bohr

Projects migrated from bohr v1 deploy differently: their v1 workflow keeps working and publishes to bohr's hosting, and every pushed branch gets its own address. They can also be deployed with the [CLI](/cli/deploy/). See [Migrating from bohr v1](/migrating-from-v1/what-changes/).
