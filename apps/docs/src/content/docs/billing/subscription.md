---
title: Subscription
description: The bohr.io Cloud subscription, what it includes, and how to manage it.
sidebar:
  order: 1
---

**bohr.io Cloud costs US$20 per month** per personal account or organization. bohr runs and maintains the instance for you (the panel, the Telegram bot, the credential vault), and your projects run in your own Cloudflare account. Stripe handles the billing.

Self-hosted instances have no subscription: *"This instance does not charge a subscription."*

## What is included

- The bohr instance at [app.bohr.io](https://app.bohr.io), with every feature: the agent, previews, approvals, versions, members, organizations, variables, password protection, domains, the CLI and the GitHub Action.
- The Telegram platform bot and email sign-in.
- When your Cloudflare account cannot run Containers (on the free plan, for example), each project's agent runtime (its Worker, the agent's sandbox and the preview) in bohr's Cloudflare account. See [Where the agent runs](/getting-started/connect-cloudflare/#where-the-agent-runs).

## What is not included

Infrastructure is paid directly to the providers:

- **Cloudflare**: what your sites use. A free account is enough. If the agent runs in your account, also the Workers Paid plan (US$5/month) and container time while the agent works.
- **Your model provider**: the agent's tokens, or your Claude subscription.

## Subscribe

- During **Get started**, the **Subscription** step: **Subscribe**, pay on Stripe and come back. The panel confirms the payment (*"Payment received. We are confirming the subscription with Stripe…"*). If it does not show as active yet, wait a moment and **Check again**.
- Or from **Account › Subscription › See the subscription › Subscribe to bohr.io Cloud**.
- An organization subscribes from its setup, paid by one of its admins. See [Organization settings and billing](/organizations/settings-and-billing/#subscription-bohrio-cloud).

Creating projects on bohr.io Cloud needs an active subscription. Promotion codes are accepted at checkout.

## Manage it

**Subscription** (from **Account**) shows the **Status**, the **Plan** and the **Next charge** (or **Valid until** once canceled). **Manage on Stripe** opens Stripe's portal for your card, invoices and cancellation.

| Status | Meaning |
| --- | --- |
| **Active** | Paid and current |
| **Trial** | In a trial period |
| **Payment overdue** | A payment failed; projects keep working while Stripe retries |
| **Canceled**, **Expired**, **Unpaid**, **Payment incomplete**, **Paused** | Not active: you cannot create projects |
| **From the previous version, being checked** | A subscription carried over from bohr v1 |

## Customers from bohr v1

Customers who paid for bohr v1 keep **the price of their plan** (*The previous bohr version's price*). Their projects are hosted by bohr until they move them. See [Migrating from bohr v1](/migrating-from-v1/overview/).
