---
title: DNS of domains bohr hosts
description: Manage the DNS records of a domain whose zone bohr v1 kept in bohr's Cloudflare account, or move it to your own.
sidebar:
  order: 4
---

In bohr v1, a domain could have its whole DNS hosted by bohr: its zone lives in bohr's Cloudflare account, with your email records (MX, DKIM, SPF), your own servers and the records bohr uses to serve your sites. In bohr v2 you keep managing those records in the panel, under **Domains** in the main menu.

## Who sees it

**Domains** only shows up when you have at least one domain like this.

- A domain of your own (it was yours in v1): you see and change its records.
- A domain of an organization: its **admins** change the records; its **members** only see them.

Each change is recorded in bohr's audit log, with the record before and after.

## Change the records

Open the domain. The table lists every record with its type, name, content, TTL, proxy and priority.

- **Add record**: pick the type (A, AAAA, CNAME, MX, TXT, SRV or CAA), the name (`@` for the domain itself, or a subdomain like `www`) and the content. MX and SRV records need a priority. Only A, AAAA and CNAME records can be proxied through Cloudflare; proxied records always have an automatic TTL.
- **Edit** and **Delete** next to a record change it in Cloudflare right away.

If something is wrong with a record, the dialog says what. When Cloudflare itself refuses a record (for example, an identical record already exists), its reason is shown.

| Type | Content |
| --- | --- |
| A / AAAA | An IPv4 or IPv6 address, like `203.0.113.10` |
| CNAME | A host name, like `app.example.net` |
| MX | The mail server, like `mx.zoho.com`, with a priority |
| TXT | The text, like `v=spf1 include:zoho.com ~all` |
| SRV | `weight port target`, like `5 5060 sip.example.com`, with a priority; the name starts with the service and protocol (`_sip._tcp`) |
| CAA | `flags tag value`, like `0 issue "letsencrypt.org"` |

## What is locked, and why

Records marked **Used by bohr** cannot be changed or deleted in the panel:

- The **A, AAAA and CNAME records of the names bohr serves** (the domain and subdomains of your sites hosted by bohr). Many of them point to a placeholder address such as `255.255.255.255`: Cloudflare proxies those names to bohr, which serves the site; the address itself is never reached.
- The **wildcard record** (`*.example.com`) when a site of yours resolves through it.
- The **NS records** of the domain: they are Cloudflare's nameservers.

For the same reason, you cannot add an A, AAAA or CNAME record to a name bohr serves (a second address would split its traffic), nor any record to a name that resolves through the wildcard (its own record would stop the wildcard from answering it).

Everything else is yours: email (MX, DKIM, SPF, DMARC), verifications (TXT), records that point to your own servers, and new subdomains.

## Move the domain to your own Cloudflare account

You can take the domain to a Cloudflare account of your own (the free plan is enough) whenever you want:

1. On the domain's page in bohr, click **Export the records (BIND file)**.
2. If the domain serves sites bohr hosts, [move those projects to your Cloudflare account](/migrating-from-v1/move-to-your-cloudflare/) first, or plan where their names will point: once the nameservers change, bohr no longer answers for the domain.
3. In your Cloudflare dashboard, add the domain (**Add a domain**), then go to **DNS › Records › Import and Export** and import the file. Review the records: remove the placeholder ones (`255.255.255.255`) that only made sense in bohr's account.
4. At your registrar (for example, Registro.br for `.br` domains), replace the nameservers with the two that Cloudflare shows for the domain in your account.
5. Wait until Cloudflare shows the domain as **Active** (usually minutes, up to 24 hours). Then let us know at [contact@bohr.io](mailto:contact@bohr.io) and we remove the copy from bohr's account.
