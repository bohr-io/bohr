---
title: What the agent can and cannot do
description: The agent's tools, its sandbox, and the limits bohr puts around it.
sidebar:
  order: 6
---

The agent is built on the Claude Agent SDK and runs in an isolated **sandbox** (a Cloudflare Container in the project owner's account) with a fresh copy of your repository.

## What it can do

- **Read and change any file** in the repository, and create new ones.
- **Run commands**: install dependencies, build, run tests, type checks and linters. It is asked to run the project's checks before finishing and fix what its change broke.
- **Search** the code, and look things up on the web when the model supports it.
- **Run the preview**: keep `.bohr/preview.json` working so you can see the change.
- **Set up production**: keep `.bohr/deploy.json` and the wrangler config working when a change affects the build.
- **Ask you** when a decision belongs to you (a choice between alternatives it cannot infer), with options as buttons.
- **Follow your repository's instructions**: it reads the repository's `CLAUDE.md` and `.claude/settings.json`.
- **Keep context** across follow-up requests in the same preview.

It writes a summary for a non-technical reader at the end of each request: a title (which becomes the commit message) and a few bullet points on what changed and what to check.

## What it cannot do

| It cannot | Because |
| --- | --- |
| Publish to production | It can only push to `homolog`. Production changes only when someone approves. |
| Push, pull, merge, rebase or switch branches | bohr commits everything left in the working tree and pushes it to `homolog` when the agent finishes. |
| Change GitHub Actions workflows | GitHub refuses changes under `.github/workflows` from the sandbox's token, and bohr puts those files back before committing. If a workflow needs a change, the agent says so in its summary. |
| Change git remotes, credentials or `.git` | Refused by bohr's guard rails. |
| Write outside the repository and `/tmp` | Refused by bohr's guard rails. |
| See your keys | The sandbox only holds placeholders; bohr adds the real model key and a short-lived GitHub token on the way out, only while a request runs. |
| Keep files between sessions | The sandbox's disk is wiped when it sleeps; only what was pushed to GitHub remains. |
| Run git hooks | Commits and pushes skip hooks; the agent runs the checks itself instead. |

Files that are never committed, even when `.gitignore` misses them: `node_modules/`, `.venv/`, `__pycache__/` and `.wrangler/`.

## When a request fails

A request stops when it reaches its **budget** or its **maximum turns**, on an error, or when someone cancels it. Then `homolog` goes back to where it was before the request: nothing half-done is pushed. The chat explains why, in your language. See [Costs and limits](/agent/costs-and-limits/).

## Stateful services and databases

On its first run, the agent maps the project to Cloudflare (see [What you need](/introduction/requirements/#supported-projects)). When a project needs a database or Redis and no connection details are configured, the agent explains what you need to provide. Changes that move queues to Cloudflare Queues or disk writes to R2 change your code, so the agent asks before doing them.
