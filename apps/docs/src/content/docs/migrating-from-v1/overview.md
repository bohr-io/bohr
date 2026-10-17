---
title: bohr v1 projects in bohr v2
description: What happened to bohr v1 projects, and what you can do now.
sidebar:
  order: 1
---

bohr v2 replaces bohr v1. The projects of paying bohr v1 customers were moved to bohr v2 for them; you did not need to do anything.

## What happened to your project

- **It runs on bohr v2**, hosted by bohr in its own Cloudflare account, as it was in v1. In the panel, its hosting shows **Hosted by bohr**.
- **Same addresses, no DNS changes.** Your custom domains and your `bohr.io` addresses (`<repo>-<owner>.bohr.io`) keep working.
- **Your repository keeps its workflow.** The bohr v1 workflow (`.github/workflows/bohr.yml`) keeps running on every push, and now deploys to bohr v2. bohr wrote nothing into your repository: no new workflow, no files, no Actions secrets.
- **Same price.** Your plan keeps the price you paid in v1.
- **Your settings came along**: environment variables (as [build variables](/projects/variables/#build-variables) and [site variables](/projects/variables/#site-variables)), password protection and domains.

Sign in at [app.bohr.io](https://app.bohr.io) with the same GitHub account to see your projects.

## What you can do now

| | |
| --- | --- |
| **Keep it as it is** | Push as before; every branch still gets its own preview address. See [What changes](/migrating-from-v1/what-changes/). |
| **Turn the agent on** | Change the site by conversation, with previews and approvals. On the project, click **Turn the agent on** (needs an active subscription, and a [model provider](/agent/providers/)). |
| **Move it to your own Cloudflare account** | Where bohr v2 projects run. See [Move to your Cloudflare account](/migrating-from-v1/move-to-your-cloudflare/). |
| **Manage your domain's DNS** | If bohr v1 hosted your domain's whole DNS, its records are under **Domains** in the panel. See [DNS of domains bohr hosts](/migrating-from-v1/dns/). |
| **Deploy from your terminal or an AI agent** | `bohr deploy` publishes projects bohr hosts. See [the CLI](/cli/deploy/). |

Questions: [Discord](https://discord.com/invite/p3hhfGg2Uy) or [contact@bohr.io](mailto:contact@bohr.io). See also the [FAQ](/migrating-from-v1/faq/).
