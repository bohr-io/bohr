---
title: Commands
description: Every bohr CLI command with its options and examples.
sidebar:
  order: 4
---

```
bohr <command> [options]
```

| Command | What it does |
| --- | --- |
| [`deploy`](/cli/deploy/) | Build and deploy this folder (a preview, or production with `--prod`) |
| [`login`](#bohr-login) | Sign in from this computer (approve it in the browser) |
| [`logout`](#bohr-logout) | Sign out: revoke this computer's token and forget it |
| [`whoami`](#bohr-whoami) | Show who the CLI acts as, and with which token |
| [`projects`](#bohr-projects) | List the projects the token can reach |
| [`link`](#bohr-link) | Link this folder to a project (`.bohr/project.json`) |
| [`open`](#bohr-open) | Print the project's URL and open it in the browser |

## Options for every command

| Option | Description |
| --- | --- |
| `--instance <url>` | The bohr instance (default: `$BOHR_INSTANCE_URL`, the folder's link, or `https://app.bohr.io`) |
| `--json` | Print one JSON object with the result, for scripts and AI agents ([schemas](/cli/json-output/)) |
| `-h`, `--help` | Show the help |
| `-v`, `--version` | Print the version (`bohr --version`) |

Unknown options and extra arguments are usage errors (exit code 2).

## bohr login

```sh
bohr login [--instance <url>]
```

Starts a sign-in, prints the link and code, opens the browser (at a terminal) and waits until you approve it in the panel. Stores a token named "CLI on &lt;computer&gt;". See [Authentication](/cli/authentication/#bohr-login).

Fails with exit code 3 when the sign-in is denied (`login_denied`) or the code expires after 10 minutes (`login_expired`).

## bohr logout

```sh
bohr logout [--instance <url>]
```

Revokes the stored token on the instance and deletes it from `credentials.json`. If the instance cannot be reached, it still forgets the token and tells you to revoke it in the panel. Warns when `BOHR_TOKEN` is still set.

## bohr whoami

```sh
bohr whoami [--instance <url>] [--json]
```

```console
$ bohr whoami
Ada Lovelace <ada@example.com> on https://app.bohr.io
Token "deploy agent" (BOHR_TOKEN): 2 selected projects, expires 2027-01-10T12:00:00.000Z
```

## bohr projects

```sh
bohr projects [--instance <url>] [--json]
```

Lists the projects the token reaches:

```console
$ bohr projects
ID            NAME     REPOSITORY      HOSTED       ROLE    URL
p3k9x0a7qd2m  my-site  acme/my-site    bohr         owner   https://my-site-acme.bohr.io
p8b2m4c6d1ef  shop     acme/shop       own account  member  -
```

**HOSTED** is `bohr` for projects bohr hosts and `own account` for projects in their owner's Cloudflare account. `bohr deploy` publishes both; projects in their owner's account only for their owners ([details](/cli/deploy/#projects-in-your-own-cloudflare-account)).

## bohr link

```sh
bohr link [--project <id>] [--instance <url>] [--json]
```

Writes `.bohr/project.json` at the repository root, so `bohr deploy` and `bohr open` know the project without a GitHub remote. Without `--project`, it uses the project of the `origin` remote. The file records the instance too, when it is not the default.

```json
{
  "projectId": "p3k9x0a7qd2m"
}
```

Commit it if everyone working on the folder should deploy to the same project.

## bohr open

```sh
bohr open [--branch <name>] [--print] [--project <id>] [--instance <url>] [--json]
```

Prints the production URL (or `--branch`'s preview) and opens it in the browser. `--print` only prints it. Fails with exit code 4 (`no_address`) when that branch was never deployed.

```sh
bohr open --branch feature/new-menu --print
```

## Debugging

Set `BOHR_DEBUG=1` to print the stack trace of an error on stderr.
