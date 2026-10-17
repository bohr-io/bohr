---
title: Members and roles
description: Invite people to a project with single-use codes, and manage who has access.
sidebar:
  order: 3
---

Everyone in a project can ask for changes and approve releases. Only the **owner** manages keys, settings and access.

| Role | Can |
| --- | --- |
| **Owner** | Everything: settings, variables, domains, authentication, invites, removing members, deleting the project |
| **Member** | Ask for changes, approve, discard and roll back, cancel their own requests, see settings |

The project's owner is whoever created it. In an [organization](/organizations/members/), the organization's admins are the owners of all its projects, and its members are members: they do not need invites.

## Invite someone

1. Open **Members** and, under **Invite someone**, click **Create an invite code**.
2. Share the code (**Copy the code**) or the link (**Copy the link**). The code is single use and valid for **24 hours**.
3. The person either:
   - opens the link, signs in with their own account and the code is already filled in (**Join the project**); or
   - sends `/join <code>` to the project's Telegram bot.

Codes look like `K7P2-9QXM` and are forgiving when typed by hand: case, spaces and the letters `I`, `L` and `O` are fine. On Telegram, the owner can also send `/invite`.

## Remove someone

Click **Remove** next to the person and confirm. They lose access to the project on the web and on Telegram right away, and their waiting requests are cancelled. The owner cannot be removed.

On Telegram: `/members` lists people with numbers, and `/revoke <number>` removes one.
