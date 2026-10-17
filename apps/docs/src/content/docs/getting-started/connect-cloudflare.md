---
title: Connect Cloudflare
description: Create the Cloudflare API token bohr needs, with the right permissions, and connect your account.
sidebar:
  order: 2
---

bohr deploys your projects to **your** Cloudflare account, with an API token you give it: the production site, preview deploys, routes and custom domains. When the account can run Containers, each project's Worker, the agent's sandbox and the preview run there too (see [Where the agent runs](#where-the-agent-runs)). The instance keeps the token encrypted and only uses it to create and update your projects' Workers.

## Before you start

- Any plan works, including the free one. Only the agent's sandbox, a Cloudflare Container, needs the **Workers Paid** plan: on bohr.io Cloud a free account is enough, and on a self-hosted instance the agent needs Workers Paid in your account.
- The account needs a **workers.dev subdomain**. If you never opened **Workers & Pages** in the Cloudflare dashboard, open it once: that creates the subdomain.

## Create the token

1. In the **Cloudflare** step, click **Create the token on Cloudflare**. It opens Cloudflare's token page with the permissions filled in.
2. Optional: if the account is on Workers Paid and you want the agent to run in it, add the `Containers: Edit` permission before saving. The link cannot fill it in.
3. Create the token, copy it, paste it in **Cloudflare API token** and click **Connect**.

The token needs these permissions:

| Permission | Why |
| --- | --- |
| **Workers Scripts: Edit** | Creates the project Workers. It also covers Durable Objects and the workers.dev subdomain. |
| **Account Settings: Read** | Reads the account's details. |
| **D1: Edit** | Creates the database of projects started from a [template](/getting-started/templates/). Filled in by the link; only template projects need it. |
| **Workers Routes: Edit** | Serves a domain that already has DNS records through a Worker route, when a project [moves to your account](/migrating-from-v1/move-to-your-cloudflare/). Filled in by the link. |
| **Containers: Edit** | Optional. Runs the agent's sandbox in your own account; needs the Workers Paid plan. **Add it by hand.** |

When something is missing, the panel shows *"The token lacks some permissions"* with the list. Edit the token on Cloudflare (or create another one from the template), add what is missing and paste it again.

### Where the agent runs

bohr checks whether the account can run Containers (Workers Paid, and **Containers: Edit** on the token) when it sets up a project's agent: when the project is created or the agent is turned on.

- **It can:** the project's Worker, the agent's sandbox and the preview run in your account.
- **It cannot, on bohr.io Cloud:** they run in bohr's Cloudflare account, covered by the [subscription](/billing/subscription/). Your production site, preview deploys, routes and domains still deploy to your account, with your token.
- **It cannot, on a self-hosted instance:** the project works without the agent. Production deploys (the [deploy workflow](/deploys/deploy-workflow/) or [`bohr deploy`](/cli/deploy/)), preview deploys and domains work, and the project's panel says the agent needs Workers Paid. After you upgrade the account and add Containers: Edit to the token (or connect the account again with a new token), open the project and click **Check again**.

A project whose agent is already set up keeps running where it is.

### Several accounts

If the token can see more than one Cloudflare account, bohr asks **Choose the Cloudflare account**: pick the one your projects should run in and click **Use this account**.

## What bohr leaves in your account

So you can tell bohr's work apart from yours:

- Every Cloudflare API call bohr makes sends `User-Agent: bohr/<version> (+https://bohr.io)`; it shows in your account's audit log.
- The Workers bohr creates in your account (each project's agent Worker and preview Worker) carry the tags `bohr` and `bohr-project:<id>`, and their deployments the message `bohr`.
- Production deploys run `wrangler deploy --message "bohr" --tag "bohr-<commit>"`.

## Later

- Connected accounts are listed in **Account › Connected accounts › Cloudflare**. You can [disconnect](/account/connections/) an account once no project uses it; also delete the token in the Cloudflare dashboard (**My Profile → API Tokens**).
- An [organization](/organizations/settings-and-billing/) connects its own Cloudflare account, separate from yours.
