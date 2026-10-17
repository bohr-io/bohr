---
title: bohr-io/deploy-action reference
description: Inputs, outputs and modes of the bohr-io/deploy-action@v1 GitHub Action.
sidebar:
  order: 1
---

`bohr-io/deploy-action@v1` deploys bohr projects from GitHub Actions. It is a thin wrapper that runs the latest [bohr CLI](/cli/install/) (`npx --yes bohr@latest action`) with the inputs below. It signs in to bohr with the run's **GitHub OIDC token**, so the job needs:

```yaml
permissions:
  contents: read
  id-token: write
```

It has three modes:

| Mode | Input | Used by | What it does |
| --- | --- | --- | --- |
| **Deploy** (default) | — | Projects bohr hosts | Uploads the built Worker and static assets to bohr's hosting, for the pushed branch |
| **Credentials** | `credentials: "true"` | Projects in your own Cloudflare account (in the workflow bohr writes) | Gets the Cloudflare credentials and build variables for `wrangler deploy`; deploys nothing |
| **Build plan** | `build-plan: "true"` | Projects migrated from bohr v1 that keep their v1 workflow | Gets the project's build plan; deploys nothing |

You rarely add the action yourself: bohr writes it into [`bohr-deploy.yml`](/deploys/deploy-workflow/) for projects in your account, and migrated projects run it through their v1 workflow.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `instance-url` | `https://app.bohr.io` | Base URL of the bohr instance that manages the project. Must use `https`. |
| `working-directory` | `.` | Folder that holds the project's `wrangler.jsonc` (or `wrangler.json`), relative to the repository root. Deploy mode. |
| `credentials` | `false` | `"true"`: only get the deploy credentials and build variables of a project in its owner's account. |
| `build-plan` | `false` | `"true"`: only prepare the build of a project migrated from bohr v1. |
| `phase` | `prepare` | With `build-plan: "true"`: the step to run. Only `prepare` exists. |

`credentials` and `build-plan` cannot both be `"true"`.

## Outputs

| Output | Mode | Description |
| --- | --- | --- |
| `url` | Deploy | URL where the deployed branch is served |
| `deployment-id` | Deploy | Identifier of the deployment on the bohr instance |
| `cloudflare-api-token` | Credentials | The Cloudflare API token to deploy with (masked) |
| `cloudflare-account-id` | Credentials | The Cloudflare account to deploy to (masked) |
| `found` | Build plan | `"true"` when bohr has a build plan for this repository, else `"false"` |
| `node-version` | Build plan | The Node.js version for `actions/setup-node` |
| `install` | Build plan | The install command (empty: none) |
| `build` | Build plan | The build command (empty: none) |
| `live` | Build plan | `"true"` when the project's production address already moved to bohr v2 |

In deploy mode the job summary shows the URL and how many files were found and uploaded.

## Deploy mode

Run your build before the action: it deploys what the build wrote, and does not install dependencies or build. Every pushed branch is deployed to its own address; the production branch gets the project's main address.

The action reads `wrangler.json` or `wrangler.jsonc` in `working-directory`, bundles `main` with `wrangler deploy --dry-run` (add `wrangler` to your `devDependencies` to pin it), and uploads only new or changed static files. Hosted projects support static assets, `vars` and secrets: see [Wrangler config](/deploys/wrangler-config/#projects-hosted-by-bohr).

## Credentials mode

With `credentials: "true"` the action asks bohr for the credentials (`POST <instance-url>/api/deploy/credentials` with the OIDC token), masks every value, and then:

- exports the project's [build variables](/projects/variables/#build-variables) (production branch) to the environment of the next steps, so install and build see them;
- sets the Cloudflare token and account as the step's outputs, so only the step that maps them (the deploy) gets them.

bohr answers only runs of `.github/workflows/bohr-deploy.yml` on a `push` (or `workflow_dispatch`) to the project's production branch, for a project in its owner's Cloudflare account. It hands out the owner's own token (yours, or your organization's), never bohr's.

## Build plan mode

For repositories migrated from bohr v1 that keep their workflow (`.github/workflows/bohr.yml` running `bohr-io/action@main`). bohr v1's action calls this one twice: to prepare (`build-plan: "true"`), then to deploy. Nothing is written into your repository. See [Migrating from bohr v1](/migrating-from-v1/what-changes/).

## Errors

| Error | Fix |
| --- | --- |
| `Could not get a GitHub OIDC token` | Add `permissions: id-token: write` to the workflow or the job. Workflows triggered from forks never get OIDC tokens. |
| `No bohr.io Cloud managed project matches this repository and branch` | Create or migrate the project in the bohr panel, and deploy on branch pushes (not tags or pull requests). |
| `could not give the deploy credentials (HTTP 403)` | Credentials mode: the message says why. Only `bohr-deploy.yml` on a push to the production branch of a project in its owner's account gets them. |
| `Found wrangler.toml, but this action reads wrangler.jsonc` | Convert the config to `wrangler.jsonc`. |
| `… is not supported` | Remove the binding; hosted projects support static assets, vars and secrets. |
| `The assets directory … does not exist` | Run the build before the action, or fix `assets.directory`. |
| `Asset too large: …` | Files over 25 MiB cannot be deployed: remove it or list it in `.assetsignore`. |
