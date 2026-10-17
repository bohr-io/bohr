---
title: The deploy loop
description: How an AI agent should call the CLI, parse its JSON, react to exit codes, and when (not) to deploy production.
sidebar:
  order: 3
---

## 1. Find the project once

```sh
npx --yes bohr@latest projects --json
```

Match `repository` (`owner/name`) against the repository's GitHub remote and keep the project's `id`. Check:

- `mode`: `managed` means bohr hosts it; `byo` means it runs in its owner's Cloudflare account (see [below](#projects-in-your-own-cloudflare-account)). `bohr deploy` publishes both.
- `role`: `owner` is needed for production, and for any deploy of a `byo` project.

If the repository has `.bohr/project.json` (from `bohr link`), `--project` can be left out.

## 2. Deploy a preview after each change

```sh
npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch agent/fix-contact-form --json
```

- Pick a branch name that describes the change; it does not have to exist in git. Each branch gets its own address, so previews of different changes do not overwrite each other.
- The CLI runs `.bohr/deploy.json`'s install and build first. Pass `--no-build` only when the agent already built the site in the same environment.
- Read the result from stdout, and show `url` to the person.

```json
{ "ok": true, "url": "https://agent-fix-contact-form-shop-acme.bohr.io", "branch": "agent/fix-contact-form", "production": false, "...": "…" }
```

Full schema: [JSON output](/cli/json-output/#bohr-deploy).

## 3. React to the exit code

| Exit | The agent should |
| --- | --- |
| 0 | Report `url`. |
| 1 | Read `error.message` (and stderr). Fix a build error and retry **once**. For `network_error`, wait and retry once. |
| 2 | Fix the command or the file the message names. `no_branch`: pass `--branch`. |
| 3 | **Stop** and ask the person for a valid `BOHR_TOKEN`. Do not run `bohr login`. |
| 4 | Re-check `projects --json`. `not_a_v2_project`: stop and tell the person; the folder is not a bohr v2 project. |
| 5 | **Do not retry.** Explain why (`own_account_not_allowed`, `production_not_allowed`, `production_on_v1`, `worker_mismatch`, `suspended`) and deploy a preview instead when that makes sense. |

All codes: [Exit codes and errors](/cli/exit-codes/).

## Preview vs production etiquette

- **Previews are the default** and safe: they never touch production. Deploy one whenever you want the person to see a change.
- **Production only on an explicit request** in the current conversation, such as *"deploy it to production"*. A previous approval, a passing build or a merged branch is not a request.
- Before `--prod`, say what will be published. `--prod` from an agent runs without the confirmation question, so the agent is the last check.
- Never deploy production to fix a production problem without asking; deploy a preview of the fix first.
- Do not run `bohr deploy` in a loop. One deploy per meaningful change.

## Projects in your own Cloudflare account

`bohr deploy` deploys projects in their owner's Cloudflare account (`mode: "byo"`) with wrangler, using the Cloudflare token their owner connected to bohr ([details](/cli/deploy/#projects-in-your-own-cloudflare-account)). The same loop works, with these differences:

- **Only an owner's token** can deploy them, previews included. With anyone else's, the CLI exits with code 5 and `error.code: "own_account_not_allowed"` before building anything. Then the agent should commit its change to a new branch, push it, open a pull request to the production branch and let a person review and merge it; the project's workflow deploys the production branch. Never push to the production branch directly. The person can also ask bohr's own agent, in the panel or on Telegram, for the change: it comes with a preview to approve.
- A preview is a new Worker version under an alias of the branch; it never changes production. If `url` is `null`, the Worker has no preview URLs (`"preview_urls": true` in its wrangler config): tell the person.
- **Previews use production's D1 databases** and apply no migrations. Ask before deploying a preview that writes data or depends on a schema change.
- `--prod` applies the D1 migrations, then deploys. `worker_mismatch` (exit code 5) means the folder's wrangler config names another Worker: nothing was deployed.
- `error.code: "own_account"` comes only from CLI 4.0.0 and earlier: run `npx --yes bohr@latest`.
