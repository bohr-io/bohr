---
title: Configuration reference
description: The secrets, variables and bindings a self-hosted bohr instance reads.
sidebar:
  order: 4
---

A self-hosted instance is configured by the root `wrangler.jsonc` of the repository and by Worker secrets (`npx wrangler secret put <NAME>`). For local development, put secrets in `.dev.vars` (git ignores it; `.dev.vars.example` lists them).

## Secrets

| Secret | Required | Description |
| --- | --- | --- |
| `ADMIN_TOKEN` | Yes | Protects `/setup` and the admin API. At least 32 random characters: `openssl rand -hex 32`. |
| `ENCRYPTION_KEY` | Yes | The vault's master key: 32 random bytes in base64 (`openssl rand -base64 32`). Accepts several keys while [rotating](/self-hosting/updates-and-backups/#rotate-the-master-key): `k2:<new>,k1:<old>`, current first. Keep a copy. |
| `TELEGRAM_BOT_TOKEN` | No | The [platform bot](/self-hosting/optional-features/#the-platform-bot) for onboarding on Telegram and linking Telegram accounts. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | No | An existing GitHub App, instead of creating one at `/setup`. |

## Variables (`vars`)

| Variable | Default | Description |
| --- | --- | --- |
| `APP_URL` | empty | The instance's public URL. Leave empty to use the address you open `/setup` with. |
| `OIDC_AUDIENCE` | `bohr.io` | The audience the instance expects in GitHub OIDC tokens from deploy workflows. Keep `bohr.io`: the deploy action requests that audience. |
| `BOHR_TELEMETRY` | unset | `off` (or `0`, `false`) keeps [telemetry](/self-hosting/telemetry/) off whatever the panel says. |
| `EMAIL_FROM` | `bohr <noreply@<instance host>>` | The sender of sign-in codes, e.g. `bohr <login@mail.example.com>`. Only with the `EMAIL` binding. |
| `RUNTIME_IMAGE` | `ghcr.io/bohr-io/agent:<version>` | The [agent image](/self-hosting/optional-features/#your-own-agent-image) copied into each account that runs projects. Can also be a secret. |

## Bindings

| Binding | Type | Description |
| --- | --- | --- |
| `DB` | D1 | The instance's database (`bohr`). Created by wrangler on the first deploy; migrations in `apps/instance/migrations`. |
| `PROVISION` | Workflow (`bohr-provision`) | Sets up each project's runtime in its owner's account. |
| `ASSETS` | Static assets | The web panel, built into `apps/web/dist`. |
| `EMAIL` | Send email | Optional: [sign-in with a code by email](/self-hosting/optional-features/#sign-in-with-a-code-by-email). |
| `CLAUDE_LOGIN` | Durable Object + container | Optional: the [dedicated sign-in container](/self-hosting/optional-features/#a-dedicated-sign-in-container). |

## Cron

`17 * * * *` (hourly): housekeeping (expired deploy sessions and one-time codes) and, when enabled, the daily telemetry ping.

## Routes the Worker answers first

`/api/*`, `/auth/*`, `/setup`, `/setup/*`, `/.well-known/*` and `/health`. Everything else is the web panel (a single-page app).

:::note
bohr.io Cloud deploys `apps/instance/wrangler.jsonc`, with hosting for migrated v1 projects and billing turned on. Self-hosted instances deploy the root `wrangler.jsonc`, which leaves those off; you do not need any of their settings.
:::
