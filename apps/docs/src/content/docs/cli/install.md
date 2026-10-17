---
title: Install the CLI
description: Install the bohr CLI (npm package bohr) or run it with npx.
sidebar:
  order: 1
---

The **bohr CLI** deploys bohr projects from your terminal, from scripts, from CI and from AI coding agents. It is the same code that runs inside the [`bohr-io/deploy-action`](/github-action/reference/) GitHub Action.

It needs **Node.js 20 or later**.

## Run it with npx

No install needed; always the latest release:

```sh
npx bohr@latest --version
npx bohr@latest deploy
```

## Install it globally

```sh
npm install --global bohr
bohr --version
```

Update with `npm install --global bohr@latest`.

## As a project dependency

```sh
npm install --save-dev bohr
npx bohr deploy
```

## First steps

```sh
bohr login      # once per computer: approve it in the browser
bohr projects   # the projects you can deploy
bohr deploy     # build and deploy a preview of the current branch
```

## Help

```sh
bohr --help             # every command, global options, exit codes
bohr deploy --help      # one command's options
bohr help deploy        # the same
```

:::caution[bohr v1]
This is bohr v2's CLI (version 4.x on npm: versions 2.x and 3.x there belong to an unrelated 2016 package). In a repository still on bohr v1 it hands the command, unchanged, to bohr v1's CLI (`bohr@1.0.577`), so v1 workflows that run `npx bohr@latest deploy` keep deploying as before; the same goes for bohr v1 commands such as `bohr dev`. See [Migrating from bohr v1](/migrating-from-v1/overview/).
:::

:::note[Projects in your own Cloudflare account]
`bohr deploy` publishes projects that **bohr hosts** (projects migrated from bohr v1) and, since CLI 4.1.0, projects in your own Cloudflare account, which only their owners can deploy from the CLI: wrangler deploys them with the owner's Cloudflare connection. See [Projects in your own Cloudflare account](/cli/deploy/#projects-in-your-own-cloudflare-account). The other commands work with every project.
:::
