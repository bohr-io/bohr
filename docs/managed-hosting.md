# Managed hosting (bohr.io Cloud)

Managed hosting exists for the projects migrated from bohr v1 only. New projects, on bohr.io Cloud as on a self-hosted instance, run in their owner's own Cloudflare account; bohr.io Cloud charges US$20/month for running the instance.

Managed projects run in bohr's Cloudflare account instead of the user's. Every Worker built by a customer lives in one Workers for Platforms dispatch namespace. The instance publishes those Workers; customers never hold a Cloudflare token for bohr's account. Their owners can move them to their own account at any time (see [Moving to the owner's account](#moving-to-the-owners-account)).

```
visitor ──> dispatcher (cloud/dispatcher) ──> customer Worker (dispatch namespace)
                 │ reads ROUTES (KV)
GitHub Actions ──> deploy API (apps/instance) ──> Cloudflare API (namespace scripts, assets, routes)
  (cloud/deploy-action, OIDC)   │ writes D1, ROUTES, R2
```

## Names

| Thing | Format | Example |
| --- | --- | --- |
| Project id | `p` + 11 chars of `[a-z0-9]` | `p3k9x0a7qd2m` |
| Branch slug | branch lowercased, every run of chars outside `[a-z0-9]` replaced by `-`, trimmed of `-`, cut to 40 chars | `feature/Login UI` → `feature-login-ui` |
| Script name | `<project id>-<branch slug>`; when the slug was cut, `-` + first 8 hex chars of sha256(branch) is appended | `p3k9x0a7qd2m-main` |
| Branch hostname (bohr.io) | `<branch slug>-<repo>-<owner>.bohr.io`, or `<repo>-<owner>.bohr.io` for the production branch, as in v1 | `site-acme.bohr.io` |

Hostnames are lowercase. Script names never exceed 63 chars.

## Route record (KV namespace `ROUTES`)

Key: the hostname (`www.example.com`), or `*.<registrable domain>` for a wildcard, as in v1. Value: JSON.

```json
{
  "v": 1,
  "projectId": "p3k9x0a7qd2m",
  "script": "p3k9x0a7qd2m-main",
  "auth": {
    "type": "basic",
    "users": [{ "username": "client", "salt": "<base64, 16 bytes>", "hash": "<base64, 32 bytes>", "iterations": 20000 }],
    "bypassPaths": ["/health"]
  },
  "headers": { "Cross-Origin-Opener-Policy": "same-origin" },
  "suspended": false
}
```

A project that moved to its owner's account leaves its bohr.io addresses as `{ "v": 1, "projectId": "…", "script": "moved", "movedTo": "https://www.example.com" }`, and its custom domains whose zone stayed in bohr's account as `{ "v": 1, "projectId": "…", "script": "moved", "proxyTo": "https://<script>.<subdomain>.workers.dev" }`.

- `auth` is optional. `type` is `none` or `basic`. Password hash: PBKDF2-SHA256(password, salt, iterations), 32 bytes. `bypassPaths` match the URL pathname exactly.
- `headers` is optional; each one is set on every response.
- `suspended: true` answers 503 without calling the customer Worker.
- `movedTo` (an https origin) answers 301 to the same path and query there, before anything else.
- `proxyTo` (an https origin on `workers.dev` only, so the dispatcher never becomes an open proxy) passes the request on as it is (method, headers, body, path and query) to the owner's Worker and returns its answer (redirects included, not followed). A redirect would break APIs: POST bodies and CORS.

### Dispatcher behaviour

1. Look up the hostname; if missing, look up `*.<registrable domain>`.
2. Not found and the hostname starts with `www.`: 301 to the same URL without `www.` (path and query kept). Otherwise 404 page.
3. `movedTo`: 301 to the new origin. `proxyTo`: the owner's Worker answers. `suspended`: 503 page.
4. Basic auth (unless the path is in `bypassPaths`): missing or wrong credentials answer 401 with `WWW-Authenticate: Basic realm="<hostname>"`. A verified `Authorization` value is cached in memory for 5 minutes per isolate, keyed by sha256(hostname + header), so PBKDF2 runs once per visitor per isolate.
5. Dispatch: `env.DISPATCHER.get(script).fetch(request)`. A missing script answers 404.
6. Every response gets `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff` and the record's `headers`.

## Projects migrated from v1: build plans

A repository migrated from bohr v1 keeps its workflow, `.github/workflows/bohr.yml` (`on: push` and `repository_dispatch` of type `bohr-dispatch`, `permissions: write-all`, `actions/checkout`, then `bohr-io/action@main`). The migration opens no pull request and writes nothing into the repository: no workflow, no generated files, no Actions secrets. The operator imports the project (`POST /api/admin/import`), then gives it a build plan and its build variables; from then on, every push the old workflow runs deploys to v2:

1. `bohr-io/action` runs `bohr-io/deploy-action` with `build-plan: "true"`, which calls `POST /api/deploy/build-plan` with the run's GitHub OIDC token (see the action's [README](../cloud/deploy-action/README.md#build-plan-mode-projects-migrated-from-bohr-v1)).
2. With a plan: the action writes the plan's files into the workspace and exports the build variables (masked); `bohr-io/action` sets up the plan's Node.js version, runs its install and build commands, and runs `bohr-io/deploy-action` in its default mode, which deploys as described in [Deploy protocol](#deploy-protocol).
3. Without one (404): `bohr-io/action` falls back to bohr v1 (`npx bohr@latest deploy`).

### Operator API (`Authorization: Bearer <ADMIN_TOKEN>`)

`PUT /api/admin/projects/:id/build-plan` (projects bohr hosts only; 409 otherwise) replaces the plan:

```json
{
  "nodeVersion": "22",
  "install": "npm ci",
  "build": "npm run build",
  "files": { "wrangler.jsonc": "{ … }", ".bohr/worker.mjs": "…", "lambda-adapter.mjs": "…" }
}
```

`nodeVersion` is what `actions/setup-node` accepts (`22`, `20.11.1`, `lts/*`). `install` and `build` are optional; empty or null skips the step. `files` maps paths relative to the repository root to their contents: no absolute paths, no `..`, `.`, empty segments, backslashes or colons, nothing in `.github` or `.git`; at most 100 files and 2 MiB in total. Plans hold no secrets. The answer is `{ "ok": true }`. `GET` on the same path answers the plan (`{ nodeVersion, install, build, files, updatedAt }`, or 404), `DELETE` removes it (`{ "ok": true }`); without a plan, the repository's runs go back to bohr v1.

`PUT /api/admin/projects/:id/build-variables` seals build variables for every branch (`"*"`, the default) or one branch:

```json
{ "branch": "*", "values": { "NEXT_PUBLIC_API": "https://api.example.com", "SENTRY_AUTH_TOKEN": "…" } }
```

Each name is set (or replaced) sealed in `env_vars.value_sealed`, as a secret: the panel shows the names, never the values. Names bohr or GitHub use (`GITHUB_*`, `CLOUDFLARE_*`, `BOHR_*`, `CI`) are refused. Values are never logged or audited (`build_variables.set` records the names). The panel's own variables page seals the build variables of these projects the same way, and deletes a `BOHR_BUILD_<NAME>` Actions secret an earlier migration left in the repository (best effort).

### `POST /api/deploy/build-plan`

`Authorization: Bearer <GitHub OIDC token>`, verified like the deploy calls (issuer, audience `OIDC_AUDIENCE` or `bohr.io`, expiry, signature). The project is found by `repository_id`, else by name for a project imported without an id (the first run records it). No body.

- Not a project bohr hosts, a namesake repository (another id), or no plan: **404** `{ "found": false }`. This is the answer for every repository bohr does not know, so bohr-io/action falls back to v1 cheaply.
- A project with a plan, but suspended, or a run whose `event_name` is not `push`, `workflow_dispatch` or `repository_dispatch` (pull requests never get build variables), or a ref that is not a branch: **403** `{ "error": "<reason>" }`.
- Otherwise **200** (`Cache-Control: no-store`):

```json
{
  "found": true,
  "nodeVersion": "22",
  "install": "npm ci",
  "build": "npm run build",
  "files": { "wrangler.jsonc": "{ … }" },
  "buildVariables": { "NEXT_PUBLIC_API": "https://api.example.com" }
}
```

`buildVariables` are the pushed branch's (`refs/heads/<branch>`; `repository_dispatch` runs on the default branch): the project-wide ones, overridden by the branch's own. No Cloudflare token is ever part of the answer: the deploy itself goes through the deploy protocol. Each answer is audited as `deploy.build_plan` (repository, ref, run id, event and how many variables; never a value). Any workflow of the repository that runs on a push can ask, as any of them could read the Actions secrets v1 used; pull requests, which could come from code nobody merged, cannot.

## Moving to the owner's account

The owner starts it on the project page (`POST /api/projects/:id/move` with a Cloudflare connection):

1. The instance opens a pull request (branch `bohr/move-to-cloudflare`, reset to the production branch each time it is prepared, one commit per file) that leaves the repository deploying production to the owner's account by itself (one Worker per project; branch previews come from the agent):
   - bohr v1's workflows (the ones running `bohr-io/action`, like `bohr.yml`) are deleted first, so the branch's later commits do not deploy to bohr's hosting, and production stops once it is merged;
   - `.github/workflows/bohr-deploy.yml`: the old pull-request migration's workflow is rewritten in place (`wrangler deploy`, production branch only). Otherwise, the workflow bohr writes from `.bohr/deploy.json`, with the `wrangler` target (it replaces one bohr wrote for its hosting; a workflow bohr did not write is refused: the owner changes its deploy step by hand);
   - `.bohr/deploy.json`, when the repository has none, from the [build plan](#projects-migrated-from-v1-build-plans): its install and build (the plain build environment, like `CI=false`, is in front of the build command), its Node.js major and the package manager the commands run. With bohr v1's workflow (or no `.bohr/deploy.json`), the plan's files the repository lacks are added too (`wrangler.jsonc`, `.bohr/*.mjs`);
   - the deploy folder's `wrangler.jsonc`: its `name` (the project's slug when it has none) and the production branch's plain variables in `vars`;
   - an `.assetsignore` when the assets directory is the config's own folder (the source tree; a build's output folder is emptied by the build) and it has none (`assetsIgnoreFile` in `@bohr/shared`): private files and bohr v1's exclusions (`V1_ASSET_EXCLUSIONS`, the rules `BOHR_V1_ASSETS` applies), which `wrangler deploy` would otherwise publish. One the owner wrote is never replaced.

   The workflow asks the instance for the credentials at run time (`POST /api/deploy/credentials` with GitHub OIDC, see [Deploy credentials](architecture.md#deploy-credentials)): the owner's token is never stored in GitHub, and once the move is prepared the instance hands this project's production workflow the token of the connection chosen for the move, with the build variables sealed in bohr.
2. After the merge, GitHub Actions publishes the Worker (named after `wrangler.jsonc`) in the owner's account.
3. `POST /api/projects/:id/move/complete` checks the merge and the Worker, then:
   - copies the runtime secrets to the Worker;
   - for each production custom domain whose zone is **active** in the owner's account: attaches it to the Worker as a Custom Domain, or through a Worker route when Cloudflare refuses one over existing DNS records (100117: v1 served apexes through a route over a placeholder `A 255.255.255.255`); a route for wildcards. When that zone is bohr's own account (the owner connected it), bohr's token retargets bohr's route instead, and that route is kept when bohr stops serving. Then bohr's Worker route and the route record are deleted;
   - a domain whose zone stayed in bohr's account (bohr v1 hosted many customers' DNS; a zone the owner added but whose nameservers still point at bohr's is pending and serves nothing) becomes `proxied`: bohr keeps a route to the dispatcher on its zone and the route record's `proxyTo` passes every request on to the Worker's workers.dev address;
   - leaves the other domains (no zone in either account) as `pending`: they keep serving the last version bohr hosted until the owner adds the zone to their account and completes again;
   - points the bohr.io addresses at the new home with `movedTo`;
   - once nothing is pending: deletes the dispatch scripts and the build plan, sets the project to `byo`, marks the repository as prepared (its pull request did that work; an import afterwards would redo it on a preview older than production) and re-provisions its runtime, if any, so the agent deploys with wrangler.

The project's agent runtime, when it was turned on while bohr hosted the project, keeps running in bohr's account.

## Deploy protocol

Two callers use it: GitHub Actions runs (bohr-io/deploy-action, or `bohr deploy` in a workflow) with a GitHub OIDC token, and the bohr CLI anywhere else with an API token (see [Deploys with an API token](#deploys-with-an-api-token)). The deploy action requests a GitHub OIDC token with audience `bohr.io` and sends it as `Authorization: Bearer <token>`. The instance verifies it against `https://token.actions.githubusercontent.com` (issuer, audience, expiry, signature) and maps `repository` + `ref` (branches only) to a managed project. Unknown repositories get 404. The project also keeps GitHub's `repository_id` (recorded at creation, or on the first deploy for projects imported from v1): a repository that took the name after a rename or delete has another id and gets 403. Installation tokens for a project are restricted by that id too.

### 1. `POST /api/deploy/sessions`

```json
{
  "manifest": { "/index.html": { "hash": "<32 hex chars>", "size": 1234 } },
  "assetsConfig": {
    "notFoundHandling": "single-page-application",
    "htmlHandling": "auto-trailing-slash",
    "runWorkerFirst": ["/api", "/api/*"],
    "redirects": "/old /new 301",
    "headers": "/*\n  X-Frame-Options: DENY"
  }
}
```

Every `assetsConfig` field is optional. `redirects` and `headers` carry the contents of `_redirects` and `_headers` at the root of the assets directory (up to 256 KiB each); the instance passes them to Cloudflare as wrangler does, and the files themselves are not uploaded.

The instance opens an assets upload session for the branch's script in the namespace and answers:

```json
{ "sessionId": "ds_…", "accountId": "…", "uploadToken": "<jwt>", "buckets": [["<hash>", "<hash>"]] }
```

The action uploads each bucket straight to Cloudflare with `POST https://api.cloudflare.com/client/v4/accounts/<accountId>/workers/assets/upload?base64=true`, `Authorization: Bearer <uploadToken>`, a multipart form with one field per hash (base64 content). The last upload returns the completion token in `result.jwt`. With no buckets, `uploadToken` already is the completion token. The upload token only allows uploading files to that session.

Asset hashes are computed the way wrangler computes them, so files already stored are not uploaded again.

### 2. `POST /api/deploy/sessions/<sessionId>/finalize`

Multipart form:

- `metadata` (JSON): `{ "mainModule": "index.js" | null, "compatibilityDate": "2026-10-01", "compatibilityFlags": ["nodejs_compat"], "vars": { "PUBLIC_URL": "…" }, "assetsBinding": "ASSETS" | null, "assetsCompletionToken": "<jwt>" | null, "commitSha": "<sha>" }`. `assetsBinding` is `assets.binding` from the wrangler config (null when the project has no assets directory); `assetsCompletionToken` is null when there are no assets.
- One part per module from `wrangler deploy --dry-run --outdir`, named by its path (`index.js`, `chunk-1.js`, `index.js.map`).

`mainModule: null` means assets only; the instance adds a module that serves `env.ASSETS`. Managed projects may only use assets, `vars` and secrets; other bindings are refused with a message.

The instance uploads the script (`keep_bindings` keeps the secrets set from the panel), stores the bundle in R2 at `deploys/<projectId>/<deploymentId>/`, records the deployment, makes sure the branch hostname has a route record, and answers `{ "deploymentId", "script", "url" }`.

### What is never published, and what migrated projects publish

The CLI never uploads anything named `.git`, `.env` or `.env.<name>` (file or folder, at any depth), whatever `.assetsignore` says; the dispatcher refuses to serve those paths too. A deploy in a job whose build plan step ran (`BOHR_V1_ASSETS=true`, projects migrated from v1) also leaves out the files bohr v1 never published and skips files of 24 MiB or more with a warning, as v1 did (the list is in the action's [README](../cloud/deploy-action/README.md#build-plan-mode-projects-migrated-from-bohr-v1)).

### Never taking a site down

Nothing a visitor sees changes until the finalize call: the session only stores the manifest, and assets go to Cloudflare's upload store, not to the script. Finalize uploads one new script version (`PUT` of the branch's dispatch script, assets and bindings in the same call); if Cloudflare refuses it, the deployment is recorded as `error` (HTTP 502) and the previous version keeps serving. The CLI only calls finalize after every upload succeeded, and never retries it (a repeated finalize could publish twice). Abandoned sessions expire after 2 hours.

## Deploys with an API token

The bohr CLI ([packages/cli](../packages/cli/README.md)) deploys from a terminal, a script or an AI agent with an API token (`Authorization: Bearer bohr_…`): one made by `bohr login` or in the panel (Account › Tokens). The same two calls take it; the session request names the target, which an OIDC token gives by its repository and ref:

```json
{ "projectId": "p3k9x0a7qd2m", "branch": "feature/login", "production": false, "manifest": { … }, "assetsConfig": { … } }
```

The instance checks, at the session and again at finalize:

- the token is valid (not expired or revoked), lists the project (or lists none: all the user's projects), and its user is a member of the project (an organization's projects through the organization). The instance admin role never comes with a token. Otherwise **404**.
- the project is one bohr hosts. A project in its owner's Cloudflare account answers **409** `{ "code": "own_account" }`: the CLI deploys those with wrangler instead (see [Deploy credentials for the CLI](architecture.md#deploy-credentials-for-the-cli)). Suspended: **403**.
- `branch` is a valid git branch name (**400** otherwise). Any branch but production is a preview, open to members.
- the production branch needs `"production": true` (**409** `production_branch` without it; `production: true` with another branch is a **400**), an owner (an admin of the project's organization; **403** `production_not_allowed`), and a production address bohr already serves: one bohr v1 still serves (`pending`) answers **409** `production_on_v1`, so its first production deploy on v2, which moves the address, stays with the repository's workflow.

A session opened with a token is finalized only with that same token, and a session opened by a GitHub run never with a token (**403**). The deployment's actor is `token:<token id>`, with its user.

The CLI defaults to previews: the checked-out branch, and `<production branch>-preview` when that is the production branch; production only with `--prod`.

### CLI routes (`/api/cli`)

| Route | Auth | What it does |
| --- | --- | --- |
| `POST /api/cli/login` `{ clientName }` | none | Starts `bohr login`: `{ deviceCode, userCode, verificationUrl, expiresIn: 600, interval: 5 }`. 20 per IP in 10 minutes |
| `POST /api/cli/login/poll` `{ deviceCode }` | none | `{ status: "pending" \| "denied" \| "expired" }`, or once `{ status: "approved", token, user }` |
| `GET /api/cli/logins/:userCode` | session | The sign-in the panel's `/cli?code=` page shows |
| `POST /api/cli/logins/:userCode/approve`, `…/deny` | session | The signed-in person answers it (**409** once answered or expired) |
| `GET /api/cli/me` | token | `{ user, token: { id, name, projects, expiresAt } }` |
| `DELETE /api/cli/token` | token | Revokes the calling token (`bohr logout`) |
| `GET /api/cli/projects[?repository=owner/name]` | token | The projects the token reaches, with role, production branch, mode and hostnames |
| `GET /api/cli/projects/:id` | token | One of them, and whether it builds from a build plan |
| `POST /api/cli/projects/:id/credentials` `{ branch, production }` | token | Owners of a project in its owner's account: `{ accountId, apiToken, buildVariables, workerName? }` for `bohr deploy` with wrangler (`Cache-Control: no-store`; see [Deploy credentials for the CLI](architecture.md#deploy-credentials-for-the-cli)) |
| `POST /api/cli/projects/:id/deploys` `{ branch, production, workerName, versionId, url, commitSha }` | token | Owners: records what wrangler deployed (table `cli_deploys`) |
| `GET /api/projects/:id/cli-deploys` | session | Members: the project's latest 30 CLI deploys |
| `GET`, `POST /api/me/tokens`; `DELETE /api/me/tokens/:id` | session | The panel's token list (never the tokens), creation (`{ name, projectIds \| null, expiresInDays \| null }`, the token answered once) and revocation |

Device codes are stored as sha256, user codes are 8 letters (`BCDF-GHJK`, 20 consonants), valid 10 minutes, answered once; the approved poll creates the token, named after the computer ("CLI on <hostname>"), for all the user's projects, without expiry.

## D1 (apps/instance)

| Table | Key columns |
| --- | --- |
| `users` | `id`, `name`, `email`, `created_at` |
| `identities` | `user_id`, `provider` (`github` \| `telegram`), `provider_user_id`, `username`; unique (`provider`, `provider_user_id`) |
| `sessions` | `id_hash` (sha256 of the cookie value), `user_id`, `expires_at` |
| `projects` | `id`, `owner_user_id`, `name`, `repo_owner`, `repo_name`, `production_branch`, `mode` (`managed` \| `byo`), `status`; unique (`repo_owner`, `repo_name`) |
| `project_members` | `project_id`, `user_id`, `role` (`owner` \| `member`) |
| `hostnames` | `hostname`, `project_id`, `branch`, `is_production`, `cloudflare_route_id` |
| `deployments` | `id`, `project_id`, `branch`, `commit_sha`, `status`, `script`, `bundle_key`, `created_at` |
| `cli_deploys` | `id`, `project_id`, `branch`, `production`, `worker_name`, `version_id`, `url`, `commit_sha`, `user_id`, `token_id`, `created_at`: deploys `bohr deploy` made with wrangler in an owner's account |
| `env_vars` | `project_id`, `branch` (`*` = all), `key`, `target` (`runtime` \| `build`), `is_secret`, `value` (null for secrets), `value_sealed` (build variables) |
| `build_plans` | `project_id`, `node_version`, `install`, `build`, `files` (JSON `{ path: contents }`) |
| `site_auth` | `project_id`, `branch`, `config` (the route record `auth`) |
| `subscriptions` | `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `price_id`, `status`, `legacy` |
| `v1_migrations` | `project_id`, `v1_site_id`, `status`, `notes` |
| `audit_log` | `actor_user_id`, `action`, `target`, `metadata`, `created_at` |
| `api_tokens` | `id`, `user_id`, `name`, `token_hash` (sha256, unique), `hint` (first characters), `project_ids` (JSON, null: all), `source` (`panel` \| `cli`), `expires_at`, `last_used_at` |
| `cli_logins` | `device_code_hash`, `user_code`, `client_name`, `status` (`pending` \| `approved` \| `denied` \| `done`), `user_id`, `ip_hash`, `expires_at` |
| `deploy_sessions` | … and `token_id`: the API token that opened it (null: a GitHub run) |

Runtime secrets are stored only encrypted (`runtime_secrets`, AES-256-GCM with the instance's `ENCRYPTION_KEY`, bound to project, branch and name). Cloudflare cannot return secret values, so the instance keeps them to bind every deploy, including a new branch's first. Changing one also updates the scripts already deployed. Build variables are sealed in `env_vars.value_sealed` (bound to project, branch and name): those of projects bohr hosts are handed to the build with the build plan, those of projects in their owner's account to the deploy workflow with its credentials. In `env_vars`, `branch` is `*` for every branch.
