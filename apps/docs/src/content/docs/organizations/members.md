---
title: Organization members and roles
description: How organization members mirror GitHub, their roles, and how to change or remove access.
sidebar:
  order: 2
---

**GitHub is the source of the members.** bohr mirrors the members of the GitHub organization: owners on GitHub become **admins** in bohr, everyone else **members**.

| Role | Can |
| --- | --- |
| **Admin** | Everything a project owner can on every project of the organization (settings, domains, variables, deleting); the organization's settings, subscription, Cloudflare account and agent; members' roles |
| **Member** | Work on every project of the organization: ask for changes, approve, discard, roll back |

Members need no subscription, Cloudflare account or model key of their own.

## Keeping in sync

- People added to or removed from the GitHub organization follow automatically (GitHub notifies bohr).
- **Sync with GitHub** on the **Members** page syncs by hand: *"Members synced: N added, N removed, N updated."*
- People without a bohr account yet show as **Pending** (*"Joins when they sign in to bohr with GitHub."*). They become active when they sign in with that GitHub account, or link it to their bohr account.

## Changing access in bohr

Admins can change things in bohr without touching GitHub. The **Source** column shows **Changed in bohr** for those.

- **Make admin** / **Make member**: the role lasts until that person's role changes on GitHub.
- **Remove**: the person loses access to the organization's projects in bohr. They stay in the GitHub organization, and syncing doesn't bring the access back.
- The organization needs at least one admin: *"The organization needs at least one admin. Make someone else an admin first."*

## When members are not imported

If the GitHub App lacks the **Members: read** permission on the organization, only the person who installed it is added, and the page says *"The members were not imported"*. Grant the permission on GitHub (the organization's App settings ask you to accept it), then **Sync with GitHub**.

## Project members outside the organization

Project [invites](/projects/members/) also work in organization projects, for people outside the GitHub organization such as a client who reviews the preview.
