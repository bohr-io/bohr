---
title: The instance's GitHub App
description: Create the GitHub App your instance uses, and the permissions it asks for.
sidebar:
  order: 3
---

Every instance has its own GitHub App, created from a manifest at `/setup`. bohr uses it to sign people in with GitHub, read repositories, push the agent's work, open and merge pull requests, and write the deploy workflow.

## Create it

1. Open `https://<your instance>/setup`.
2. Fill in:
   - **Admin token**: the `ADMIN_TOKEN` secret.
   - **App name**: up to 34 characters, unique on GitHub (default `bohr <your host>`).
   - **GitHub organization** (optional): to create the App owned by an organization instead of your account.
   - **Other people can install it**: keep it checked if other users will bring their own repositories.
3. Click **Create the GitHub App**. GitHub shows the permissions; confirm.

GitHub comes back to the instance, which stores the App's credentials in the vault. `/setup` then shows the App and a link to install it.

To use another App later, delete the `github_app` setting in the instance's database and open `/setup` again.

## Permissions

| Permission | Why |
| --- | --- |
| Contents: write | The agent pushes to the `homolog` branch; approvals merge to production |
| Pull requests: write | Approvals open and merge pull requests; rollbacks open revert pull requests |
| Workflows: write | The project Worker writes the deploy workflow (the sandbox's own token never gets this permission) |
| Secrets: write | Build variables of projects bohr hosts, and removing Actions secrets that older versions wrote. The Cloudflare token of own-account projects is never stored in GitHub. |
| Actions: read | Reports when the production deploy finishes; the Builds page |
| Metadata: read | Required by GitHub |
| Organization › Members: read | Organizations in bohr mirror the members of the GitHub organization |
| Administration: write | Creates repositories from templates (new projects from a template, only with the user's own authorization) |

Events:

| Event | Why |
| --- | --- |
| **Organization** | Members added to or removed from a GitHub organization: its bohr organization's members follow |
| **Push**, **Pull request** | Subscribed since the first version; bohr acknowledges them and does nothing with them today (deploys run from the repository's workflow) |

**Installation** events reach every App without a subscription: bohr records each installation and links a GitHub organization's installation to its bohr organization.

The webhook goes to `https://<your instance>/api/github/webhook`; on a local instance (`http://localhost`) the webhook is off.

## Apps created by older versions

- **Organizations** need the **Members** organization permission (read-only) and the **Organization** event. Add them in the App's settings on GitHub (*Permissions & events*); each GitHub organization then accepts the new permission. Until it does, bohr only adds the person who installed the App, and the panel asks for the permission.
- **Templates** need the **Administration** repository permission (read and write). Each account that installed the App accepts it once. Until then, GitHub refuses to create the repository and the panel says so.

## Using an existing App

Instead of `/setup`, an instance can read its App from secrets: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_WEBHOOK_SECRET`. See [Configuration](/self-hosting/configuration/).
