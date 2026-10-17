---
title: JSON output
description: The --json output of every command, for scripts and AI agents.
sidebar:
  order: 5
---

With `--json`, a command prints **exactly one JSON object on stdout** and nothing else there; progress and logs go to stderr. It also never asks questions and never opens a browser.

## Success and failure

Success:

```json
{ "ok": true, "...": "the command's fields" }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "production_not_allowed",
    "message": "Only owners of my-site (admins of its organization) can deploy production. Deploy a preview: bohr deploy",
    "exitCode": 5
  }
}
```

The process exits with the same `exitCode` ([exit codes](/cli/exit-codes/)). Branch on `error.code`, not on the message.

## bohr deploy

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "url": "https://feature-new-menu-my-site-acme.bohr.io",
  "deploymentId": "d_…",
  "project": { "id": "p3k9x0a7qd2m", "name": "my-site" },
  "branch": "feature/new-menu",
  "production": false,
  "mode": "managed",
  "files": 42,
  "bytes": 1363148,
  "uploadedFiles": 3,
  "uploadedBytes": 20480,
  "modules": 1
}
```

| Field | Description |
| --- | --- |
| `url` | Where the deployed branch is served |
| `deploymentId` | The deployment's id on the instance |
| `project` | The project, or `null` in GitHub Actions with OIDC |
| `branch`, `production` | What was published (`null` with OIDC) |
| `mode` | `managed`: a project bohr hosts. `byo`: a project in its owner's Cloudflare account (below) |
| `files`, `bytes` | Static files in the assets folder, and their total size |
| `uploadedFiles`, `uploadedBytes` | What actually went up (new or changed files) |
| `modules` | Worker modules (0 for a static site) |

### Projects in your own Cloudflare account

A project in its owner's Cloudflare account is [deployed with wrangler](/cli/deploy/#projects-in-your-own-cloudflare-account), so the upload counts are `null` and wrangler's version comes instead:

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "url": "https://feature-new-menu-my-site.acme.workers.dev",
  "deploymentId": "…",
  "project": { "id": "p8b2m4c6d1ef", "name": "my-site" },
  "branch": "feature/new-menu",
  "production": false,
  "mode": "byo",
  "versionId": "…",
  "previewUrl": "https://1a2b3c4d-my-site.acme.workers.dev",
  "workerName": "my-site",
  "commitSha": "…",
  "files": null,
  "bytes": null,
  "uploadedFiles": null,
  "uploadedBytes": null,
  "modules": null
}
```

| Field | Description |
| --- | --- |
| `url` | A preview's alias URL (else the version's preview URL), or production's address. `null` for a preview of a Worker without preview URLs |
| `deploymentId` | bohr's record of the deploy, or `null` if it could not be recorded (the deploy still succeeded) |
| `versionId` | The Worker version wrangler uploaded or deployed |
| `previewUrl` | The version's own preview URL, when wrangler printed one |
| `workerName` | The Worker deployed |
| `commitSha` | The commit deployed, or `null` when the working tree had uncommitted changes (tag `bohr-local`) |

## bohr projects

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "projects": [
    {
      "id": "p3k9x0a7qd2m",
      "name": "my-site",
      "repository": "acme/my-site",
      "productionBranch": "main",
      "mode": "managed",
      "status": "active",
      "role": "owner",
      "productionUrl": "https://my-site-acme.bohr.io",
      "hostnames": [
        { "hostname": "my-site-acme.bohr.io", "branch": "main", "isProduction": true, "status": "live" }
      ]
    }
  ]
}
```

| Field | Values |
| --- | --- |
| `mode` | `managed`: bohr hosts it. `byo`: the owner's Cloudflare account (only its owners can `bohr deploy` it). |
| `status` | `active`, `migrating` or `suspended` |
| `role` | `owner` (may deploy production) or `member` |
| `hostnames[].status` | `live`, or `pending` while bohr v1 still serves it |

## bohr whoami

```json
{
  "ok": true,
  "instanceUrl": "https://app.bohr.io",
  "user": { "id": "u_…", "name": "Ada Lovelace", "email": "ada@example.com" },
  "token": {
    "id": "tok_…",
    "name": "deploy agent",
    "projects": ["p3k9x0a7qd2m"],
    "expiresAt": "2027-01-10T12:00:00.000Z",
    "source": "BOHR_TOKEN"
  }
}
```

`token.projects` is `null` for a token that reaches all your projects; `source` is `BOHR_TOKEN` or `bohr login`.

## Other commands

| Command | Fields after `"ok": true` |
| --- | --- |
| `bohr link` | `instanceUrl`, `project` (as in `projects`), `path` (the file written) |
| `bohr open` | `instanceUrl`, `url`, `project` (`{ id, name }`), `branch` |
| `bohr login` | `instanceUrl`, `user` |
| `bohr logout` | `instanceUrl`, `signedOut` (`false` when there was no login) |

## Parsing it

```sh
out=$(bohr deploy --json)
status=$?
if [ "$status" -eq 0 ]; then
  echo "Deployed to $(echo "$out" | jq -r .url)"
else
  echo "Failed: $(echo "$out" | jq -r .error.code)" >&2
fi
```
