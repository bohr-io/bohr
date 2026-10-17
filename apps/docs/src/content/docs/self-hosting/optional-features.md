---
title: Optional features
description: The Telegram platform bot, sign-in by email, the dedicated sign-in container and your own agent image.
sidebar:
  order: 5
---

## The platform bot

Users can go through onboarding on the web. A **platform bot** also lets them do it on Telegram (`/new`, `/status`, `/retry`), link their Telegram account to their bohr account, and create each project's bot with one tap.

1. Create a bot with [@BotFather](https://t.me/BotFather). In its settings, allow it to **manage other bots** (Bot API managed bots): that lets it create each project's bot. Without it, users paste a BotFather token instead.
2. Store its token:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```

3. Point the bot at the instance:

   ```sh
   curl -X POST https://<your instance>/api/admin/platform-bot \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```

Without a platform bot, **Link Telegram** says *"This instance has no Telegram bot set up."*; project bots still work with BotFather tokens.

## Sign-in with a code by email

Users can sign in with GitHub, or with a one-time code sent through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/).

1. Enable Email Sending for a domain of yours:

   ```sh
   npx wrangler email sending enable mail.example.com
   ```

2. In `wrangler.jsonc`, uncomment the `send_email` binding and set `EMAIL_FROM`:

   ```jsonc
   "send_email": [{ "name": "EMAIL", "allowed_sender_addresses": ["login@mail.example.com"] }],
   "vars": { "EMAIL_FROM": "bohr <login@mail.example.com>" }
   ```

3. Deploy again. Without the binding, the sign-in page only offers GitHub.

## A dedicated sign-in container

Connecting a [Claude subscription](/agent/providers/#claude-subscription-promax) runs the official CLI's `claude setup-token`. Without anything else, it runs in the container of one of the owner's projects: the owner needs a project whose agent is ready, and a sleeping container has to start first.

A small dedicated container attached to the instance removes both: the connection works before any project exists and starts in seconds. It gets no secrets; the token it returns goes to the instance, never to the browser. Each user or organization signing in gets its own container, which stops 10 minutes after the last use.

It needs Workers Paid on the instance's account and the image in that account's registry:

1. Create an API token with **Containers: Edit** on the instance's account and copy the image (the version in `runtime/claude-login/package.json` by default; pass another image as an argument):

   ```sh
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account ID> node apps/instance/scripts/copy-login-image.mjs
   ```

2. In `wrangler.jsonc`, uncomment `durable_objects`, `migrations` and `containers` under *"Optional: a small dedicated container"*, with your account ID in the image (the script prints the line), and deploy again.

Copy the new image and update its tag when you update bohr.

## Your own agent image

Each project's sandbox runs the image built from `runtime/agent`. On the first project of an account, the instance copies the published image (`ghcr.io/bohr-io/agent:<version>`) into that account's Cloudflare registry. To use your own build:

```sh
pnpm --filter @bohr/agent build
docker build --platform linux/amd64 -f runtime/agent/Dockerfile -t ghcr.io/<you>/bohr-agent:<tag> .
docker push ghcr.io/<you>/bohr-agent:<tag>
npx wrangler secret put RUNTIME_IMAGE   # ghcr.io/<you>/bohr-agent:<tag>
```

The image must be public (GitHub Container Registry or Google Artifact Registry recommended; Docker Hub limits anonymous pulls). Cloudflare Containers run `linux/amd64` images.
