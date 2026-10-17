---
title: Tokens
description: Create, scope and revoke tokens for the bohr CLI, scripts and AI agents.
sidebar:
  order: 2
---

A token lets a script or an AI agent use bohr as you, with the [bohr CLI](/cli/install/): list your projects and deploy previews (production too, on projects you own; projects in their owner's Cloudflare account only when you own them). Give it to them as the `BOHR_TOKEN` environment variable. Manage them in **Account › Tokens** (**Manage tokens**).

## Create a token

Under **New token**:

| Field | |
| --- | --- |
| **Name** | One you will recognize, for example "deploy agent" or "CI of the store". |
| **Projects** | **All my projects, including the ones I join later**, or **Only these projects** (pick at least one). |
| **Expires** | **In 30 days**, **In 90 days**, **In 365 days** or **Never**. |

Click **Create token**. The panel shows the token **once**, with how to use it:

```sh
BOHR_TOKEN=bohr_… npx bohr deploy --json
```

Copy it now and keep it somewhere safe: bohr does not show it again, and anyone who has it can deploy as you. bohr stores only a hash of it.

## What a token can do

- It acts as **you**, on the projects you are a member of (an organization's projects through the organization), limited to the projects it lists.
- Previews on any of those projects; production only on projects you own (or whose organization you administer).
- It never carries the instance's administrator role, even if you have it.
- You can have up to 50 tokens.

## Your tokens

**Your tokens** lists each token with its projects (**All your projects** or **Projects: …**), when it was **Created**, when it was **last used** (or *never used*), and when it expires (or *never expires*). Expired tokens show **Expired**.

Each computer where you ran `bohr login` has a token of its own, marked **CLI** and named "CLI on &lt;computer&gt;". `bohr logout` revokes it.

## Revoke

**Revoke** and confirm: scripts, agents and computers using the token stop working at once. Deploys already published stay online.
