---
title: Wrangler config and bindings
description: The wrangler config bohr deploys, the bindings each kind of project supports, and what is ignored.
sidebar:
  order: 5
---

Your site is described by a standard Cloudflare **wrangler config**, `wrangler.jsonc` (or `wrangler.json`), in the folder `.bohr/deploy.json` points at. The agent adds one if the repository has none.

```jsonc
{
  "name": "my-site",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

`name` is the name of your production Worker. bohr uses it to find the site for [variables](/projects/variables/), [password protection](/projects/password-protection/) and [domains](/projects/domains/).

## Projects in your own Cloudflare account

They deploy with `wrangler deploy` in your account, so **every binding wrangler supports works**: D1, KV, R2, Durable Objects, Queues, Workflows, Containers, Hyperdrive, AI, cron triggers, routes… Resources a binding refers to must exist in your account (the agent can create them, or you do it in the dashboard).

Things to know:

- `vars` in the config are committed to the repository; secrets go in **Site variables** marked **Secret**.
- With [password protection](/projects/password-protection/) on, the deploy wraps your Worker in a gate and sets `assets.run_worker_first` to `true`, so static files pass through it too.
- D1 migrations run before each deploy: see [D1 databases](/deploys/d1-databases/).

## Projects hosted by bohr

Projects migrated from bohr v1 (until they [move](/migrating-from-v1/move-to-your-cloudflare/)) deploy to bohr's hosting, which supports a subset:

| Key | Supported |
| --- | --- |
| `main` | Yes. Bundled with `wrangler deploy --dry-run`. Leave it out for a static site. |
| `compatibility_date` | Required |
| `compatibility_flags` | Yes |
| `vars` | String values only |
| `assets.directory`, `binding`, `not_found_handling`, `html_handling`, `run_worker_first` | Yes, as in wrangler |
| Secrets | Yes, as [site variables](/projects/variables/) |
| Any other binding (`kv_namespaces`, `d1_databases`, `r2_buckets`, `durable_objects`, `queues`, `services`, `hyperdrive`, `ai`…) | No: the deploy stops with *"bohr.io Cloud managed projects support static assets, vars and secrets for now; … is not supported."* |
| `routes`, `triggers.crons`, `env` sections, `assets.base_path` | Ignored, with a warning |

Also for these projects:

- `wrangler.toml` is not read: convert it to `wrangler.jsonc` (same keys, in JSON with comments).
- A Cloudflare Pages config (`pages_build_output_dir`) is refused: use `"assets": { "directory": "…" }`.
- When the build leaves `.wrangler/deploy/config.json` pointing at a generated config (as the Cloudflare Vite plugin does), that config is used.

## Static assets

For any project, the files in `assets.directory` follow wrangler's rules:

- `.assetsignore` at the root of the folder excludes files (gitignore syntax).
- `_redirects` and `_headers` at the root are applied as routing rules, not served as files (up to 256 KiB each when hosted by bohr).
- Each file can be at most **25 MiB** (Cloudflare's limit).
- bohr's CLI and action never publish `.git`, `.env` or `.env.<name>` files or folders, whatever `.assetsignore` says.
