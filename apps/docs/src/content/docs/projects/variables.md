---
title: Environment variables
description: Site variables for the production Worker, and build variables for the GitHub Actions build, including secrets.
sidebar:
  order: 5
---

**Settings › Environment variables** has two lists. Only the owner changes them; members see the names, and the values of plain variables.

## Site variables

They reach the site's **production Worker** at runtime (`env.NAME` in a Worker).

- **In your Cloudflare account**, every site variable is stored as a secret of the production Worker, so it survives deploys, and changes apply right away. bohr keeps the plain values only to show them.
- **Hosted by bohr** (migrated from v1): secret ones apply right away; plain ones from the next deploy.

A site variable can only be set once the site's Worker exists: publish the site once first. If the same name is a plain `vars` entry in your `wrangler.jsonc`, bohr answers *"… is already set in the site's wrangler config: change it there."*

## Build variables

They are kept **encrypted** in bohr and handed to GitHub Actions when it installs and builds the site (for example `NEXT_PUBLIC_API_URL`, `SENTRY_AUTH_TOKEN`). They apply from the next deploy.

The deploy workflow asks bohr for them at run time, with the run's GitHub OIDC token, together with the Cloudflare credentials. Nothing is stored in your repository's secrets. See [The deploy workflow](/deploys/deploy-workflow/).

## Adding a variable

1. Click **New variable**.
2. Type the **Name** and **Value**. Names use letters, digits and `_`, starting with a letter or `_`.
3. Check **Secret** for anything sensitive: once saved, its value is hidden and cannot be shown again (*Hidden value — type to replace it*).
4. Click **Save**.

Names bohr or GitHub use themselves are refused: anything starting with `GITHUB_`, `CLOUDFLARE_` or `BOHR_`, and `CI`.

## In your code

```ts
// A Worker: site variables are on env
export default {
  async fetch(request: Request, env: { RESEND_API_KEY: string }) {
    // use env.RESEND_API_KEY
    return new Response('ok');
  },
};
```

Build variables are ordinary environment variables during `install` and `build` (`process.env.NEXT_PUBLIC_API_URL`).

:::caution
Values in plain `vars` of `wrangler.jsonc` are committed to your repository. Put secrets in **Site variables** marked **Secret**, never in the repository or in the chat.
:::

## Template projects

Projects created from a [template](/getting-started/templates/) have an `ADMIN_PASSWORD` site variable (secret) with the admin area's password. Change it here.
