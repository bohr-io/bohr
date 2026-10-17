---
title: Install the GitHub App
description: Give bohr access to the repositories it may use, through its GitHub App.
sidebar:
  order: 3
---

bohr reads and changes your repositories through its **GitHub App**, only on the repositories you select.

1. In the **GitHub** step, click **Install on GitHub**. The installation opens in a new tab.
2. Pick your account (or an organization you own) and choose **Only select repositories** or **All repositories**.
3. Confirm, come back to the panel and click **I installed it**.

## What the App can do

GitHub shows these permissions before you confirm:

| Permission | Why |
| --- | --- |
| Contents: write | The agent pushes to the `homolog` branch; approvals merge to production |
| Pull requests: write | Approvals open and merge pull requests; rollbacks open revert pull requests |
| Workflows: write | bohr writes the deploy workflow. The agent's sandbox never gets this permission. |
| Secrets: write | Removes Actions secrets that older versions of bohr wrote |
| Actions: read | bohr tells you when the production deploy finishes, and shows the [Builds](/projects/builds/) |
| Metadata: read | Lists your repositories |
| Organization › Members: read | [Organizations](/organizations/overview/) mirror the members of the GitHub organization |
| Administration: write | Creates repositories from [templates](/getting-started/templates/), only with your own authorization |

The tokens bohr creates from the App are short-lived and limited to one repository. The token the agent's sandbox uses can only write contents.

## Give access to more repositories

When creating a project, a repository missing from the list usually means the App cannot see it. Click **Give access to more repositories on GitHub**, add the repository on GitHub, then **Refresh the list**.

Repositories that are already bohr projects do not show up in the list.

## Remove access

**Account › Connected accounts › GitHub App** lists the accounts where the App is installed. **Disconnect** uninstalls it from that account; projects that still use it must be deleted first. Your repositories are not changed.
