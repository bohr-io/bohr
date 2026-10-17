---
title: Versions and rollback
description: Every release bohr published, and how to return production to the previous version.
sidebar:
  order: 4
---

Each approval becomes a pull request merged into the production branch, and GitHub Actions publishes it. **Versions** (project menu) lists these releases, newest first.

## The list

Each release shows when it was **Published**, the pull request it came **via** (**PR #N**, or a **direct commit**), links to **View PR** and **View commit**, and its status:

| Status | Meaning |
| --- | --- |
| **Publishing** | The GitHub Actions run is deploying it |
| **Live** | The run finished; production serves it |
| **Failed** | The run failed; production kept the previous version |
| **Rolled back** | A rollback reverted it |

## Roll back

Click **Roll back the last release** and confirm. bohr opens and merges a pull request that **reverts** the last release's pull request, using GitHub's revert. GitHub Actions then publishes the previous version.

On Telegram, send `/rollback`.

- Rolling back is itself a release: it shows in the list, and it can be rolled back too.
- It reverts code. Data your site wrote (for example rows in a D1 database) and schema migrations that already ran are not undone.
- If GitHub cannot revert cleanly (a later change touched the same lines), bohr says *"I couldn't roll back"* with the reason. Ask the agent to undo the change instead.

## Changes made outside bohr

Pushes to the production branch that did not come from an approval (yours, your team's, or another tool's) also deploy, through the same workflow. They show in [Builds](/projects/builds/).
