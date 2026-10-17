---
title: Delete your account
description: Remove your bohr account and everything bohr created for it.
sidebar:
  order: 3
---

The **Danger zone** at the bottom of **Account** deletes your account. It cannot be undone.

1. Click **Delete account**.
2. Read what goes and what stays.
3. Optional: check **Also delete the sites published in my Cloudflare account**.
4. Type `DELETE` to confirm (`EXCLUIR` in Portuguese).

## What goes

- All your projects: the agent Workers and the bohr hosting.
- The GitHub App is uninstalled from your accounts.
- The Cloudflare connections are removed.
- The Telegram link is removed.
- The agent settings are deleted.
- The bohr.io Cloud subscription is canceled.

## What stays

- **GitHub repositories are never touched.**
- **Project bots stay in Telegram.** Delete them with BotFather if you want.
- **The sites published in your Cloudflare account stay online**, unless you checked the option, which removes the sites' production Workers from the connected Cloudflare accounts.

## Your organizations

- An organization where you are the **only active member** is deleted with your account.
- In an organization with other members, the projects you created, the Cloudflare connections you made and the subscription you pay pass to another active member (an admin when there is one).
- If you are the **last admin** of an organization with other members, bohr refuses: *"You are the last admin of … Make another member an admin first, or delete the organization."*

On a self-hosted instance, its only administrator cannot delete their account while other users exist (*"You are the only admin. Make someone else an admin first."*).

When something could not be removed, the sign-in page shows *"A few things were left behind and need to be removed by hand"* with the list.
