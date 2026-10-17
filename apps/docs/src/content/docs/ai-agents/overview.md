---
title: Deploying from AI coding agents
description: How Claude Code, Cursor, Codex and other coding agents deploy bohr projects with the CLI.
sidebar:
  order: 1
---

AI coding agents (Claude Code, Cursor, Codex, Windsurf, Aider, your own scripts) can deploy bohr projects with the [bohr CLI](/cli/install/): build, upload and get a preview URL to show you, without a browser and without your password.

This section is written for you **and** for the agent. Point your agent at it, or give it the ready-made instructions:

- [AGENTS.md / CLAUDE.md snippet](/ai-agents/agents-md/): paste into your repository's instructions file.
- [SKILL.md](/ai-agents/skill/): a skill file the agent loads when it needs to deploy.

## The short version

```sh
# 1. You: create a token in the panel (Account › Tokens), limited to the project, and give it to the agent
export BOHR_TOKEN=bohr_…

# 2. The agent: find the project once
npx --yes bohr@latest projects --json

# 3. The agent: deploy a preview after each change, and read "url" from the JSON
npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch agent/new-header --json
```

## How it fits with bohr's own agent

bohr already has an agent that changes your site from a chat, with a preview and an approval. An external coding agent is for when you work in your editor or terminal instead: it changes the code locally and uses `bohr deploy` to publish previews of its work.

| | bohr's agent | Your coding agent + CLI |
| --- | --- | --- |
| Where it runs | The sandbox in your Cloudflare account | Your machine, or the agent's own sandbox |
| Preview | The `homolog` branch, approved in the panel | Any branch name, with `bohr deploy` |
| Production | Approve in the panel or on Telegram | `bohr deploy --prod` (owners), only when you ask |

## Read on

1. [Set up a token](/ai-agents/setup/): scoped, non-interactive.
2. [The deploy loop](/ai-agents/deploy-loop/): `--json`, exit codes, and preview vs `--prod` etiquette.
3. [AGENTS.md snippet](/ai-agents/agents-md/) and [SKILL.md](/ai-agents/skill/).

:::note[Projects in your own Cloudflare account]
`bohr deploy` publishes projects in your own Cloudflare account too, but only with a token of the project's owner (previews included), since wrangler deploys them with the owner's Cloudflare connection. With anyone else's token it exits with code 5 (`own_account_not_allowed`); the agent should then commit to a branch and open a pull request, and the merge deploys through the project's workflow. Their previews use production's D1 databases. See [the deploy loop](/ai-agents/deploy-loop/#projects-in-your-own-cloudflare-account).
:::
