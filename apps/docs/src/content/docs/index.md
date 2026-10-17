---
title: bohr documentation
description: bohr deploys your GitHub repository to Cloudflare and lets an AI agent change it by conversation, with a preview you approve before anything reaches production.
---

**Ask more, code less.** bohr turns a GitHub repository into a site that runs on Cloudflare and that you change by talking to an AI agent, in the web panel or on Telegram. Every change lands on a preview first. Nothing reaches production until someone approves it.

## Start here

- [How it works](/introduction/how-it-works/): the path from a repository to production, step by step.
- [bohr.io Cloud or self-hosted](/introduction/cloud-and-self-hosted/): the two ways to run bohr, and what each costs.
- [Getting started](/getting-started/sign-in/): sign in, connect Cloudflare and GitHub, and create your first project.

## Use bohr

- [The agent](/agent/chat/): ask for changes, review the preview, approve or discard, roll back.
- [Projects](/projects/overview/): builds, versions, members, variables, password protection and domains.
- [Deploys](/deploys/how-deploys-work/): how a project builds and publishes, and the files that describe it.
- [Organizations](/organizations/overview/): work as a team, with members that mirror your GitHub organization.

## Automate

- [The `bohr` CLI](/cli/install/): deploy from your terminal, scripts and CI.
- [For AI agents](/ai-agents/overview/): let Claude Code, Cursor, Codex and other coding agents deploy with the CLI.
- [GitHub Action](/github-action/reference/): `bohr-io/deploy-action@v1`.

## Run your own

- [Self-hosting](/self-hosting/overview/): install the open source instance on your own Cloudflare account.
- [Migrating from bohr v1](/migrating-from-v1/overview/): what happened to v1 projects and how to move them to your own account.

:::tip[For AI tools]
Every page has a Markdown copy: add `.md` to its address (for example [`/cli/deploy.md`](https://docs.bohr.io/cli/deploy.md)). The index of all pages is at [`/llms.txt`](https://docs.bohr.io/llms.txt), and the whole documentation in one file at [`/llms-full.txt`](https://docs.bohr.io/llms-full.txt).
:::
