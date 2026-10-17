---
title: CI usage
description: Run bohr deploy in GitHub Actions and other CI systems.
sidebar:
  order: 7
---

The CLI notices CI: without a terminal, or with `CI` set, it never asks questions and never opens a browser.

## GitHub Actions with OIDC (no secret)

With `permissions: id-token: write` and no `BOHR_TOKEN`, the CLI signs in with the run's GitHub OIDC token and deploys the run's repository and pushed branch:

```yaml
name: Deploy
on: { push: { branches: ['**'] } }
permissions: { contents: read, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - id: bohr
        run: npx --yes bohr@latest deploy
      - run: echo "Deployed to ${{ steps.bohr.outputs.url }}"
```

- The CLI runs `.bohr/deploy.json`'s install and build first (add `--no-build` if an earlier step built the site).
- In GitHub Actions the CLI writes the step outputs `url` and `deployment-id`, masks secrets with `::add-mask::` and groups its log.
- `--prod`, `--branch` and `--project` need `BOHR_TOKEN`: with OIDC, the run's branch decides.
- Workflows triggered from forks never get OIDC tokens.

This is what [`bohr-io/deploy-action@v1`](/github-action/reference/) does too.

## With a token (any CI)

Create a token in **Account › Tokens** limited to the project, store it as a CI secret, and pass it as `BOHR_TOKEN`:

```yaml
      - run: npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch "$GITHUB_REF_NAME" --json
        env:
          BOHR_TOKEN: ${{ secrets.BOHR_TOKEN }}
```

GitLab CI, with `BOHR_TOKEN` set as a masked CI/CD variable:

```yaml
deploy:
  image: node:22
  script:
    - npx --yes bohr@latest deploy --project p3k9x0a7qd2m --branch "$CI_COMMIT_REF_NAME" --json
```

Production from CI needs a token of a project **owner** and `--prod` (no question is asked without a terminal):

```sh
BOHR_TOKEN=bohr_… npx --yes bohr@latest deploy --prod --json
```

## Branch detection

Without `--branch`, the CLI uses the checked-out branch; on a detached HEAD (common in CI) it falls back to `GITHUB_HEAD_REF`, then `GITHUB_REF`. Elsewhere, pass `--branch` explicitly.

## Pin a version

`npx bohr@latest` always runs the latest release. To pin one, use `npx --yes bohr@4.1.0 deploy`, or add `bohr` to your `devDependencies`.

:::note
With `BOHR_TOKEN`, CI deploys reach projects in your own Cloudflare account too, when the token is an owner's ([how they deploy](/cli/deploy/#projects-in-your-own-cloudflare-account)); in GitHub Actions the step outputs `url` and `deployment-id` are set as well. With OIDC (no `BOHR_TOKEN`), the CLI deploys only projects bohr hosts: projects in your own Cloudflare account deploy through their [deploy workflow](/deploys/deploy-workflow/).
:::
