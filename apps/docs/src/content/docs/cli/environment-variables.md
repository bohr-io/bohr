---
title: Environment variables
description: The environment variables the bohr CLI reads.
sidebar:
  order: 8
---

| Variable | Description |
| --- | --- |
| `BOHR_TOKEN` | A token from **Account › Tokens** (`bohr_…`). Wins over the login stored by `bohr login`. |
| `BOHR_INSTANCE_URL` | The bohr instance, for self-hosted instances. Default `https://app.bohr.io`. `--instance` wins over it. |
| `BOHR_CONFIG_DIR` | Where `credentials.json` lives. Default: `$XDG_CONFIG_HOME/bohr`, `~/.config/bohr` (Linux), `~/Library/Application Support/bohr` (macOS), `%APPDATA%\bohr` (Windows). |
| `XDG_CONFIG_HOME` | Used for the config folder when `BOHR_CONFIG_DIR` is not set. |
| `BOHR_DEBUG` | Any value prints error stack traces on stderr. |
| `CI` | When set, the CLI never asks and never opens a browser. |

Variables the CLI reads in GitHub Actions:

| Variable | Use |
| --- | --- |
| `GITHUB_ACTIONS` | Turns on the Actions log format, outputs and masks |
| `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` | Present with `id-token: write`: the CLI can sign in with OIDC |
| `GITHUB_SHA` | The commit recorded with the deployment |
| `GITHUB_HEAD_REF`, `GITHUB_REF` | The branch, on a detached HEAD |
| `GITHUB_OUTPUT` | Where the step outputs `url` and `deployment-id` go |

## Precedence of the instance

1. `--instance <url>`
2. `BOHR_INSTANCE_URL`
3. `instanceUrl` in the folder's `.bohr/project.json` (`bohr deploy` and `bohr open`)
4. `https://app.bohr.io`
