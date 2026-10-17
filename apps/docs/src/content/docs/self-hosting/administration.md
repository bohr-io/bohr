---
title: Administration
description: Instance administrators, the Admin area of the panel, and the admin API.
sidebar:
  order: 6
---

## Administrators

The **first person who signs in** to a new instance becomes its administrator. Administrators:

- see the **Admin** area in the panel;
- have owner-level access to every project and organization (the project shows *"You are viewing this project as an administrator"*), and their changes are recorded as an administrator's in the audit log;
- update the project runtimes and choose whether the instance sends [telemetry](/self-hosting/telemetry/).

Tokens for the CLI never carry the administrator role.

## The Admin area

| Page | |
| --- | --- |
| **Overview** | Users, projects and active subscriptions, and **Runtimes**: **Update runtimes** brings every project's Worker to this instance's version |
| **Users** | Search by name, email or username. A user's page lists their projects and organizations, **Make admin** / **Remove admin**, and deleting their account |
| **Projects** | Search by name, repository or owner; status, hosting and runtime of each |
| **Organizations** | Search by name or GitHub login; members, projects and subscription |
| **Telemetry** | The opt-in switch and exactly what would be sent |

The instance needs at least one administrator: *"The instance needs at least one admin."*

## The admin API

Calls with `Authorization: Bearer <ADMIN_TOKEN>`:

```sh
# Make someone an administrator (or "user" to remove it); identify them by email, githubLogin or userId
curl -X POST https://<your instance>/api/admin/users/role \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","role":"admin"}'

# Move every project runtime to this instance's version
curl -X POST https://<your instance>/api/admin/runtimes/update -H "Authorization: Bearer <ADMIN_TOKEN>"

# Point the platform bot at the instance (after setting TELEGRAM_BOT_TOKEN)
curl -X POST https://<your instance>/api/admin/platform-bot -H "Authorization: Bearer <ADMIN_TOKEN>"

# Re-seal every stored credential under the current master key (after a key rotation)
curl -X POST https://<your instance>/api/admin/vault/rewrap -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Keep `ADMIN_TOKEN` secret: it opens `/setup` and these calls.
