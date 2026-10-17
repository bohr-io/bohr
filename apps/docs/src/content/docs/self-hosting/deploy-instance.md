---
title: Deploy the instance
description: Install a bohr instance with the Deploy to Cloudflare button or with wrangler.
sidebar:
  order: 2
---

## With the Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bohr-io/bohr)

Cloudflare copies the repository to your GitHub account, creates the D1 database and asks for two secrets:

| Secret | Value |
| --- | --- |
| `ADMIN_TOKEN` | A random string of at least 32 characters (`openssl rand -hex 32`). It protects `/setup` and the admin API. |
| `ENCRYPTION_KEY` | 32 random bytes in base64 (`openssl rand -base64 32`). The vault's master key. **Keep a copy**: without it, the stored Cloudflare tokens and GitHub App keys cannot be read. |

Leave `APP_URL` empty unless you already know the instance's final address.

## With wrangler

```sh
git clone https://github.com/bohr-io/bohr && cd bohr
pnpm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN      # openssl rand -hex 32
npx wrangler secret put ENCRYPTION_KEY   # openssl rand -base64 32
```

You need Node.js 22 and pnpm 10. `wrangler deploy` runs the build in `wrangler.jsonc` (it bundles each project's Worker into the instance and builds the web panel), creates the D1 database on the first deploy and publishes the Worker, named `bohr`.

The instance applies its database migrations itself on the first request. To apply them by hand:

```sh
npx wrangler d1 migrations apply DB --remote
```

## The address

The instance answers at `https://bohr.<your-subdomain>.workers.dev`, or at a custom domain you add to the Worker. **The address you use to open `/setup` becomes the instance's URL** (unless `APP_URL` is set), and it goes into the GitHub App's callback URLs: use your final domain from the start.

Next: [Create the GitHub App](/self-hosting/github-app/).

## Check it

```sh
curl https://<your instance>/health
```

Opening the instance before `/setup` shows *"This instance is not set up yet"* on the sign-in page, with a link to the setup.
