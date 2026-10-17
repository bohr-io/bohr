---
title: First deploy
description: How the agent prepares your repository and how your site reaches production the first time.
sidebar:
  order: 6
---

A new project from one of your repositories does not deploy anything until the repository is **prepared** for bohr. The agent does that in its first run.

## Preparing the repository

When the project is ready and your [model provider](/agent/providers/) is set up, the agent starts on its own. In the chat you see the request *"Prepare this repository for bohr…"* and its progress. The agent:

1. Inspects the repository and decides how it runs on Cloudflare: static assets, a Worker, or a Container behind a Worker.
2. Writes [`.bohr/preview.json`](/deploys/preview-json/), so the preview can run the project's dev server.
3. Adds a `wrangler.jsonc` if the repository has none.
4. Writes [`.bohr/deploy.json`](/deploys/deploy-json/), from which bohr generates the production workflow, `.github/workflows/bohr-deploy.yml`.
5. Makes the production build pass.
6. Removes workflows of bohr v1 (`bohr-io/action`), which fail on every push.
7. Tells you what it found, what changed, and anything that cannot be supported.

It takes a few minutes. The project's **Overview** shows *Preparing the repository* in **What is missing** meanwhile.

No provider yet? The project waits: as soon as you save the agent settings, the agent prepares every project that was waiting. You can also start it by hand with **Prepare the repository** in the chat, or **Prepare repository** in the checklist.

## Publishing for the first time

The preparation ends like any other request: with a **preview** and the buttons **Approve and publish** and **Discard**.

1. Open the preview and check the site.
2. Click **Approve and publish**. bohr opens a pull request from `homolog` to your production branch and merges it.
3. The merge runs `bohr-deploy.yml` in GitHub Actions. It asks bohr for your Cloudflare credentials at run time, builds the site and runs `wrangler deploy` to your account.
4. The chat says *Production updated* when the run finishes. Follow it in [Builds](/projects/builds/).

Your site is now a Worker in your Cloudflare account, at its `workers.dev` address. Add your own domain in [Domains](/projects/domains/).

:::tip
Template projects skip this step: their repository already has everything, so their first deploy starts as soon as the project is created.
:::

## When the agent is off

Without a model provider, a project only publishes what reaches GitHub: a push to the production branch runs the deploy workflow, if the repository has one. The project shows **Deploys only** in the list.
