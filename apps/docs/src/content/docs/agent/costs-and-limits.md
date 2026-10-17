---
title: Costs and limits
description: What each request costs, the budget and turn limits, and how to change them.
sidebar:
  order: 7
---

## Cost of each request

The agent spends model tokens at your provider's prices, and you pay them to your provider, not to bohr; with a [Claude subscription](/agent/providers/#claude-subscription-promax) they are part of it. The chat never talks about cost: your provider's console shows what you spent.

Container time is billed by Cloudflare to the account that runs the project: the sandbox runs while the agent works and while the preview is being visited, then sleeps.

## Limits per request

| Limit | Default | Where to change it |
| --- | --- | --- |
| **Budget per request (US$)** | 5 | **Settings › Agent** (owner), or `/budget` on Telegram: 0.10 to 1000. |
| **Maximum turns** | 200 | **Settings › Agent** (owner): 1 to 1000. A turn is one round of the agent's work. |
| Running time | 2 hours | Fixed |
| Request length | 20,000 characters | Fixed |
| Waiting requests | 5 per member | Fixed |

When a request reaches its budget, it stops and nothing is pushed: *"the request reached the per-request limit before the work was done. The owner can raise it in the agent's settings."* With a Claude subscription the budget is a safety cap estimated at API prices; nothing is charged separately.

## Keeping costs down

- Ask for one thing at a time, and be specific (see [Tips](/agent/tips/)).
- Lower the **Effort** in [Model providers](/agent/providers/) for simple projects.
- Choose a smaller model for a project in **Settings › Agent › Model**.
- Approve or discard when you are done: follow-ups in a long preview carry the whole conversation.
