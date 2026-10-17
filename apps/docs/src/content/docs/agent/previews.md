---
title: The preview (homologação)
description: Review the agent's changes on the preview, then approve them to production or discard them.
sidebar:
  order: 3
---

The **preview** (in the Portuguese panel, *homologação*) is your site running from the `homolog` branch, where the agent commits its work. It collects the changes of every finished request until someone approves or discards them.

## Its state

The project shows the preview in one of three states:

| State | Meaning |
| --- | --- |
| **Same as production** | `homolog` matches production. Nothing to review. |
| **Changes to review** | The agent pushed changes nobody decided on yet. Each push is a new **version** (1, 2, 3…). |
| **Publishing** | Someone approved; bohr is merging and GitHub Actions is deploying. |

## Reviewing

Open **See the preview** on the Overview or in the chat, or choose **Preview** in the selector of the site's full-screen view (opening the **Chat** there switches to it):

- Beside the selector, *Same as production* or *2 changes* (hover it for what changed).
- Switch between **Desktop**, **Tablet** and **Phone**, or open it in a new tab.
- The Overview's preview card lists what the agent did, with **Approve and publish** and **Discard**.
- **See the changes on GitHub**, in the chat, opens the diff of exactly the commit that approving publishes.

The chat never prints the preview's address: on Telegram, the **🔎 See the preview** button opens it.

The preview address is public but unlisted: an unguessable `workers.dev` name, marked `noindex` for search engines. Share it with whoever needs to review.

The preview is the project's **dev server** running in the agent's sandbox, as configured in [`.bohr/preview.json`](/deploys/preview-json/). The sandbox sleeps when idle: the first visit after a while shows *"The preview is starting. This page reloads by itself."* while it installs and starts again.

## Approve and publish

Any member can approve. **Approve and publish**:

1. opens (or reuses) a pull request from `homolog` to the production branch;
2. squash-merges it **only if its head is still the version you reviewed**, so changes pushed after your review cannot slip in;
3. resets `homolog` to the merge, and the next request starts a fresh conversation;
4. GitHub Actions deploys production. The chat says *Production updated* when the run finishes, or *The production deploy failed* with a link to the run.

You cannot decide while a request is running (*"Wait for the running request to finish before deciding."*). A request that finishes while an approval is publishing waits for the next approval.

## Discard

**Discard** (confirm with *Discard the changes?*) resets `homolog` to production. The changes that were not published are lost, and the next request starts a fresh conversation.

## Approving from Telegram

The project bot sends the same buttons, bound to the version they were sent with. See [Telegram](/agent/telegram/).
