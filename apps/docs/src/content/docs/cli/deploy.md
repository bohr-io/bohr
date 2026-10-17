---
title: bohr deploy
description: Build and deploy a folder as a preview of a branch, or as production with --prod.
sidebar:
  order: 3
---

```sh
bohr deploy [--prod] [--branch <name>] [--project <id>] [--dir <path>] [--no-build] [--yes] [--json] [--instance <url>]
```

Builds the project and publishes it. **Previews by default**; production only with `--prod`.

## Options

| Option | Description |
| --- | --- |
| `--prod` | Deploy production (project owners only). |
| `--branch <name>` | The preview's branch. Default: the checked-out branch. |
| `--project <id>` | The project id (see `bohr projects`). Default: the folder's link, or the GitHub remote. |
| `--dir <path>` | Folder with the wrangler config. Default: `directory` from `.bohr/deploy.json`, or the current folder. |
| `--no-build` | Deploy what is already built: skip `.bohr/deploy.json`'s install and build. |
| `-y`, `--yes` | Do not ask before deploying production. |
| `--json` | Print one JSON object with the result ([schema](/cli/json-output/#bohr-deploy)). |
| `--instance <url>` | The bohr instance. Default: `BOHR_INSTANCE_URL`, the folder's link, or `https://app.bohr.io`. |
| `-h`, `--help` | Show the command's help. |

## What it does

1. **Which project**: `--project <id>`, else the folder's link (`.bohr/project.json`, written by [`bohr link`](/cli/commands/#bohr-link)), else the project of the repository's GitHub remote (`origin`).
2. **Which branch**: `--branch`, else the checked-out branch. On the **production branch** without `--prod`, it publishes a preview on `<production branch>-preview` instead, and says so.
3. **Build**: runs `install` and `build` from [`.bohr/deploy.json`](/deploys/deploy-json/) in its folder, unless `--no-build`. Your environment is the build's: build variables kept in bohr are not downloaded. It warns when your Node.js major version differs from `node`, or when a name in `secrets` is not set.
4. **Bundle**: the Worker is bundled with `wrangler deploy --dry-run` (needs no Cloudflare credentials). Add `wrangler` to your `devDependencies` to pin its version.
5. **Upload**: static files are hashed like wrangler does; only new or changed files are uploaded.
6. **Publish**: the URL is printed on stdout. Progress goes to stderr.

Steps 3 to 6 are those of a project **bohr hosts**. A project in its owner's Cloudflare account builds with its build variables and deploys with wrangler instead: see [Projects in your own Cloudflare account](#projects-in-your-own-cloudflare-account).

```console
$ bohr deploy
Deploying a preview of feature/new-menu of my-site (p3k9x0a7qd2m) on https://app.bohr.io.
…
42 files (1.3 MiB), 3 uploaded; 1 Worker module.
https://feature-new-menu-my-site-acme.bohr.io
```

## Production

```sh
bohr deploy --prod
```

- Only the project's **owners** (admins of its organization) may deploy production. Others get exit code 5 (`production_not_allowed`).
- At a terminal, the CLI asks `Deploy this folder to production (…)? [y/N]` (`… in the owner's Cloudflare account? [y/N]` for a project there). `--yes` skips the question; without a terminal, or with `--json`, it never asks: `--prod` itself is the confirmation.
- `--prod` with `--branch` other than the production branch is a usage error.
- A project whose production address bohr v1 still serves is left to its repository's workflow, whose first production deploy moves the address (`production_on_v1`, exit code 5). Deploy previews until then.

## Nothing goes down

What is served only changes once every file is uploaded and Cloudflare accepted the new version. Any failure before that leaves the previous version online. The final step is never retried, so a deploy cannot publish twice. For projects in your own Cloudflare account, see [below](#never-takes-a-site-down).

## What is never published

`.git` and `.env` files or folders (`.env`, `.env.production`…), at any depth, whatever `.assetsignore` says. Each skipped `.env` is reported with a warning.

## Which projects

`bohr deploy` publishes both kinds of bohr v2 projects:

- **Projects bohr hosts** (migrated from bohr v1) go up through bohr's upload path, as described above.
- **Projects in their owner's Cloudflare account** are deployed by wrangler into that account, [as described below](#projects-in-your-own-cloudflare-account). Only their owners can deploy them from the CLI.

CLI 4.0.0 and earlier refused the second kind with exit code 5 (`own_account`). If you see that code, update the CLI: `npx bohr@latest`.

A folder that is not a bohr v2 project (no wrangler config, no `.bohr/project.json`, no `.bohr/deploy.json`) stops with *"This repository is not a bohr v2 project"* (exit code 4); repositories still on bohr v1 are recognized, and their command goes to bohr v1's CLI unchanged.

## Projects in your own Cloudflare account

A project in its owner's Cloudflare account (`own account` in [`bohr projects`](/cli/commands/#bohr-projects), `mode: "byo"` in its JSON) is deployed with wrangler, in that account, much like its [deploy workflow](/deploys/deploy-workflow/) does. It needs CLI 4.1.0 or later, Node.js 20 or later and `npx`.

### Who can deploy

Only the project's **owners** (for an organization's project: the organization's admins) can deploy it from the CLI, **previews included**: wrangler deploys it with the Cloudflare API token its owner connected to bohr. Members get exit code 5 (`own_account_not_allowed`); they push a branch instead, and the project's workflow deploys the production branch. The token (`BOHR_TOKEN` or `bohr login`) must also reach the project: a token limited to some projects must list it.

### What runs

1. **Credentials**: the CLI asks the instance for the owner's Cloudflare API token and account id, for this deploy only.
2. **Build**: unless `--no-build`, the `install` and `build` commands of [`.bohr/deploy.json`](/deploys/deploy-json/) run with the project's [build variables](/projects/variables/#build-variables) kept in bohr in their environment (for the deployed branch: the project-wide values, overridden by the branch's). The build never gets the Cloudflare token or `BOHR_TOKEN`.
3. **Protection**: when `.bohr/deploy.json` uses the default `deploy` command, bohr's protection gate wraps the site as in the deploy workflow, so [password protection](/projects/password-protection/) covers previews too.
4. **wrangler**: the project's own wrangler when it has one installed, otherwise `npx wrangler@4.149.0`. Previews need wrangler 4.21.0 or later (it added preview aliases): with an older wrangler in the project, previews run 4.149.0.

### Previews

```sh
bohr deploy
```

uploads a new version of the Worker with `wrangler versions upload --preview-alias <alias> --message "bohr" --tag "bohr-<commit>"`. A version upload **never changes what production serves**.

- The alias comes from the branch: lowercase letters, digits and dashes, starting with a letter, shortened so that `<alias>-<worker>` fits in a 63-character DNS label.
- The URL printed is the alias's preview URL, else the version's own preview URL.
- Previews have an address only when the Worker has preview URLs turned on (`"preview_urls": true` in its wrangler config). Without them, the CLI warns and prints the version it uploaded instead (`url` is `null` in the [JSON](/cli/json-output/#bohr-deploy)).

:::caution[D1 in previews]
A preview version has the same bindings as production: its [D1 databases](/deploys/d1-databases/) **are production's databases**, and D1 migrations are not applied for previews. A preview of a schema change runs against production's current schema and data. Be careful with previews that write data or that depend on a migration.
:::

### Production

```sh
bohr deploy --prod
```

1. At a terminal it asks `Deploy this folder to production (…) in the owner's Cloudflare account? [y/N]`; `--yes` skips the question, and without a terminal or with `--json`, `--prod` itself is the confirmation.
2. **D1 migrations**, as in the deploy workflow: `wrangler d1 migrations apply <binding> --remote` for each D1 database in `wrangler.jsonc` (or `wrangler.json`) that declares a `migrations_dir` the folder has.
3. **Deploy**: `wrangler deploy --message "bohr" --tag "bohr-<commit>"`. If `.bohr/deploy.json` has a custom `deploy` command, production runs that command instead, with the credentials in its environment, and the protection gate is not added (like the workflow).

bohr reads the Worker's name from the wrangler config on the production branch. If the folder's wrangler config names a different Worker, `--prod` stops before deploying with exit code 5 (`worker_mismatch`); a preview only warns.

### Never takes a site down

- A preview never touches production.
- If a D1 migration fails, the Worker is not deployed: production keeps serving the previous version.
- If `wrangler deploy` fails, Cloudflare keeps serving the previous version.

### Commit and tag

The tag is `bohr-<the commit's first 12 characters>` when the working tree has no uncommitted changes to tracked files. Otherwise it is `bohr-local`, and no commit is recorded with the deploy.

### Credentials and secrets

- The Cloudflare token goes only into the environment of the wrangler processes (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). It is never printed, logged, put on a command line or written to disk, and error messages show it as `***`. In GitHub Actions it is also masked with `::add-mask::`.
- Every time the instance hands out the credentials, its audit log records the user, the token and the project. At most 30 per user and project in 10 minutes; past that the instance answers HTTP 429 (exit code 1): wait a few minutes.
- bohr hands out only the owner's own Cloudflare connection, never the token of bohr's own account, and never for projects bohr hosts (those keep deploying through bohr's upload path).

### History

The CLI records each deploy in bohr: branch, production or preview, Worker name, version id, URL and commit (`deploymentId` in the JSON). If recording fails, the deploy still succeeded and the CLI only warns. The panel does not show these records yet; project members can read them from the instance's API (`GET /api/projects/<id>/cli-deploys`). The Cloudflare dashboard also lists the Worker's versions, with the message `bohr` and the `bohr-…` tag.
