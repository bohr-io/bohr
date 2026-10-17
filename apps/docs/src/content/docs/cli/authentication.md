---
title: Authentication
description: Sign the CLI in with bohr login, use a token from the panel with BOHR_TOKEN, or GitHub OIDC in Actions.
sidebar:
  order: 2
---

The CLI authenticates in one of three ways, in this order:

1. **`BOHR_TOKEN`**, when set: a token from the panel. For scripts, CI and AI agents.
2. **The login stored by `bohr login`**, for that instance. For people at their computer.
3. **GitHub OIDC**, in GitHub Actions without `BOHR_TOKEN` (needs `permissions: id-token: write`).

## bohr login

```sh
bohr login
```

The CLI prints a link and a code, and opens the browser:

```
To sign in, open https://app.bohr.io/cli?code=BCDF-GHJK
and approve "CLI on my-laptop" with the code BCDF-GHJK.
```

In the panel (**Sign in to the bohr CLI**), check that the code matches your terminal and click **Approve**. Approve only a sign-in you started yourself: someone who sends you such a link could otherwise deploy as you. The code is valid for 10 minutes.

The CLI then keeps a token of its own, named **"CLI on &lt;your computer&gt;"**, with access to all your projects and no expiry. It is stored in `credentials.json` in your config folder, readable by you only:

| System | Folder |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/bohr` or `~/.config/bohr` |
| macOS | `~/Library/Application Support/bohr` |
| Windows | `%APPDATA%\bohr` |

`BOHR_CONFIG_DIR` overrides the folder. One login is kept per instance.

```sh
bohr whoami     # who the CLI acts as, and with which token
bohr logout     # revokes this computer's token and forgets it
```

## Tokens for scripts and agents

Create a token in the panel, **Account › Tokens** ([details](/account/tokens/)): a name, the projects it may use, and an expiry. The panel shows it once. Then:

```sh
export BOHR_TOKEN=bohr_…
bohr deploy --json
```

- Tokens start with `bohr_`. Anything else in `BOHR_TOKEN` is refused (exit code 3).
- A token acts as you, on the projects you are a member of, limited to the ones it lists. It never carries an instance administrator role.
- `BOHR_TOKEN` wins over the stored login. `bohr login` warns you when it is set.
- Revoke it in the panel at any time; scripts using it stop at once (exit code 3).

## GitHub Actions with OIDC

In a workflow with `permissions: id-token: write` and no `BOHR_TOKEN`, `bohr deploy` signs in with the run's GitHub OIDC token and deploys **the run's repository and pushed branch**, like the deploy action. `--prod`, `--branch` and `--project` need `BOHR_TOKEN` instead. See [CI usage](/cli/ci/).

## Self-hosted instances

Every command takes `--instance <url>`, or the `BOHR_INSTANCE_URL` variable. The default is `https://app.bohr.io`. The address must use `https` (except `localhost`).

```sh
bohr login --instance https://bohr.example.com
```
