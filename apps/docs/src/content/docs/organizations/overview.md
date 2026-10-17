---
title: Organizations
description: Work as a team in a bohr organization, which mirrors a GitHub organization.
sidebar:
  order: 1
---

A bohr **organization** is a GitHub organization with bohr's GitHub App installed. Its members come from GitHub, and it has its own subscription (on bohr.io Cloud), Cloudflare account and agent settings, separate from each person's.

## Create an organization

You need a GitHub organization where you are an **owner**. bohr cannot create GitHub organizations: create one on GitHub first if needed (**Create an organization on GitHub**).

1. Open the context menu at the top of the panel and choose **New organization**.
2. Click **Install the GitHub app on an organization**.
3. On GitHub, pick the organization and the repositories bohr can access, and confirm.
4. GitHub brings you back to the organization's page in bohr.

bohr imports the organization's members with the matching role: GitHub owners become **admins**, everyone else **members**. If the App was installed outside bohr by someone who already uses bohr, the organization is created too.

## Set it up

The organization's page shows **Set up the organization** to its admins, with three steps (like your own account):

| Step | |
| --- | --- |
| **Subscription** | bohr.io Cloud only: the organization's own subscription, paid by an admin. Members don't need one. |
| **Cloudflare** | The Cloudflare account where every project of the organization runs. Same token and plans as [for yourself](/getting-started/connect-cloudflare/): the free plan works, and the agent needs Workers Paid on a self-hosted instance. |
| **Agent** | The provider and key the agent uses in every project of the organization. Same options as [your own](/agent/providers/), including a Claude subscription. |

Until it is set up, members see *"An admin of the organization still needs to finish its setup (subscription and Cloudflare account) before projects can be created."*

## Switch between personal and organization

The context menu at the top of the panel (**Work in**) lists **Personal** and each of your organizations. The project list, **New project** and settings follow the context you pick.

- Projects created in an organization use the organization's Cloudflare account and agent, whoever creates them.
- On your personal context, a list reminds you of organizations whose projects need no setup in your account.

## Organization pages

| Page | |
| --- | --- |
| **Projects** | The organization's projects, and **New project** (one of the organization's repositories) |
| **Members** | Members, roles and sync with GitHub. See [Members and roles](/organizations/members/). |
| **Settings** | General, Cloudflare, agent, subscription and the danger zone. See [Settings and billing](/organizations/settings-and-billing/). |
