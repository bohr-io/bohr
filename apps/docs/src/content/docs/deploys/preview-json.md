---
title: .bohr/preview.json
description: Reference of the file that tells bohr how to run the preview's dev server in the agent's sandbox.
sidebar:
  order: 4
---

The [preview](/agent/previews/) is your project's **dev server**, running in the agent's sandbox from the `homolog` branch. `.bohr/preview.json` says how to start it. The agent writes it when it prepares the repository and keeps it working.

```json
{
  "install": "npm ci",
  "command": "npm run dev -- --host 0.0.0.0 --port 8080",
  "port": 8080,
  "env": {}
}
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `command` | Yes | The long-running dev server command (up to 1000 characters). Runs with `bash -lc` in the repository root. |
| `port` | Yes | The port the dev server listens on, 1024 to 65535. Port `4840` is reserved for the bohr agent. |
| `install` | No | Installs dependencies. Runs at the first start and whenever a dependency manifest or lockfile changes. |
| `env` | No | Extra environment variables for `install` and `command`. Never secrets: this file is committed. |

The commands also get `PORT` (the port), `HOST=0.0.0.0`, `BROWSER=none` and `CI=1`.

## Requirements for the dev server

- Listen on `0.0.0.0` (all interfaces) at `port`. Dev servers that only listen on `localhost` also work.
- Accept any `Host` header. Vite, for example, needs `server.allowedHosts: true`.
- Be ready within **3 minutes**. Otherwise the preview is marked failed with the end of its output.
- `install` must finish within 15 minutes.

## When it restarts

- After every request and every sync, the preview restarts if `.bohr/preview.json` or the dependencies changed (`package.json`, lockfiles, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml` and similar, anywhere in the repository), or if it is not running. Otherwise the dev server's own reload picks up the change.
- Stopping kills the whole process group: whatever the command started stops with it.

## States

The preview goes through these states:

| State | Meaning |
| --- | --- |
| `starting` | Installing or waiting for the port |
| `running` | The port accepts connections |
| `failed` | The command exited, or the port did not open in time; the log shows the end of the output |
| `stopped` | No checkout yet, no `.bohr/preview.json`, or an invalid one |

Messages you may see: *"The preview is not set up yet: the agent prepares it when it imports the repository."* (no file yet), and *"The preview could not start. Ask the agent to check the file .bohr/preview.json."*

## Examples

A Worker with a D1 database (the templates):

```json
{
  "install": "npm ci",
  "command": "npx wrangler d1 migrations apply DB --local && npx wrangler dev --ip 0.0.0.0 --port 8080",
  "port": 8080
}
```

Astro:

```json
{ "install": "npm ci", "command": "npx astro dev --host 0.0.0.0 --port 4321", "port": 4321 }
```
