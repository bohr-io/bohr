---
title: Self-hosting overview
description: Run your own bohr instance on your Cloudflare account, and what it costs.
sidebar:
  order: 1
---

bohr is open source (MIT). A **self-hosted instance** is the same software as bohr.io Cloud, running in your Cloudflare account: one Worker with the API, the onboarding (web and Telegram), the credential vault and the web panel, plus a D1 database.

Projects do not run in the instance. Each one runs in its owner's Cloudflare account, which the instance provisions with the owner's API token. Install one instance for yourself, your team or your clients; it has unlimited users and projects and every feature.

## What each person needs

| Who | Needs |
| --- | --- |
| Whoever hosts the instance | A Cloudflare account with Workers, D1 and Workflows (the free plan is enough to start), and a GitHub account to own the instance's GitHub App |
| Each user | A Cloudflare account, a GitHub account, and a model provider. The agent needs Workers Paid on the Cloudflare account (its sandbox is a Container); without it, projects still deploy, without the agent. Telegram is optional. |

## Costs

| Account | Pays for |
| --- | --- |
| The instance's | Workers, D1 and Workflows. A small instance fits in the free plan. Workers Paid (US$5/month) is needed only for the optional [sign-in container](/self-hosting/optional-features/#a-dedicated-sign-in-container). |
| Each user's Cloudflare | What the project uses in production and, for the agent, Workers Paid (US$5/month) and the sandbox while the agent works (a `standard-1` container costs cents per hour and sleeps when idle) |
| Each user's model provider | The agent's tokens. Every request has a budget (US$5 by default, set per project). |

## Steps

1. [Deploy the instance](/self-hosting/deploy-instance/) with the Deploy to Cloudflare button or with wrangler.
2. [Create its GitHub App](/self-hosting/github-app/) at `/setup`.
3. Optional: [the platform bot, email sign-in and the sign-in container](/self-hosting/optional-features/).
4. Sign in: the first person becomes the [administrator](/self-hosting/administration/).
5. Users go through [Get started](/getting-started/sign-in/) like on bohr.io Cloud, without the subscription step.

## Trust

The instance keeps its users' Cloudflare tokens and its GitHub App's private key, encrypted with a master key you hold. Users must trust whoever hosts the instance. Every use of a stored credential is recorded in the instance's audit log. See [Security model](/reference/security/).
