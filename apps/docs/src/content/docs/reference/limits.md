---
title: Limits
description: Every size, time and count limit in bohr, in one place.
sidebar:
  order: 3
---

## The agent

| Limit | Value |
| --- | --- |
| Budget per request | US$5 by default; owner sets it (0.10 to 1000, in the panel or on Telegram) |
| Maximum turns per request | 200 by default; 1 to 1000 |
| Running time per request | 2 hours |
| Request length | 20,000 characters |
| Waiting requests | 5 per member; one runs at a time per project |
| Questions from the agent | Up to 8 options |
| Preview start | The dev server must accept connections within 3 minutes; `install` within 15 minutes |
| Reserved port | 4840 (the agent's control server) |

## Deploys

| Limit | Value |
| --- | --- |
| Static file size | 25 MiB per file (Cloudflare). Migrated v1 projects skip files of 24 MiB or more. |
| `_redirects`, `_headers` | 256 KiB each (projects bohr hosts) |
| Deploy workflow | 30 minutes per run; one run at a time per repository |
| `.bohr/deploy.json` commands | One line, up to 500 characters, no `${{ }}` |
| `.bohr/deploy.json` `secrets` | Up to 50 names |
| `.bohr/preview.json` commands | Up to 1000 characters |
| Deploy sessions (CLI and action) | Expire after 2 hours |
| Preview branches a token creates | 20 per project bohr hosts, counting its existing previews; a branch that has a preview keeps deploying |
| Projects per repository | One |

## Accounts and access

| Limit | Value |
| --- | --- |
| Session in the panel | 30 days |
| Email sign-in code | 6 digits, valid 10 minutes, 5 attempts |
| `bohr login` code | Valid 10 minutes |
| Project invite code | Single use, valid 24 hours |
| Tokens per user | 50 |
| Token expiry | 30, 90 or 365 days, or never |
| Telegram budget command | 0.10 to 1000 (US$) |

## Projects bohr hosts

Static assets, `vars` (strings) and secrets only; no other bindings and no cron triggers. See [Wrangler config](/deploys/wrangler-config/#projects-hosted-by-bohr).
