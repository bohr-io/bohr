---
title: Create a project from a repository
description: Turn one of your GitHub repositories into a bohr project.
sidebar:
  order: 4
---

A **project** is one repository, one production site and one agent. To create one, click **New project** in the sidebar.

## 1. Choose the repository

1. Under **How to start**, keep **One of my repositories**.
2. Search the list by name or organization and pick the repository. Private repositories show a **Private** badge.
3. Check the two fields:
   - **Project name**: how the project appears in bohr.
   - **Production branch**: approved changes are merged into this branch, and the production deploy starts from it. It defaults to the repository's default branch.
4. Click **Create the project**.

The repository you want is missing? See [Give access to more repositories](/getting-started/install-github-app/#give-access-to-more-repositories).

:::note[bohr.io Cloud]
Creating projects needs an active subscription. Without one, the panel shows *"Creating projects on bohr.io Cloud needs an active subscription."* with a link to subscribe.
:::

## 2. Setup

bohr creates, in your Cloudflare account:

- the **project Worker**, with the request queue, the members and the chat;
- the **agent's sandbox**, a Container that sleeps when idle;
- the **preview Worker**, an unlisted `workers.dev` address that shows the `homolog` branch.

The panel shows the progress (*Creating the project Worker*, *Preparing the agent's sandbox*, *Turning the preview on*, *Almost there*). It usually takes one to three minutes; keep the page open.

If it fails, the panel shows *"The project setup failed"* with the reason and a way to try again. The most common causes are in [Troubleshooting](/reference/troubleshooting/#project-setup).

## 3. Telegram bot (optional)

bohr offers to create a **project bot** on Telegram, so you and your team can ask for changes and approve releases from Telegram. Follow the steps (BotFather, `/newbot`, paste the token) or click **Skip and open the project**. You can connect a bot later in **Settings › Agent**. See [Telegram](/agent/telegram/).

## 4. The agent prepares the repository

As soon as the project is ready and your [model provider](/agent/providers/) is set up, the agent starts **preparing the repository** on its own. Continue in [First deploy](/getting-started/first-deploy/).

## Projects in an organization

To create the project in an organization, switch to it first (context menu at the top of the panel) and click **New project** there. The project runs in the organization's Cloudflare account and uses its agent settings, whoever creates it. See [Organizations](/organizations/overview/).
