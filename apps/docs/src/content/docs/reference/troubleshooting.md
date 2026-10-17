---
title: Troubleshooting
description: Common errors, with the exact messages bohr shows, and how to fix them.
sidebar:
  order: 2
---

## Sign-in

| Message | Fix |
| --- | --- |
| *This instance is not set up yet* | Self-hosted: the administrator must finish `/setup` ([GitHub App](/self-hosting/github-app/)). |
| *Too many attempts. Wait a few minutes and try again.* | Too many email codes or wrong codes. Wait about 15 minutes. |
| *The code expired or was entered wrong too many times. Ask for a new code.* | Codes last 10 minutes and allow 5 attempts. |
| *This email already belongs to another bohr account.* | Sign in with that account instead, or use another address. |

## Connecting Cloudflare

| Message | Fix |
| --- | --- |
| *That does not look like a Cloudflare API token.* | Copy the whole token, without spaces. |
| *Cloudflare did not accept this token.* / *This token is …* | The token is invalid, expired or disabled. Create another one. |
| *The token lacks some permissions* | Edit the token and add what is listed. See [Connect Cloudflare](/getting-started/connect-cloudflare/#create-the-token). |
| *This token cannot see any Cloudflare account.* | Give the token access to your account (Account Resources). |
| *Paste the Cloudflare token again.* | You took more than 15 minutes to pick an account. Paste the token again. |
| *The Cloudflare token cannot create D1 databases.* | Template projects need **D1: Edit**. Edit the token and try again. |

## Project setup

| Message | Fix |
| --- | --- |
| *This Cloudflare account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once to create it, then try again.* | Do that, then use the retry on the project page. |
| *… is already a bohr project.* | A repository can only be one project. Look for it in **Projects** (or in an organization). |
| *The GitHub App cannot reach that repository.* | [Give the app access](/getting-started/install-github-app/#give-access-to-more-repositories) to the repository. |
| *Creating projects on bohr.io Cloud needs an active subscription.* | [Subscribe](/billing/subscription/), or ask an organization admin to. |
| *The Cloudflare account already has a Worker named … Choose another project name.* | Template projects: pick another name. |
| *GitHub is taking too long to copy the template.* | The repository was created; wait a minute and create the project from it as a repository. |
| *Setup failed* with another reason | Check the token's permissions, then retry. |

## The agent

| Message | Fix |
| --- | --- |
| *The agent is off because it has no provider yet.* | The owner (or organization admin) sets a [model provider](/agent/providers/). |
| Self-hosted: the project's panel says the agent needs **Workers Paid** | The Cloudflare account cannot run the agent's sandbox (a Container). The site, its deploys and domains keep working. Upgrade the account to Workers Paid and add **Containers: Edit** to the token (or connect the account again with a new token), then open the project and click **Check again**. See [Where the agent runs](/getting-started/connect-cloudflare/#where-the-agent-runs). |
| *That does not look like an Anthropic API key (sk-ant-…).* | Anthropic keys start with `sk-ant-`. A `sk-ant-oat01-` token is a Claude subscription token: choose **Claude subscription**. |
| *The provider did not accept this key.* / *Could not reach …* | Check the key, and the **Base URL** of a compatible provider (without `/v1/messages`). |
| *the request's budget (US$…) ran out before the work was done* | Raise **Budget per request** in **Settings › Agent**, or split the request. |
| *the agent's workspace restarted in the middle of the request* | It happens during bohr updates. Send the request again; an interrupted repository preparation restarts by itself once. |
| *You already have 5 requests in the queue.* | Wait, or cancel one with `/cancel`. |
| *That message is too long.* | Requests are limited to 20,000 characters. Split it. |

## The preview

| Message | Fix |
| --- | --- |
| *The preview is not set up yet: the agent prepares it when it imports the repository.* | Wait for the repository preparation, or click **Prepare the repository** in the chat. |
| *The preview could not start. Ask the agent to check the file .bohr/preview.json.* | Open **Preview status and log** to see the error, and ask the agent to fix it. See [.bohr/preview.json](/deploys/preview-json/). |
| *The preview is starting. This page reloads by itself.* | The sandbox was asleep and is installing dependencies. It can take a few minutes. |
| *The preview is running, but its server did not answer.* | The dev server must listen on `0.0.0.0` at the configured port and accept any `Host` header. |

## Deploys

| Message | Fix |
| --- | --- |
| *The production deploy failed. Details: …* | Open the run in [Builds](/projects/builds/) and ask the agent to fix the error. Production keeps the previous version. |
| *The file .bohr/deploy.json has a problem (…), so the production deploy was not updated.* | Ask the agent to fix it, or fix it by hand ([reference](/deploys/deploy-json/)). |
| `Deploy credentials are only given to .github/workflows/bohr-deploy.yml on <branch>.` | Only that workflow, on a push to the production branch, gets credentials. |
| `Could not get a GitHub OIDC token` | The workflow needs `permissions: id-token: write`. |
| *Protection does not apply to this site* | The project uses a custom `deploy` command; see [Password protection](/projects/password-protection/). |

## CLI

| Message | Fix |
| --- | --- |
| `Not signed in to … Run "bohr login", or set BOHR_TOKEN…` | Sign in, or set a token ([Authentication](/cli/authentication/)). |
| `… The token expired or was revoked…` | Create a new token, or run `bohr login` again. |
| `… runs in its owner's Cloudflare account, and deploys from the CLI only reach projects bohr hosts for now.` | An outdated CLI (4.0.0 or earlier): run `npx bohr@latest` ([details](/cli/deploy/#which-projects)). |
| `… runs in its owner's Cloudflare account: only its owners (admins of its organization) can deploy it from the CLI…` | Only owners deploy those projects from the CLI. Push a branch instead, or ask an owner ([details](/cli/deploy/#who-can-deploy)). |
| `wrangler printed no preview address: turn on preview URLs for the Worker…` | Set `"preview_urls": true` in the Worker's wrangler config ([details](/cli/deploy/#previews)). |
| `This folder's wrangler config deploys the Worker "…", but …'s site is "…"` | Run it in the folder of the project's Worker, or fix `name` in the wrangler config. |
| `This repository is not a bohr v2 project: …` | Run it in the project's folder, link it with `bohr link`, or add a wrangler config. bohr v1 repositories are never touched. |
| `Which project? … has no GitHub remote (origin).` | Pass `--project <id>` or run `bohr link`. |
| `Which branch? HEAD is detached: pass --branch <name>.` | Pass `--branch`. |
| `Asset too large: …` | Cloudflare accepts files up to 25 MiB: remove it or list it in `.assetsignore`. |
| `Found wrangler.toml, but this action reads wrangler.jsonc.` | Convert the config to `wrangler.jsonc`. |

All CLI codes: [Exit codes and errors](/cli/exit-codes/).

## Domains and variables

| Message | Fix |
| --- | --- |
| *The site is not published yet* / `The site's Worker (…) is not deployed yet.` | Domains and site variables need the site's Worker: publish once. |
| `No zone in your Cloudflare account covers … Add the domain to Cloudflare first.` | Add the domain's zone to the account the project runs in. |
| *… is a name bohr or GitHub already use.* | Names starting with `GITHUB_`, `CLOUDFLARE_`, `BOHR_`, and `CI`, are reserved. |
| `… is already set in the site's wrangler config: change it there.` | Remove it from `vars` in `wrangler.jsonc`, or change it there. |

Still stuck? [Discord](https://discord.com/invite/p3hhfGg2Uy) or [contact@bohr.io](mailto:contact@bohr.io).
