---
title: Your account and connections
description: Profile, language, ways to sign in, and disconnecting GitHub, Telegram, Cloudflare and the agent.
sidebar:
  order: 1
---

**Account** (sidebar) gathers your profile and everything connected to your bohr account.

## Profile and language

- **Profile**: your **Name** and **Email**.
- **Language**: the **Interface language** (Português, English, Español). The choice is saved in that browser.
- **Sign out** ends the session on this browser.

## Connected accounts

### Ways to sign in

How you sign in to bohr: **GitHub**, **Email** and **Telegram**. Your account needs at least one.

- **Connect GitHub sign-in** links a GitHub account.
- **Add email**: type the address, **Send code**, type the 6-digit code and **Add email**. *"This email already belongs to another bohr account."* means it is taken.
- **Link Telegram** (when the instance has a platform bot): opens the bot; tap **Start**. Then the project bots recognize you.
- **Remove** a way to sign in. The last one cannot be removed: *"This is the only way to sign in to your account. Add another one before removing it."*

### GitHub App

The GitHub accounts where bohr's app is installed, with how many projects use each. **Disconnect** uninstalls the app from that account and bohr stops accessing its repositories. Projects that still use it must be deleted first; repositories are not changed.

### Cloudflare

The Cloudflare accounts your projects are published to. **Disconnect** deletes the API token bohr kept for that account; sites published there stay online. Projects that still use the account must be deleted first. Also delete the token itself in the Cloudflare dashboard (**My Profile → API Tokens**).

### Telegram

**Disconnect** makes the bohr bot stop recognizing you. Project bots stay in Telegram.

### Agent

Your model **Provider**, **Model** (or *bohr's default*) and the end of your **Key**. **Configure** opens [Model providers](/agent/providers/). **Disconnect** deletes the provider key and turns the agent off in all your projects; they keep publishing what reaches GitHub.

## Also on this page

- **Subscription**: whether your bohr.io Cloud subscription is active, and **See the subscription**. See [Subscription](/billing/subscription/).
- **Agent**: **Set up the agent**.
- **Tokens and the CLI**: **Manage tokens**. See [Tokens](/account/tokens/).
- **Danger zone**: [delete your account](/account/delete-account/).
