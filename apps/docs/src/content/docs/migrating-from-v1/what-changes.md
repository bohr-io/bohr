---
title: What changes for a v1 project
description: How a migrated project builds, deploys and is served while bohr hosts it.
sidebar:
  order: 2
---

## Deploys keep working

Your repository's v1 workflow runs `bohr-io/action` on every push, as before. That action now asks bohr v2 how to build the project (its **build plan**: the Node.js version, the install and build commands and the generated files bohr v2 needs), builds it, and deploys with [`bohr-io/deploy-action`](/github-action/reference/#build-plan-mode). The build plan lives in bohr, not in your repository.

- **Every pushed branch** is deployed to its own address: `<branch>-<repo>-<owner>.bohr.io`. The production branch gets `<repo>-<owner>.bohr.io` and your custom domains.
- **Build variables** are handed to the build when it runs; manage them in **Settings › Environment variables**. Pull requests never get them.
- **Static files are published as v1 published them**: files v1 left out (such as `node_modules/`, `.github/`, `package.json`, lockfiles and `.env` files) are still left out, and files of 24 MiB or more are skipped with a warning instead of failing the deploy.

## What the hosting supports

Projects bohr hosts are Workers with static assets in bohr's account:

- Static assets, `vars` and secrets ([site variables](/projects/variables/)). Other bindings (D1, KV, R2, Durable Objects…) and cron triggers are not available while bohr hosts the project; [move it](/migrating-from-v1/move-to-your-cloudflare/) to use them.
- [Password protection](/projects/password-protection/) is applied by bohr's edge.
- Domains stay as they were in v1. To change them, move the project to your account.

## The panel

- **Settings › Hosting** shows **Hosted by bohr** and the move.
- **Settings › Domains** lists your domains as **Live** or **Pending** (*Pending* while bohr v1 still serves an address).
- **Builds** shows the runs of your workflow.
- Without the agent, the project shows **Deploys only**. **Turn the agent on** adds the agent, the preview and approvals; the agent then runs in bohr's account too, until you move the project.

## The CLI

bohr v2's CLI is `bohr@2`. Your v1 workflow does not need it. Locally:

- `bohr deploy` publishes a preview of the current branch; `bohr deploy --prod` publishes production (owners only). See [bohr deploy](/cli/deploy/).
- While bohr v1 still serves your production address, production deploys come from your workflow (`production_on_v1`); previews work.
- v1 commands (`bohr dev`) and v1 options (`--no-install`, `--show-install`, `--show-build`) are gone.
- In a repository that still runs only on bohr v1, the CLI hands the command to bohr v1's CLI, so it deploys as it always did.
