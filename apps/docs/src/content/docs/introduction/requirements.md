---
title: What you need
description: The accounts and plans each person needs to use bohr.
sidebar:
  order: 3
---

## To use bohr

| You need | Why |
| --- | --- |
| A **GitHub** account | Your code lives in your repositories. bohr reads and changes them through its GitHub App, only on the repositories you choose. |
| A **Cloudflare** account | Your production site runs there, and so do each project's Worker, the agent's sandbox (a Container) and the preview when the account can run Containers. The free plan works: on bohr.io Cloud it is enough, and on a self-hosted instance the agent needs **Workers Paid** ([where the agent runs](/getting-started/connect-cloudflare/#where-the-agent-runs)). The account also needs a `workers.dev` subdomain: open **Workers & Pages** once in the Cloudflare dashboard to create it. |
| A **model provider** for the agent | An Anthropic API key, an endpoint compatible with the Anthropic Messages API (OpenRouter, DeepSeek, Kimi, GLM, a LiteLLM proxy…), or a Claude Pro/Max subscription. Without one, projects still deploy what reaches GitHub, but the agent is off. |
| On bohr.io Cloud: a **subscription** | US$20/month per personal account or organization. Not needed on a self-hosted instance. |
| Optional: **Telegram** | To talk to the agent and approve releases from your phone. The web chat does everything without it. |

## To work on someone else's project

Nothing but a bohr account. The project owner [invites you](/projects/members/) with a code, or adds you through their [organization](/organizations/members/). Members use the owner's Cloudflare account and agent; they need no subscription, Cloudflare account or model key of their own.

## Supported projects

The agent maps your repository to Cloudflare on its first run:

| In the repository | Production | Preview |
| --- | --- | --- |
| JavaScript/TypeScript or Python without a Dockerfile | A Worker with static assets, using the framework's official Cloudflare adapter (OpenNext for Next.js 15.5+, the Nuxt `cloudflare` preset, `@astrojs/cloudflare`, `@sveltejs/adapter-cloudflare`, React Router or Remix for Cloudflare). A plain static site is assets only. | The framework's dev server |
| A Dockerfile | A Container behind a Worker (needs Workers Paid in your account) | The dev server |
| Postgres | Neon in your account, through Hyperdrive | A Neon branch |
| Redis | Upstash in your account | `redis-server` in the sandbox |
| Files written to local disk | R2 | An R2 bucket for the preview |

Stateful services such as volumes, MongoDB or Elasticsearch are not supported; the agent says so and suggests the closest alternative. When a change moves your queues or disk writes to Cloudflare services, the agent asks before doing it.
