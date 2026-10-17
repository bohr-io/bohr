---
title: Project settings
description: The General, Agent and Hosting pages of a project's settings.
sidebar:
  order: 4
---

**Settings** has its own menu: **General**, **Domains**, **Environment variables**, **Authentication**, **Agent** and **Hosting**. Members can read them; only the owner changes them.

- [Domains](/projects/domains/)
- [Environment variables](/projects/variables/)
- [Authentication](/projects/password-protection/)

## General

The project's details on this instance:

| Field | |
| --- | --- |
| **Name** | The project's name in bohr |
| **Repository** | `owner/name` on GitHub |
| **Production branch** | Approved changes are merged here, and production deploys from it |
| **Production address** | The site's address, or *Not published yet* |
| **Hosting** | **Your Cloudflare account**, or **Hosted by bohr** for projects migrated from v1 |
| **Agent** | Whether the agent is on |
| **Project ID** | The id the [CLI](/cli/commands/) and the API use, like `p3k9x0a7qd2m` |

The bottom of this page has the [Danger zone](/projects/delete/).

## Agent

| Setting | |
| --- | --- |
| **Model** | The model the agent uses in this project, instead of the one chosen in the account settings |
| **Budget per request (US$)** | The agent stops when a request costs this much. Default 5. |
| **Maximum turns** | How many rounds the agent can take on one request, from 1 to 1000. Default 200. |
| **Agent language** | Language of the agent's and the project bot's replies: Português, English or Español |

**Telegram** shows the project bot (**Open in Telegram**) or lets the owner connect one with a BotFather token. See [Telegram](/agent/telegram/).

**Provider and key** live in your account settings and apply to all your projects: **Open the agent settings** ([Model providers](/agent/providers/)).

## Hosting

- **In your Cloudflare account**: the project's site, agent and preview run in your Cloudflare account. Nothing to do.
- **Hosted by bohr**: a project migrated from bohr v1, still in bohr's Cloudflare account. This page lets you move it to your own account. See [Move to your Cloudflare account](/migrating-from-v1/move-to-your-cloudflare/).
