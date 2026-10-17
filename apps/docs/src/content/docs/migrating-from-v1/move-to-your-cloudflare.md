---
title: Move to your Cloudflare account
description: Move a project bohr hosts to your own Cloudflare account, with its secrets and domains.
sidebar:
  order: 3
---

bohr v2 projects run in their owner's Cloudflare account. A project migrated from v1 can move there whenever you want: you get every Cloudflare feature (D1, KV, R2, Durable Objects, cron triggers…) and full control of your domains.

## Before you start

- A Cloudflare account connected to bohr (or connect one during the move). The free plan is enough. See [Connect Cloudflare](/getting-started/connect-cloudflare/).
- For each custom domain to move without downtime, its **zone in that Cloudflare account** (nameservers pointing to Cloudflare). A domain that already has DNS records there is served through a Worker route, which needs **Workers Routes: Edit** on the token (the token link fills it in).
- Only the project's owner (or an admin of its organization) can move it.

## How it works

1. bohr opens a pull request in your repository that switches the deploy to your Cloudflare account, with the build settings and files it needs, and removes bohr v1's workflow.
2. After the merge, GitHub Actions publishes the site in your account, and bohr copies the secrets and moves your domains.
3. The bohr.io addresses start redirecting to the site's new address.

The deploy gets its Cloudflare token from bohr at run time, never from the repository.

## Step by step

1. Open the project's **Settings › Hosting**.
2. Under **Destination Cloudflare account**, pick an account, or **Connect another account**.
3. Click **Prepare the move** and confirm. bohr opens a pull request (branch `bohr/move-to-cloudflare`) that leaves the repository deploying to your account by itself. The site only changes after the merge. The pull request:
   - writes the [deploy workflow](/deploys/deploy-workflow/) (`.github/workflows/bohr-deploy.yml`): `wrangler deploy` to your account on pushes to the production branch;
   - adds `.bohr/deploy.json` when the repository has none, with the install and build commands and the Node.js version bohr used to build the site, and the files bohr generated at every deploy (`wrangler.jsonc`, the files in `.bohr/`);
   - writes the Worker's name and your plain (non-secret) production variables into `wrangler.jsonc`;
   - when the site is served straight from the project's folder (no build output folder), adds an `.assetsignore` there if it has none, so `wrangler deploy` does not publish private files (`.git`, `.env*`, `node_modules`, `.github`, `.bohr`, `wrangler.json*`) nor what bohr v1 never published (`package.json`, lockfiles, `/api/`…). An `.assetsignore` you already have stays as it is;
   - removes bohr v1's workflow (`bohr.yml`, which runs `bohr-io/action`), so the site stops deploying to bohr's hosting.
4. Review and merge the pull request on GitHub (**Open #N on GitHub**).
5. Wait for the GitHub Actions deploy to finish.
6. Come back and click **Finish the move**.

**Finish the move** checks the merge and the new Worker, then copies the secrets to it, attaches your custom domains whose zones are in your account, and points the bohr.io addresses at the new home. Build variables stay sealed in bohr: the deploy workflow gets them at run time. If it says *"It cannot be finished yet"*, check that the pull request is merged and the deploy finished, and try again.

## The addresses afterwards

| Status | Meaning |
| --- | --- |
| **In your account** | The domain now points at the Worker in your account |
| **Redirects** | The bohr.io addresses redirect (301) to the site's new address |
| **Pending** | The domain's zone is not in your account yet. Add it, point its nameservers to Cloudflare, and click **Finish the move** again. Until then, it keeps showing the last version bohr published. |
| **Turned off** | Branch preview addresses are no longer deployed: in your account, previews come from the agent |

When nothing is pending: *"Done! The project now runs in your Cloudflare account."* From then on it is a regular bohr v2 project: [domains](/projects/domains/), [variables](/projects/variables/) and the [deploy workflow](/deploys/deploy-workflow/) work as for any project in your account. If the agent was on, it keeps working: its sandbox stays where it was created, and from now on it deploys to your account.

## When the move cannot be prepared automatically

Some repositories cannot be moved automatically, for example when `.github/workflows/bohr-deploy.yml` is a workflow bohr did not write, or the build commands do not fit `.bohr/deploy.json` (a command over several lines). The panel then says *"The move could not be prepared automatically."* Talk to us on [Discord](https://discord.com/invite/p3hhfGg2Uy) or at [contact@bohr.io](mailto:contact@bohr.io): we help you change the deploy step by hand.
