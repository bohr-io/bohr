---
title: How it works
description: From a GitHub repository to production, through the agent, the preview and an approval.
sidebar:
  order: 1
---

bohr connects three things you already own: a **GitHub repository** (the code), a **Cloudflare account** (where the site runs) and a **model provider** (the AI agent's brain, such as an Anthropic API key or your Claude subscription).

```
You (web chat or Telegram)
   │  "Add a contact form to the home page"
   ▼
Project Worker in your Cloudflare account
   ├─ request queue, members, chat history
   ├─ agent sandbox (a Cloudflare Container): edits the code, runs the build
   └─ preview: the site, running from the "homolog" branch
   │
   ▼  Approve
Pull request homolog → production branch, merged
   │
   ▼
GitHub Actions builds and deploys production to your Cloudflare account
```

## The cycle

1. **Connect.** You sign in, connect your Cloudflare account and install bohr's GitHub App on the repositories bohr may use. You do this once.
2. **Create a project.** Pick one of your repositories, or start from a [template](/getting-started/templates/). bohr creates the project's Worker, the agent's sandbox and the preview in your Cloudflare account (one to three minutes).
3. **The agent prepares the repository.** On its first run, the agent works out how your project runs on Cloudflare: it writes `.bohr/preview.json` (how to run the preview) and `.bohr/deploy.json` (how to build and deploy production), adds a wrangler config if missing and makes the production build pass.
4. **Ask for a change.** Write what you want in plain words, in the panel's chat or to the project's Telegram bot. The agent edits the code in its sandbox and pushes the result to the `homolog` branch.
5. **Review the preview.** The preview (in Portuguese, *homologação*) shows the site with the change, on its own address. Ask for adjustments as many times as you want; follow-up requests continue the same conversation.
6. **Approve or discard.** **Approve and publish** opens a pull request from `homolog` to the production branch and merges it. GitHub Actions then builds and deploys production. **Discard** throws the changes away and the preview matches production again.
7. **Roll back** at any time: bohr merges a revert of the last release and production goes back to the previous version.

## What runs where

| Piece | Where it runs |
| --- | --- |
| The bohr instance (panel, API, credential vault) | bohr.io Cloud, or your own Cloudflare account if you [self-host](/self-hosting/overview/) |
| Each project's Worker, agent sandbox and preview | The project owner's Cloudflare account |
| The production site | The project owner's Cloudflare account, as a Worker with static assets |
| The code, branches, pull requests and deploy runs | The project's GitHub repository and GitHub Actions |
| The AI model | Your provider: Anthropic, an Anthropic-compatible endpoint, or your Claude subscription |

Projects migrated from bohr v1 are the exception: bohr hosts them in its own Cloudflare account until their owners [move them](/migrating-from-v1/move-to-your-cloudflare/).

## Safety by design

- **Nothing reaches production without approval.** The agent can only push to `homolog`. Production changes only through an approved, merged pull request, and the merge names the exact commit you reviewed.
- **The sandbox never holds your keys.** The agent sees placeholders; bohr adds the real model key and a short-lived, single-repository GitHub token on the way out. See [Security model](/reference/security/).
- **The agent cannot change your workflows.** GitHub refuses any change under `.github/workflows` from the sandbox; bohr writes its own deploy workflow itself.
