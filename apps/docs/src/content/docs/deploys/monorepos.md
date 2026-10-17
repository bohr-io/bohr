---
title: Monorepos and working directories
description: Deploy a project that lives in a subfolder of its repository.
sidebar:
  order: 7
---

A project does not have to be at the repository root. Point `directory` in [`.bohr/deploy.json`](/deploys/deploy-json/) at the folder with the site's `package.json` and wrangler config:

```json
{
  "directory": "apps/web",
  "packageManager": "pnpm",
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm build"
}
```

- The deploy workflow runs every step (`install`, `build`, migrations and `deploy`) in that folder (`defaults.run.working-directory`).
- Workspace tools find the repository root from there: `pnpm install` in `apps/web` installs the whole workspace.
- bohr finds the production Worker's name in that folder's `wrangler.jsonc`.
- The [CLI](/cli/deploy/) reads `.bohr/deploy.json` at the repository root and deploys from `directory`, or from `--dir`.

`.bohr/deploy.json` and `.bohr/preview.json` themselves always live at the repository root.

## The preview

`.bohr/preview.json` commands run from the repository root. Change directory in the command when needed:

```json
{
  "install": "pnpm install",
  "command": "pnpm --filter web dev --host 0.0.0.0 --port 5173",
  "port": 5173
}
```

## One repository, one project

Each repository can be one bohr project. To deploy two sites from one repository, split them into two repositories, or deploy the second one yourself with its own workflow.
