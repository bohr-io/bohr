---
title: Telegram
description: Talk to the agent and approve releases from the project's Telegram bot, and the commands it understands.
sidebar:
  order: 2
---

Each project can have its own **Telegram bot**. It is the same conversation as the web chat: you ask for changes, open the preview and approve or discard with buttons.

## Connect a bot

1. On Telegram, open **@BotFather** and send `/newbot`.
2. Choose a name and a username that ends in `bot`.
3. Copy the token BotFather sends (it looks like `123456789:AA…`).
4. In the project, open **Settings › Agent**, paste it under **Telegram** and click **Connect the bot**. (The new-project flow offers the same step.)

Only the project owner connects the bot. To stop using it, delete it with BotFather; bohr does not delete project bots.

## Link your Telegram account

The bot recognizes people by their bohr account. In **Account**, click **Link Telegram**, then **Open in Telegram** and tap **Start**. The link works for a few minutes. (This needs the instance's platform bot, which bohr.io Cloud has; on a self-hosted instance the administrator sets it up.)

Someone who is not a member yet gets: *"You don't have access to … yet. Ask the owner for an invite and send /join &lt;code&gt;."*

## Talking to the bot

- **In a private chat**, every message is a request.
- **In a group**, the bot answers messages that mention it (`@your_bot`), replies to its own messages, and commands.

While the agent works, the bot keeps one status message up to date. When it finishes, it sends the summary and the buttons **Approve and publish**, **Discard**, **🔎 See the preview** and **See the changes on GitHub**, bound to that preview version: a button pressed on an old version answers *"The preview changed since this message."*

## Commands

Each command also has a Portuguese and a Spanish name.

| Command | Also | What it does |
| --- | --- | --- |
| `/status` | `/estado` | The running request, the line and the preview |
| `/approve`, `/discard` | `/aprovar`, `/aprobar`, `/descartar` | Shows the current preview's changes with the buttons to decide |
| `/cancel` | `/cancelar` | Cancels your running or waiting request |
| `/rollback` | `/reverter`, `/revertir` | Returns production to the previous version |
| `/invite` | `/convidar`, `/invitar` | Creates an invite code (owner) |
| `/join <code>` | `/entrar`, `/unirse` | Joins the project with an invite code |
| `/members` | `/membros`, `/miembros` | Lists the members with numbers |
| `/revoke <number>` | `/revogar`, `/revocar` | Removes a member (owner) |
| `/model <name>` | `/modelo` | Sets the project's model (owner) |
| `/budget <dollars>` | `/orcamento`, `/presupuesto` | Sets the budget per request, from 0.10 to 1000 (owner) |
| `/help` | `/ajuda`, `/ayuda` | Lists the commands |

Typed `/approve` and `/discard` never act by themselves: they show the buttons for the version you are looking at, so you always decide on what you reviewed.

## The platform bot

Instances with a platform bot (such as bohr.io Cloud's) also let you go through onboarding on Telegram: `/new` creates a project, `/status` lists your projects and `/retry` repeats the last step that failed. The agent settings are still chosen in the web panel.
