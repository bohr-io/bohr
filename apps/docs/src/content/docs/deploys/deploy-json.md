---
title: .bohr/deploy.json
description: Reference of the file that describes how bohr builds and deploys production.
sidebar:
  order: 3
---

`.bohr/deploy.json` tells bohr how to build and deploy your production site. The agent writes it when it prepares the repository and keeps it working; you can edit it too. bohr generates [the deploy workflow](/deploys/deploy-workflow/) from it, and the [CLI](/cli/deploy/) runs its `install` and `build` before deploying.

```json
{
  "directory": ".",
  "node": "24",
  "packageManager": "npm",
  "install": "npm ci",
  "build": "npm run build"
}
```

## Fields

| Field | Default | Description |
| --- | --- | --- |
| `directory` | `"."` | Folder with the project's `package.json` and wrangler config, relative to the repository root. `"."` or a relative path like `"apps/web"`: no `..`, no folders starting with a dot. |
| `node` | `"24"` | Node.js major version for the build, two digits (`"22"`, `"24"`). |
| `packageManager` | `"npm"` | `npm`, `pnpm`, `yarn` or `bun`. `pnpm` and `yarn` come from Corepack; `bun` is set up with `oven-sh/setup-bun`. |
| `python` | — | Python version when the build needs it (Python Workers), like `"3.12"`. |
| `install` | — | Installs dependencies, e.g. `"npm ci"`. Omit to skip. |
| `build` | — | Builds production, e.g. `"npm run build"`. Omit to skip. |
| `deploy` | `"npx wrangler deploy"` | Deploys the build to your Cloudflare account. Keep the default unless the framework needs its own command (for example `"npx opennextjs-cloudflare deploy"`): [password protection](/projects/password-protection/) only applies with the default. |
| `secrets` | `[]` | Names of **GitHub repository secrets** the install and build steps need, e.g. `["SENTRY_AUTH_TOKEN"]`. Up to 50. |

### Rules for commands

`install`, `build` and `deploy` are single shell lines of up to 500 characters, without line breaks and without GitHub expressions (`${{ … }}`). Chain commands with `&&`.

### Rules for secrets

Names use `A-Z`, `0-9` and `_`. Names starting with `GITHUB_` (reserved by GitHub) or `CLOUDFLARE_` (the Cloudflare credentials only go to the deploy step, which bohr writes) are refused.

You rarely need `secrets`: prefer [build variables](/projects/variables/#build-variables), which you set in the bohr panel and which reach install and build without touching your repository's settings. Use `secrets` for values you already keep as GitHub Actions secrets.

## When it is invalid

If the file has a problem, the deploy workflow is not updated and the chat says: *"The file .bohr/deploy.json has a problem (…), so the production deploy was not updated. Ask me to fix it."* The CLI stops with `.bohr/deploy.json is invalid: …` (exit code 2).

## Examples

A static site built with Vite:

```json
{ "install": "npm ci", "build": "npm run build" }
```

A pnpm monorepo app:

```json
{
  "directory": "apps/web",
  "packageManager": "pnpm",
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm build"
}
```

Next.js with OpenNext:

```json
{
  "node": "22",
  "install": "npm ci",
  "build": "npx opennextjs-cloudflare build",
  "deploy": "npx opennextjs-cloudflare deploy"
}
```
