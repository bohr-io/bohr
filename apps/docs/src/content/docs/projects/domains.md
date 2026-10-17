---
title: Custom domains
description: Attach domains of your Cloudflare account to the production site.
sidebar:
  order: 7
---

**Settings › Domains** attaches domains to your production site as Cloudflare **Custom Domains** of its Worker. Cloudflare creates the DNS record and the certificate automatically.

## Before you start

- The site must be **published once**: domains attach to the site's Worker, which the first deploy creates. Until then the page says *"The site is not published yet"*.
- The domain must be a **zone in the same Cloudflare account** the project runs in. If the domain is elsewhere, add it to Cloudflare first (and point its nameservers to Cloudflare). If the account has no zones, the page says *"Your Cloudflare account has no domains yet."*

## Add a domain

1. Under **Add a domain**, pick the zone in **Domain on Cloudflare**.
2. Optional: type a **Subdomain** (`www`, `shop`…). Leave it empty for the zone itself.
3. Check *The site will open at …* and click **Add**.

It can take a few minutes for the certificate. The page also shows the site's **Worker** and its **workers.dev address**, which keeps working.

Wildcards (`*.example.com`) are not accepted.

## Remove a domain

Click **Remove** next to it and confirm. The site stops opening at that domain; the DNS record goes with it.

## Projects hosted by bohr

Projects migrated from bohr v1 keep the domains they had in v1, served by bohr (each shows **Live** or **Pending**). To change them, [move the project to your Cloudflare account](/migrating-from-v1/move-to-your-cloudflare/).
