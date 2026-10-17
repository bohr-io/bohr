---
title: Set up a token for an agent
description: Create a scoped bohr token and give it to an AI agent without exposing it.
sidebar:
  order: 2
---

## 1. Create a scoped token

In the panel, open **Account › Tokens** and fill in **New token**:

| Field | Recommendation |
| --- | --- |
| **Name** | Something you will recognize later, like `claude code - shop` |
| **Projects** | **Only these projects**, and pick only the ones the agent works on. Avoid **All my projects, including the ones I join later**. |
| **Expires** | **In 30 days**, **In 90 days** or **In 365 days**. Prefer a short one; create a new token when it expires. |

Click **Create token** and copy it: the panel shows it once (*"Anyone who has it can deploy as you."*).

A token acts as **you**, on the projects you are a member of, limited to the ones it lists. It can deploy previews; it can deploy production only on projects you own, and projects in their owner's Cloudflare account only when you own them (previews included). It never carries an instance administrator role.

## 2. Give it to the agent

Set it as the `BOHR_TOKEN` environment variable where the agent runs commands. Never paste it into the chat or a file in the repository.

```sh
# a shell you start the agent from
export BOHR_TOKEN=bohr_…
claude
```

- **Claude Code**: export it in the shell before starting `claude`, or add it to the `env` of your user settings (`~/.claude/settings.json`), never to the repository's `.claude/settings.json`.
- **Cursor, Windsurf**: set it in the environment the editor's terminal inherits.
- **Codex and cloud agents**: add it as a secret of the agent's environment.
- **CI**: a masked CI secret (see [CI usage](/cli/ci/)).

Check it works:

```sh
npx --yes bohr@latest whoami --json
```

## 3. Non-interactive by default

The CLI never asks questions and never opens a browser when there is no terminal, when `CI` is set, or with `--json`. Agents should always pass `--json`. Agents should not run `bohr login`: it needs a person to approve it in a browser.

## Revoking

**Account › Tokens › Revoke** stops the token at once. Deploys it already published stay online. Each token shows when it was **last used**.
