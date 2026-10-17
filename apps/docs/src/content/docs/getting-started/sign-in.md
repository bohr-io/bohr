---
title: Sign in
description: Sign in to bohr with GitHub or with a code sent by email, then follow the Get started wizard.
sidebar:
  order: 1
---

Open the instance: [app.bohr.io](https://app.bohr.io) for bohr.io Cloud, or your own instance's address.

## With GitHub

Click **Sign in with GitHub** and authorize bohr. Your name and email come from GitHub.

## With a code by email

1. Type your email and click **Email me a code**.
2. bohr sends a **6-digit code**, valid for 10 minutes.
3. Type the code and click **Sign in**.

A code allows 5 attempts. If you ask for too many codes, bohr answers *"Too many attempts. Wait a few minutes and try again."*

:::note
On a self-hosted instance, email sign-in only appears when its administrator set it up ([how](/self-hosting/optional-features/#sign-in-with-a-code-by-email)). The first person who signs in to a new instance becomes its administrator.
:::

Your session lasts 30 days on that browser. **Account › Sign out** ends it. You can add or remove ways to sign in later in [Connected accounts](/account/connections/).

## The Get started wizard

After the first sign-in, the panel opens **Get started**. It asks only for what every user sets up once:

| Step | What you do |
| --- | --- |
| **Subscription** | bohr.io Cloud only: click **Subscribe**, pay on Stripe and come back. See [Subscription](/billing/subscription/). |
| **Cloudflare** | Create an API token and paste it. See [Connect Cloudflare](/getting-started/connect-cloudflare/). |
| **GitHub** | Install bohr's GitHub App on your repositories. See [Install the GitHub App](/getting-started/install-github-app/). |

When it shows **All set!**, click **New project**, or **Set up the agent** first if you have not chosen a model provider yet ([Model providers](/agent/providers/)).

:::tip
Working only on projects of an [organization](/organizations/overview/) you belong to? You do not need this setup: the organization's admins already connected its subscription, Cloudflare account and agent. Switch to the organization in the context menu at the top of the panel.
:::
