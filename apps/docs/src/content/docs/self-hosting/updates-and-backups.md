---
title: Updates and backups
description: Update your instance and the project runtimes, back up its database, and rotate the master key.
sidebar:
  order: 7
---

## Update the instance

Pull the upstream changes into your copy of the repository and deploy again:

```sh
git pull upstream main
pnpm install
npx wrangler deploy
```

If you used the Deploy to Cloudflare button, push the changes to the branch Workers Builds deploys. New database migrations run on the first request after the deploy.

## Update the project runtimes

Each project's Worker (the agent, the bot and the preview) runs the version it was created with. After updating the instance, bring them all to the new version:

- **Admin › Overview › Update runtimes**, or
- the admin API:

  ```sh
  curl -X POST https://<your instance>/api/admin/runtimes/update -H "Authorization: Bearer <ADMIN_TOKEN>"
  ```

While a runtime updates, the previous version keeps serving; a failed update leaves it running as it was. If you use the [dedicated sign-in container](/self-hosting/optional-features/#a-dedicated-sign-in-container), copy its new image too.

## Back up

What to keep safe:

| What | Where | How |
| --- | --- | --- |
| `ENCRYPTION_KEY` | A Worker secret | Keep a copy outside Cloudflare (a password manager). Without it, stored Cloudflare tokens, GitHub App keys and agent keys cannot be read. |
| `ADMIN_TOKEN` | A Worker secret | Keep a copy; you can also replace it with `wrangler secret put`. |
| The instance's database | D1 `bohr` | `npx wrangler d1 export bohr --remote --output bohr-backup.sql`. D1's Time Travel can also restore it to a recent point in time. |

The instance's database holds users, sessions, projects, organizations, connections (encrypted) and settings. Each project's members, chat and releases live in the project's Durable Object, in its owner's Cloudflare account; the code lives in GitHub.

## Rotate the master key

`ENCRYPTION_KEY` accepts several keys, current first: `k2:<new base64>,k1:<old base64>`. New values are sealed with `k2`; old ones still open with `k1`. To move everything to `k2`, then drop `k1`:

```sh
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>,k1:<old base64>
curl -X POST https://<your instance>/api/admin/vault/rewrap -H "Authorization: Bearer <ADMIN_TOKEN>"
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>
```
