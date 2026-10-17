---
title: Migration FAQ
description: Common questions from bohr v1 customers.
sidebar:
  order: 5
---

### Do I need to do anything?

No. Your project was moved to bohr v2 for you and keeps deploying from your repository's workflow. Moving it to your own Cloudflare account and turning the agent on are optional.

### Did my price change?

No. Customers who paid for bohr v1 keep the price of their plan. The subscription page shows *The previous bohr version's price*.

### Did my domains or DNS change?

No. Your custom domains and `bohr.io` addresses keep working, with no DNS changes. If you [move the project](/migrating-from-v1/move-to-your-cloudflare/), each domain moves when its zone is in your Cloudflare account. If bohr v1 hosted your domain's whole DNS, you manage its records under **Domains**: see [DNS of domains bohr hosts](/migrating-from-v1/dns/).

### Did bohr change my repository?

No. The migration wrote nothing into your repository: no workflow, no files, no secrets. The move to your own account, if you start it, opens a pull request you review and merge.

### My workflow still says `bohr-io/action@main`. Is that right?

Yes. That action now builds and deploys your project on bohr v2. Leave it as it is while bohr hosts the project.

### Where are my environment variables?

In **Settings › Environment variables**: build variables for the GitHub Actions build, and site variables for the running site. Secret values are hidden.

### Do branch previews still work?

Yes, while bohr hosts the project: every pushed branch gets `<branch>-<repo>-<owner>.bohr.io`. After a move to your account, previews come from the agent (the `homolog` branch) instead.

### Can I use KV, D1, R2 or cron triggers?

Not while bohr hosts the project: hosted projects support static assets, `vars` and secrets. Move the project to your Cloudflare account to use any Cloudflare binding.

### `npx bohr deploy` stopped working in my v1 workflow or terminal.

bohr v2's CLI does not deploy bohr v1 projects or accept v1 options. Your v1 workflow does not need it: it deploys through `bohr-io/action`. Locally, use `bohr deploy` from bohr v2 ([docs](/cli/deploy/)).

### A file larger than 24 MiB disappeared from my site.

bohr v1 never published files of 24 MiB or more, and migrated projects keep that rule. Cloudflare's own limit is 25 MiB per file. Serve large files from storage such as R2 instead.

### Who do I talk to?

[Discord](https://discord.com/invite/p3hhfGg2Uy) or [contact@bohr.io](mailto:contact@bohr.io).
