# bohr

The bohr CLI deploys [bohr](https://bohr.io) projects from your terminal, from scripts and AI agents, and from GitHub Actions. It is the same code that runs inside the `bohr-io/deploy-action` GitHub Action.

```sh
npx bohr login            # once per computer: approve it in the browser
npx bohr deploy           # builds and deploys a preview of the current branch
npx bohr deploy --prod    # production (project owners only)
```

Node.js 20 or later. Install it globally with `npm i -g bohr`, or run it with `npx bohr`.

> **bohr v1?** This is bohr v2's CLI (2.x). It does not deploy bohr v1 projects: in a repository still on bohr v1 it stops with "This repository is not a bohr v2 project" and changes nothing. Move the project to bohr v2 in the panel.

## Sign in

**On your computer:** `bohr login` shows a link and a code, and opens the browser. In the bohr panel, check that the code matches your terminal and approve it. The CLI then keeps a token of its own, named "CLI on &lt;your computer&gt;", in `credentials.json` in your config folder (readable by you only):

| System | Folder |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/bohr` or `~/.config/bohr` |
| macOS | `~/Library/Application Support/bohr` |
| Windows | `%APPDATA%\bohr` |

`BOHR_CONFIG_DIR` overrides it. `bohr logout` revokes the token and forgets it; `bohr whoami` says who the CLI acts as.

**Scripts and AI agents:** create a token in the panel (**Account › Tokens**): a name, the projects it may use (all of yours, or only some), and an expiry. The panel shows it once. Give it to the agent as `BOHR_TOKEN`:

```sh
BOHR_TOKEN=bohr_… npx bohr deploy --json
```

A token acts as you, on the projects you are a member of, limited to the ones it lists; it never carries an instance admin role. Revoke it in the panel at any time. `BOHR_TOKEN` wins over the login stored by `bohr login`.

**GitHub Actions:** with `permissions: id-token: write` and no `BOHR_TOKEN`, the CLI signs in with the run's GitHub OIDC token, like the deploy action: it deploys the run's repository and pushed branch.

## Deploy

```sh
bohr deploy [--prod] [--branch <name>] [--project <id>] [--dir <path>] [--no-build] [--yes] [--json]
```

1. **Which project:** `--project <id>`, else the folder's link (`.bohr/project.json`, written by `bohr link`), else the project of the repository's GitHub remote (`origin`).
2. **Build:** the install and build commands of `.bohr/deploy.json`, in its folder, unless `--no-build`. Your environment is the build's: the build variables kept in bohr are not downloaded.
3. **Upload:** the wrangler config (`wrangler.jsonc` or `wrangler.json`) of that folder, or of `--dir`: the Worker is bundled with `wrangler deploy --dry-run`, and only new or changed static files are uploaded.
4. **Publish:** the URL is printed on stdout (progress goes to stderr).

**Previews by default.** `bohr deploy` publishes the checked-out branch (or `--branch`) to its own address, never production. On the production branch itself, without `--prod`, it publishes a preview on `<production branch>-preview`. `--prod` publishes production: only the project's owners (admins of its organization) may, and at a terminal the CLI asks first (`--yes` skips the question). A project whose production address bohr v1 still serves is left to its workflow, whose first production deploy moves it.

**Nothing goes down.** What is served only changes once every file is uploaded and Cloudflare accepted the new version; any failure before that leaves the previous version online.

**What is never published:** `.git` and `.env` files and folders (`.env`, `.env.production`…), whatever `.assetsignore` says.

Steps 2 to 4 are those of projects bohr hosts. **Projects in your own Cloudflare account** (since 4.1.0) are deployed by wrangler, with the Cloudflare token their owner connected to bohr, so only their owners (admins of the organization) can deploy them from the CLI, previews included; members get exit code 5 (`own_account_not_allowed`) and push a branch instead. The CLI gets the owner's Cloudflare token and account id from the instance (every issuance is audited and rate-limited) and gives them only to wrangler's environment: never printed, logged, put on a command line or written to disk. The build runs with the project's build variables kept in bohr, never with the Cloudflare token or `BOHR_TOKEN`. A preview is `wrangler versions upload` with a preview alias for the branch (it never changes production; the Worker needs `"preview_urls": true`). D1 migrations are not applied for previews, which use the production databases. `--prod` applies the D1 migrations, then runs `wrangler deploy` (or the custom `deploy` command of `.bohr/deploy.json`); if a migration or the deploy fails, Cloudflare keeps serving the previous version. The project's own wrangler is used when installed, else wrangler 4.149.0 through `npx`.

## Other commands

| Command | What it does |
| --- | --- |
| `bohr projects` | Lists the projects the token reaches: id, name, repository, where it runs, your role, URL |
| `bohr link [--project <id>]` | Writes `.bohr/project.json`, so `bohr deploy` and `bohr open` know the project without a remote |
| `bohr open [--branch <name>] [--print]` | Prints the production URL (or a branch's preview) and opens it in the browser |
| `bohr whoami` | The user and token the CLI uses |
| `bohr login` / `bohr logout` | Signs this computer in or out |

Every command takes `--instance <url>` (or `BOHR_INSTANCE_URL`; default `https://app.bohr.io`) for a self-hosted instance, `--json` and `--help`.

## For AI agents and scripts

- `--json` prints exactly one JSON object on stdout: `{ "ok": true, … }` or `{ "ok": false, "error": { "code", "message", "exitCode" } }`. Logs go to stderr.
- Without a terminal, or with `CI` set, the CLI never asks anything and never opens a browser.
- Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed (the build, an upload, wrangler, a D1 migration, the instance, a rate limit) |
| 2 | Wrong usage: unknown option, options that do not go together, no branch on a detached HEAD |
| 3 | Not signed in, or the token was rejected (expired, revoked) |
| 4 | Project not found for this token, or the folder is not a bohr v2 project |
| 5 | Not allowed: production without the owner role, a project in its owner's Cloudflare account without the owner role (`own_account_not_allowed`), a suspended project, a wrangler config for another Worker with `--prod` (`worker_mismatch`). `own_account` only comes from 4.0.0 and earlier: update the CLI |

`bohr deploy --json` answers `{ "ok": true, "instanceUrl", "url", "deploymentId", "project": { "id", "name" }, "branch", "production", "mode": "managed", "files", "bytes", "uploadedFiles", "uploadedBytes", "modules" }` for projects bohr hosts.

For projects in your own Cloudflare account it answers `{ "ok": true, "instanceUrl", "url", "deploymentId", "project": { "id", "name" }, "branch", "production", "mode": "byo", "versionId", "previewUrl", "workerName", "commitSha", "files": null, "bytes": null, "uploadedFiles": null, "uploadedBytes": null, "modules": null }`. `deploymentId` is bohr's record of the deploy (`null` if it could not be recorded; the deploy still succeeded), `url` is `null` for a preview of a Worker without preview URLs, and `commitSha` is `null` when the working tree had uncommitted changes.

A typical agent loop: `bohr projects --json` once, then `bohr deploy --project <id> --branch <name> --json` after each change, reading `url` to check the result.

## GitHub Actions

`bohr-io/deploy-action@v1` runs the latest CLI (`npx --yes bohr@latest action`) with the action's inputs; its README documents them. The CLI also runs as a plain step:

```yaml
permissions: { contents: read, id-token: write }
steps:
  - uses: actions/checkout@v5
  - uses: actions/setup-node@v5
    with: { node-version: 22 }
  - id: bohr
    run: npx --yes bohr@latest deploy
  - run: echo "Deployed to ${{ steps.bohr.outputs.url }}"
```

In GitHub Actions the CLI writes the step outputs `url` and `deployment-id` to `$GITHUB_OUTPUT`, masks secrets with `::add-mask::` and groups its log. With the run's OIDC token it deploys the pushed branch of a project bohr hosts, as the action does (`--prod`, `--branch` and `--project` need `BOHR_TOKEN`). Projects in your own Cloudflare account deploy from GitHub Actions with an owner's `BOHR_TOKEN`, or with their own workflow (`.github/workflows/bohr-deploy.yml`).

## License

MIT. `dist/THIRD_PARTY_LICENSES.txt` lists the licenses of the packages bundled into `dist/bohr.mjs`.
