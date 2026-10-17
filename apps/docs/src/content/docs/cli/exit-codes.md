---
title: Exit codes and errors
description: What each exit code and error code of the bohr CLI means, and what to do.
sidebar:
  order: 6
---

| Code | Meaning | What to do |
| --- | --- | --- |
| **0** | Done | — |
| **1** | Failed: the build, an upload, wrangler, a D1 migration, the instance, the network, or too many deploys in a few minutes | Read the message. Fix the build, or retry later for network errors and rate limits. |
| **2** | Wrong usage: an unknown option, options that do not go together, no branch on a detached HEAD, an invalid `.bohr/deploy.json` or `.bohr/project.json` | Fix the command or the file. |
| **3** | Not signed in, or the token was rejected (expired, revoked, malformed) | Run `bohr login`, or set `BOHR_TOKEN` to a valid token from **Account › Tokens**. |
| **4** | Project not found for this token, no address for that branch, or the folder is not a bohr v2 project | Check `bohr projects`, the token's projects, or run it in the right folder. |
| **5** | Not allowed: production without the owner role, a project in its owner's Cloudflare account without the owner role, a suspended project, a folder whose wrangler config names another Worker | Deploy a preview instead, push a branch for the project's workflow, or deploy production through the panel. |

## Error codes

With `--json`, `error.code` says exactly what happened:

| `error.code` | Exit | Meaning |
| --- | --- | --- |
| `usage` | 2 | Unknown command or option, or options that do not go together |
| `no_project` | 2 | No `--project`, no link and no GitHub remote: *"Which project? … Pass --project &lt;id&gt; (see "bohr projects"), or run "bohr link"."* |
| `no_branch` | 2 | Detached HEAD: pass `--branch` |
| `invalid_deploy_config` | 2 | `.bohr/deploy.json` is not valid JSON or breaks [its rules](/deploys/deploy-json/) |
| `invalid_link` | 2 | `.bohr/project.json` is invalid: run `bohr link` again |
| `not_signed_in` | 3 | No token: run `bohr login` or set `BOHR_TOKEN` |
| `invalid_token` | 3 | `BOHR_TOKEN` does not start with `bohr_` |
| `login_denied`, `login_expired` | 3 | `bohr login` was denied, or its code expired |
| `http_401` | 3 | The instance rejected the token (expired or revoked) |
| `project_not_found`, `http_404` | 4 | No project for this repository or id that this token can reach |
| `not_a_v2_project` | 4 | The folder is not a bohr v2 project (bohr v1 repositories included). Nothing was changed. |
| `no_address` | 4 | `bohr open`: the branch was never deployed |
| `own_account_not_allowed` | 5 | The project runs in its owner's Cloudflare account, and only its owners (admins of its organization) can deploy it from the CLI, previews included. Push a branch instead: its workflow deploys the production branch |
| `worker_mismatch` | 5 | `--prod`: the folder's wrangler config names another Worker than the project's site. Nothing was deployed |
| `own_account` | 5 | Only from CLI 4.0.0 and earlier, which could not deploy projects in their owner's Cloudflare account: update with `npx bohr@latest` |
| `production_not_allowed` | 5 | Production needs the owner role |
| `production_branch` | 5 | The production branch needs `--prod` |
| `production_on_v1` | 5 | bohr v1 still serves the production address: deploy previews until the repository's workflow moves it |
| `suspended`, `http_403` | 5 | The project is suspended, or the instance refused the action |
| `cancelled` | 1 | You answered no to the production question |
| `network_error` | 1 | The instance could not be reached |
| `rate_limited` | 1 | Too many deploys of a project in your own Cloudflare account in the last minutes (HTTP 429): wait a few minutes |
| `error`, `http_<status>` | 1 | Anything else: the build failed, an upload failed, wrangler or a D1 migration failed, Cloudflare refused the deploy… |

Messages are meant for people and may change; codes are stable.
