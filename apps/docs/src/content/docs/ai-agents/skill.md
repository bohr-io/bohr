---
title: SKILL.md for agents
description: A skill file in the Claude Code skill format with everything an AI agent needs to deploy bohr projects.
sidebar:
  order: 5
---

A **skill** is an instruction file an agent loads only when it needs it. This one follows the Claude Code skill format (a folder with a `SKILL.md` that starts with a `name` and a `description`); other agents can read it as plain instructions.

**Download:** [SKILL.md](/downloads/bohr-deploy/SKILL.md).

## Install it

For Claude Code, put it in a `bohr-deploy` folder of your skills. The command downloads it to a temporary file and only installs it if it really is the bohr skill (it starts with `---` and `name: bohr-deploy`), so a failed or wrong download never replaces a skill you have:

```sh
# for one repository (commit it so your team gets it too); for every project on your computer,
# use dir=~/.claude/skills/bohr-deploy instead
dir=.claude/skills/bohr-deploy
tmp=$(mktemp)
if curl -fsSL https://docs.bohr.io/downloads/bohr-deploy/SKILL.md -o "$tmp" &&
  [ "$(head -n 2 "$tmp")" = "$(printf '%s\n%s' '---' 'name: bohr-deploy')" ]; then
  mkdir -p "$dir" && mv "$tmp" "$dir/SKILL.md" && echo "Installed $dir/SKILL.md"
else
  rm -f "$tmp"; echo "The download is not the bohr skill: nothing was installed." >&2
fi
```

Other agents: save it anywhere and point to it from your instructions file, or paste it into the agent's instructions.

## The file

<!-- download:start -->

````markdown
---
name: bohr-deploy
description: Deploy a bohr project (bohr.io) with the bohr CLI. Use when the user asks to deploy, publish, preview or ship a site that deploys with bohr, when the repository has a .bohr/ folder (.bohr/deploy.json, .bohr/project.json), or when BOHR_TOKEN is set.
---

# Deploying bohr projects

bohr (https://docs.bohr.io) deploys GitHub repositories as Cloudflare Workers. The `bohr` CLI (npm package `bohr`, Node.js 20+) deploys a project from this machine: previews of any branch, and production for project owners.

## Rules

1. Use only the bohr CLI to deploy, always non-interactively and with `--json`:
   `npx --yes bohr@latest <command> --json`
   stdout is exactly one JSON object. Logs and build output go to stderr.
2. Authenticate with the `BOHR_TOKEN` environment variable. Never print, log, commit or echo the token, and never put it in a command line. If it is missing, ask the user to create one in the bohr panel (Account › Tokens), limited to this project, and to set it as `BOHR_TOKEN`.
3. Deploy **previews** by default. Deploy **production** (`--prod`) only when the user explicitly asked for a production deploy in this conversation.
4. Never commit secrets or `.env` files. Put secrets in the bohr panel (Settings › Environment variables), not in `wrangler.jsonc`.
5. Do not edit `.github/workflows/bohr-deploy.yml` (bohr generates it from `.bohr/deploy.json`).

## Steps

### 1. Find the project (once per session)

```sh
npx --yes bohr@latest projects --json
```

Pick the project whose `repository` (`owner/name`) matches this repository's GitHub remote. Remember its `id`.

- `mode: "managed"`: bohr hosts it; `bohr deploy` publishes it.
- `mode: "byo"`: it runs in its owner's Cloudflare account; `bohr deploy` publishes it with wrangler, for owners only (see "Projects in the owner's Cloudflare account").
- `role: "owner"` is required for production, and for any deploy of a `byo` project.

Alternatively, if the repository has `.bohr/project.json`, the CLI already knows the project and `--project` can be left out.

### 2. Deploy a preview after each change

```sh
npx --yes bohr@latest deploy --project <id> --branch <branch> --json
```

- Use a descriptive branch name, for example `agent/<short-description>`. It does not need to exist in git.
- The CLI runs the install and build from `.bohr/deploy.json` first. Add `--no-build` only if you already built the site in this environment.
- On success, read `url` and give it to the user. Also useful: `deploymentId`, `files`, `uploadedFiles`.

Example success:

```json
{"ok":true,"url":"https://agent-fix-form-shop-acme.bohr.io","deploymentId":"d_…","project":{"id":"p3k9x0a7qd2m","name":"shop"},"branch":"agent/fix-form","production":false,"files":42,"bytes":1363148,"uploadedFiles":3,"uploadedBytes":20480,"modules":1}
```

### 3. Production (only when asked)

```sh
npx --yes bohr@latest deploy --project <id> --prod --json
```

## Handling the result

On failure stdout is `{"ok":false,"error":{"code","message","exitCode"}}` and the process exits with `exitCode`. Branch on the exit code and `error.code`:

| Exit | Meaning | Do |
| --- | --- | --- |
| 0 | Done | Report `url`. |
| 1 | Failed (build, upload, wrangler, D1 migration, network, instance, `rate_limited`) | Read `error.message` and the stderr log. Fix a build error and retry once. For `network_error`, retry once after a short wait. For `rate_limited`, stop and tell the user to wait a few minutes. |
| 2 | Wrong usage (`usage`, `no_project`, `no_branch`, `invalid_deploy_config`, `invalid_link`) | Fix the command or the file named in the message. For `no_branch`, pass `--branch`. |
| 3 | Not signed in or token rejected (`not_signed_in`, `invalid_token`, `http_401`) | Stop. Ask the user for a valid `BOHR_TOKEN`. Do not try `bohr login` (it needs a person and a browser). |
| 4 | Not found (`project_not_found`, `not_a_v2_project`, `no_address`) | Re-check `projects --json` and the token's projects. `not_a_v2_project` means this folder is not a bohr v2 project (maybe a bohr v1 repository): stop and tell the user. |
| 5 | Not allowed (`own_account_not_allowed`, `production_not_allowed`, `production_on_v1`, `worker_mismatch`, `suspended`, `http_403`, `own_account`) | Do not retry. Tell the user why. For `production_not_allowed` or `production_on_v1`, deploy a preview instead. For `own_account_not_allowed`, see below. `own_account` comes only from an outdated CLI: run `npx --yes bohr@latest`. |

## Projects in the owner's Cloudflare account (`mode: "byo"`)

`bohr deploy` deploys them with wrangler, using the Cloudflare token their owner connected to bohr. The result has `"mode": "byo"`, plus `versionId`, `previewUrl`, `workerName` and `commitSha` (the upload counts are `null`).

- Only the project's owners (admins of its organization) can deploy them, previews included. Anyone else gets exit code 5 with `own_account_not_allowed`: do not push to the production branch yourself; commit your change to a branch, push it, open a pull request to the production branch, and let a person review and merge it. The project's own bohr agent (in the bohr panel or on Telegram) can also make the change with a preview.
- A preview uploads a new Worker version and never changes production. If `url` is `null`, the Worker has no preview URLs: tell the user to set `"preview_urls": true` in its wrangler config.
- Previews use the **production D1 databases** and apply no D1 migrations. Ask the user before deploying a preview that writes data or depends on a schema change.
- `--prod` applies the D1 migrations, then deploys. `worker_mismatch` means the folder's wrangler config names another Worker than the project's: nothing was deployed; tell the user.

## Useful files

- `.bohr/deploy.json`: how production builds (`directory`, `node`, `packageManager`, `install`, `build`, `deploy`, `secrets`).
- `.bohr/preview.json`: how the preview's dev server runs (`install`, `command`, `port`, `env`).
- `wrangler.jsonc`: the Worker. Projects bohr hosts support static assets, `vars` and secrets only; other bindings make the deploy fail.
- Static files over 25 MiB cannot be deployed. `.git` and `.env*` files are never published.

Docs: https://docs.bohr.io/ai-agents/overview/ (Markdown: https://docs.bohr.io/llms.txt)
````

<!-- download:end -->
