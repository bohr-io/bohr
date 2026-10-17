---
title: Password protection
description: Ask visitors for a username and password (Basic Auth) before they open the site.
sidebar:
  order: 6
---

**Settings › Authentication** puts a username and password (HTTP Basic Auth) in front of your production site. Use it for a site that is not public yet, or for a client's staging site.

1. Under **Method**, choose **Basic Auth** (or **None** to turn protection off).
2. Under **Users**, add at least one **Username** and **Password** (**New user** adds more). Usernames cannot contain spaces or `:`.
3. Optional: under **Open URLs**, add paths that open without a password (**New URL**). Each path starts with `/`: the exact path, or every path starting with it when it ends with `*` (for example `/api/webhooks/*`).
4. Click **Save**. Protection takes effect within a few seconds, without a deploy.

To change a password, type a new one; leaving it blank keeps the current one (*Password kept — type to change it*). bohr stores only salted PBKDF2-SHA256 hashes, never the passwords.

## How it works

- **In your Cloudflare account**: bohr's deploy workflow wraps your site in a small gate that checks the credentials. The settings live in a secret of your production Worker (`BOHR_SITE_AUTH`), so turning protection on or off needs no deploy. The gate writes `.bohr-gate.mjs` and `wrangler.bohr-gate.json` at deploy time; they are never committed.
- **Hosted by bohr**: bohr's edge checks the credentials before your Worker runs.

:::caution[Custom deploy commands]
The gate only wraps sites deployed with the default command, `npx wrangler deploy`. If your [`.bohr/deploy.json`](/deploys/deploy-json/) sets its own `deploy` command, the panel shows *"Protection does not apply to this site"*: bohr cannot put the protection in front of it.
:::

The preview has its own, unlisted address and is not covered by this setting. Protection applies to the production site.
