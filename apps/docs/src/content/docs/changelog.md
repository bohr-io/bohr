---
title: Changelog
description: What changed in bohr, version by version, starting with bohr v2.
---

## CLI 4.1.0

- `bohr deploy` deploys projects in your own Cloudflare account, for their owners (admins of the organization): previews as Worker versions with a preview alias per branch, production with the D1 migrations first, both with wrangler and the build variables kept in bohr. Members get exit code 5 (`own_account_not_allowed`). See [Projects in your own Cloudflare account](/cli/deploy/#projects-in-your-own-cloudflare-account).
- The `--json` result of `bohr deploy` has `mode` (`managed` or `byo`); deploys in your own account add `versionId`, `previewUrl`, `workerName` and `commitSha`.
- `own_account` (exit code 5) now only comes from CLI 4.0.0 and earlier: update with `npx bohr@latest`.

## 2.0.0

bohr v2: a rewrite of bohr as an open source, self-hosted deploy platform operated by an AI agent.

### The agent

- An AI agent changes your site by conversation, in the web panel or on a Telegram bot per project.
- Every change goes to a preview (`homolog` branch) first; **Approve and publish** merges it to production, **Discard** drops it, and rollback reverts the last release.
- Model providers: an Anthropic API key, any endpoint compatible with the Anthropic Messages API, or a Claude Pro/Max subscription.
- Budget and maximum turns per request, model and language per project.

### Projects

- Projects run in their owner's Cloudflare account, deployed by a GitHub Actions workflow bohr writes from `.bohr/deploy.json`, with credentials handed out at run time through GitHub OIDC.
- New projects from six templates (Waitlist, Booking, Link in bio, Forms and surveys, Digital menu, Short links), with a D1 database.
- Site and build variables, Basic Auth password protection, custom domains, builds and versions in the panel.
- Members with single-use invite codes; organizations that mirror GitHub organizations, with their own subscription, Cloudflare account and agent.

### Deploy tools

- The `bohr` CLI 4.0.0 (`npx bohr`; versions 2.x and 3.x on npm are an unrelated 2016 package that used the name): `login`, `logout`, `whoami`, `projects`, `link`, `open` and `deploy`, with `--json` output and stable exit codes for scripts and AI agents.
- Tokens in **Account › Tokens**, scoped to projects and with an expiry.
- `bohr-io/deploy-action@v1` runs the CLI in GitHub Actions.

### Running bohr

- Self-hosting with the Deploy to Cloudflare button, opt-in anonymous telemetry.
- bohr.io Cloud at app.bohr.io for US$20/month per account or organization.
- Projects from bohr v1 keep deploying from their workflow, hosted by bohr until their owners move them to their own Cloudflare account.
