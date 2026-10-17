---
title: Organization settings and billing
description: An organization's Cloudflare account, agent, subscription, and how to delete it.
sidebar:
  order: 3
---

**Settings** of an organization. Only its admins change them (*"Only the organization's admins change its settings."*).

## General

The **Name** and picture come from the GitHub organization; the page links to it on **GitHub**.

## Cloudflare

The organization's projects run in this Cloudflare account. **Connect an account** with a token, as [for yourself](/getting-started/connect-cloudflare/), or **Connect another account**. An account cannot be disconnected while projects of the organization run there.

## Agent

The agent's provider, key, model and effort in every project of the organization. The same choices as [personal settings](/agent/providers/): an Anthropic API key, a compatible provider, or a Claude subscription. Saving applies to every ready project of the organization; removing turns the agent off in all of them (GitHub deploys keep working).

## Subscription (bohr.io Cloud)

Each organization has its **own** subscription, US$20/month, paid by one of its admins with an organization customer on Stripe that never mixes with the admin's personal subscription. Members don't need a subscription. Admins subscribe from the organization's setup, and manage it (card, invoices, cancellation) with **Manage on Stripe**. See [Subscription](/billing/subscription/).

## When the GitHub App is uninstalled

If someone uninstalls bohr's App from the GitHub organization, the page says *"The GitHub app was uninstalled"*: the projects stay online, but you can't create new ones or sync the members. **Install the app again** to fix it.

## Danger zone: delete the organization

**Delete organization** removes its projects from bohr, and everything bohr created for them. Type the organization's slug to confirm.

- The organization's projects are deleted (agents, previews, bots and bohr routes).
- The organization's subscription is canceled, and its Cloudflare accounts and agent are disconnected.
- The bohr app is uninstalled from the GitHub organization. **The repositories aren't changed.**
- The sites published in the organization's Cloudflare account **stay online**, unless you check **Also delete the sites published in the organization's Cloudflare account**.
