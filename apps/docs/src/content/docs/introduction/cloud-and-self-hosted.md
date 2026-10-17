---
title: bohr.io Cloud or self-hosted
description: The two ways to run bohr, what each one includes, and what you pay for.
sidebar:
  order: 2
---

bohr is open source (MIT). You can run the **instance** (the panel, the API and the credential vault) yourself, or use the one bohr runs for you at [app.bohr.io](https://app.bohr.io). Either way, your sites deploy to your own Cloudflare account.

| | bohr.io Cloud | Self-hosted |
| --- | --- | --- |
| Who runs the instance | bohr | You, on your Cloudflare account |
| Address | `https://app.bohr.io` | Your Worker's address or your domain |
| Price of the instance | US$20/month per account or organization | Free |
| Where projects run | Your Cloudflare account (when it cannot run Containers, the agent runs in bohr's) | Each user's Cloudflare account |
| Features | All | All |
| Users and projects | Per subscription | Unlimited |
| Telemetry | None sent | Off unless an admin turns it on ([details](/self-hosting/telemetry/)) |

## What you pay for

On both, infrastructure is paid directly to the providers, never through bohr:

| Provider | What it charges for |
| --- | --- |
| Cloudflare | Whatever your sites use in production; the free plan is enough for many sites. When the agent's sandbox (a Container) runs in your account: the **Workers Paid** plan (US$5/month) and container time while the agent works (a `standard-1` container costs cents per hour and sleeps when idle). Self-hosted, the agent always runs in your account; on bohr.io Cloud, only when your account can run Containers (Workers Paid, and Containers: Edit on the token). |
| Your model provider | The agent's tokens, with your Anthropic API key or a compatible provider. With a Claude Pro or Max subscription, usage counts against your subscription instead. |
| GitHub | Nothing extra: Actions minutes for the deploy runs, within your plan. |

Each request has a spending cap (US$5 by default), which you can change per project. See [Costs and limits](/agent/costs-and-limits/).

## bohr.io Cloud

- Nothing to install: sign in at [app.bohr.io](https://app.bohr.io), subscribe and connect your accounts.
- One subscription per personal account, and one per [organization](/organizations/overview/), paid by one of its admins. Members of an organization do not need a subscription of their own to work on its projects.
- Billing goes through Stripe. See [Subscription](/billing/subscription/).
- A free Cloudflare account is enough. When it cannot run Containers, each project's agent runs in bohr's Cloudflare account, covered by the subscription; your sites still deploy to your account. See [Where the agent runs](/getting-started/connect-cloudflare/#where-the-agent-runs).

## Self-hosted

- Deploy the instance with the **Deploy to Cloudflare** button or with `wrangler`, then create its GitHub App at `/setup`. See [Self-hosting](/self-hosting/overview/).
- The instance itself fits in Cloudflare's free plan to start. The agent needs Workers Paid on the account where each user's projects run; without it, projects still deploy, without the agent.
- You keep the master key of the credential vault, and you decide who can sign in.

:::note
Whoever runs an instance keeps its users' Cloudflare tokens (encrypted) and its GitHub App key. Use an instance you trust: bohr.io Cloud, or your own.
:::
