---
title: Builds
description: The GitHub Actions runs of the project's repository, with their jobs and logs.
sidebar:
  order: 2
---

**Builds** lists the GitHub Actions runs of the repository: every deploy, with its steps and logs, without leaving bohr.

- Each run shows its title, number, branch, status and when it ran. **View on GitHub** opens it there.
- Open a run to see its jobs and each job's **Log**. While a run is in progress, *this page refreshes on its own*.
- **Refresh** reloads the list.

| Status | Meaning |
| --- | --- |
| **Queued** | Waiting for a runner |
| **Running** | In progress |
| **Success** | Finished; for a deploy, production now serves it |
| **Failed** | A step failed; open its log |
| **Cancelled** | Cancelled on GitHub |
| **Skipped** | GitHub skipped it |
| **Action required** | GitHub needs someone to act (for example, approve a run) |

*No builds yet* means GitHub Actions has not run in the repository. For a new project, the first deploy runs after you approve the agent's [preparation of the repository](/getting-started/first-deploy/).

When a deploy fails, the chat says *"The production deploy failed"* with a link to the run, and production keeps serving the previous version. Ask the agent to fix it, pasting the error line if you want: *"The deploy failed with: …. Fix it."* See also [Troubleshooting](/reference/troubleshooting/#deploys).
