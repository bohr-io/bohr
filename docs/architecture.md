# Architecture

bohr has three zones: the instance (a control plane someone hosts), the account that runs each project (its owner's Cloudflare account), and the owner's other accounts (GitHub, Anthropic, optionally Neon and Upstash).

```
                 ┌──────────────── instance (apps/instance) ────────────────┐
web, Telegram ──▶│ onboarding · platform bot · vault (D1) · GitHub App      │
                 │ provisioning Workflow · token broker · web API proxy     │
                 └───────┬──────────────────────────────▲───────────────────┘
          Cloudflare API │ (owner's token)              │ signed calls (HMAC)
                 ┌───────▼──────── owner's Cloudflare account ──────────────┐
project bot ────▶│ project Worker (runtime/project-worker)                  │
web chat ───────▶│   Project Durable Object: queue, members, chat, releases │
 (via instance)  │   Container: agent runner (runtime/agent) + dev server   │
visitors ───────▶│ preview Worker ──service binding──▶ Preview entrypoint   │
                 └───────┬──────────────────────────────────────────────────┘
                         │ git over HTTPS, Anthropic API (through the Gateway)
                 GitHub (repo, pull requests, Actions) · Anthropic
```

## Components

| Component | Where it runs | What it does |
| --- | --- | --- |
| Instance (`apps/instance`) | The host's account | Users, sessions, onboarding, the GitHub App (created at `/setup` from a manifest), the vault, provisioning, the token broker, the web API and the platform bot |
| Web interface (`apps/web`) | Static assets of the instance Worker | Onboarding wizard, project chat, preview, versions, members, settings |
| Project Worker (`runtime/project-worker`) | The project owner's account | The project bot's webhook, the runtime API for the web, the `Project` Durable Object with the agent container, the outbound Gateway and the Preview entrypoint |
| Agent runner (`runtime/agent`) | The project's container | HTTP control server; runs the Claude Agent SDK on the repository, commits and pushes to `homolog`, runs the dev server for the preview |
| Preview Worker | The project owner's account | A few lines that forward to the project Worker's Preview entrypoint, at an unguessable workers.dev name |

bohr.io Cloud (US$20/month) runs this same instance; its projects run in their owners' Cloudflare accounts too. The exception is a project whose owner's account cannot run Containers (no Workers Paid, or no Containers: Edit on the token): its runtime (project Worker, container and preview Worker) runs in bohr's own account, decided when the agent is set up, while its deploy target (production, previews, routes, domains) stays the owner's account and token. A self-hosted instance leaves such a project without the agent. bohr.io Cloud also adds `cloud/dispatcher` and `cloud/deploy-action` only for the projects migrated from bohr v1, which bohr hosts until their owners move them (see [managed-hosting.md](managed-hosting.md)).

## A request

1. A member sends a message to the project bot or the web chat. The project Worker checks membership and queues the request in the `Project` Durable Object (SQLite).
2. An alarm starts the container if it sleeps, registers the Gateway for outbound traffic, and posts the job to the runner (`@bohr/shared` agent contract).
3. The runner checks out `homolog` (created from production when missing), runs the agent with the request, a budget and hooks that refuse `git push`, remote changes and workflow edits, then commits and pushes. Events (progress, messages, the result) go to `http://bohr.internal`, which the Durable Object intercepts.
4. When the agent pushed, the Durable Object writes the production deploy workflow (`.github/workflows/bohr-deploy.yml`) from `.bohr/deploy.json` if it changed, then reads the head of `homolog` from GitHub: that commit is what a decision approves.
5. The bot edits one status message while the agent works, then shows the summary, the cost, the preview URL and a link to the diff on GitHub, with **Approve** and **Discard** bound to that preview version. Typed `/approve` and `/discard` show those buttons instead of acting.
6. **Approve** opens the pull request `homolog → main` and squash-merges it only if its head is the reviewed commit; `homolog` is reset to the merge. GitHub Actions deploys production, and the bot reports when the run finishes. **Discard** resets `homolog` to production. `/rollback` merges GitHub's revert of the last release.

Requests run one at a time per project, and each member can have up to five waiting. Requests within one preview cycle continue the same agent session, so follow-ups have context. When the agent needs a decision, it asks with options and the answer resumes its session.

### The deploy workflow

The agent describes the production build in `.bohr/deploy.json` (folder, Node.js version, package manager, install, build and deploy commands). The project Worker renders a fixed template from it: the workflow runs only on pushes to the production branch, with `contents: read` and `id-token: write` (GitHub OIDC), and its commands are single lines without GitHub expressions. Build secrets the project names (`"secrets": [...]`) go to the install and build steps; the Cloudflare token only to the deploy step. For a project in its owner's account, the workflow's first bohr step (`bohr-io/deploy-action@v1` with `credentials: "true"`) asks the instance for the Cloudflare credentials and the build variables (see [Deploy credentials](#deploy-credentials)); no Cloudflare token is kept in GitHub. Pushes to the production branch only come from approved merges, so code the agent wrote runs with the deploy credentials only after someone approved it. bohr only replaces a `bohr-deploy.yml` that starts with its own header: a workflow the team wrote, or the one the v1 migration generated, keeps deploying as it is.

### Environment variables and site protection

The panel manages a project's variables and its password protection; the instance applies them where the site runs:

| | Project in the owner's account | Project bohr hosts (migrated from v1) |
| --- | --- | --- |
| Site variables | Secrets of the production Worker (they survive deploys; bohr keeps only the plain values, to show them) | Stored by the instance and bound on every deploy |
| Build variables | Sealed in the instance (`env_vars.value_sealed`), handed to the deploy workflow with the deploy credentials and exported before install and build. Values an earlier version kept as `BOHR_BUILD_<NAME>` Actions secrets still load until they are saved again, which deletes that secret | Sealed in the instance too, handed to the build with the project's build plan (`POST /api/deploy/build-plan`, see [managed hosting](managed-hosting.md#projects-migrated-from-v1-build-plans)); nothing is kept in the repository |
| Basic Auth | A gate the deploy workflow wraps around the site (`wrangler.bohr-gate.json`), reading the Worker secret `BOHR_SITE_AUTH`; turning it on or off needs no deploy | The dispatcher, from the route record |

Passwords are stored as PBKDF2-SHA256 hashes only. Bypass paths match exactly, or as a prefix when they end with `*`. The gate wraps sites deployed with the default `npx wrangler deploy`; a custom deploy command (in `.bohr/deploy.json`) deploys the site as it is, and the panel says protection does not apply.

## Credentials

| Credential | Stored | Used by |
| --- | --- | --- |
| Owner's Cloudflare API token | Instance vault (envelope-encrypted, every use audited) | Provisioning and updating the owner's project Workers; handed to the production deploy workflow at run time ([Deploy credentials](#deploy-credentials)), never stored in GitHub |
| GitHub App private key | Instance vault | Short-lived installation tokens, scoped to one repository |
| Model provider key (Anthropic API key, a compatible provider's key, or a Claude subscription token) | Instance vault, per user or organization (`services/agent-settings.ts`), and a secret of each of their project Workers | The instance writes it to the project Workers; the Gateway adds it to the container's requests |
| Project bot token, webhook secret | Secrets of the project Worker | Telegram webhook and replies |
| Project secret | Instance vault and the project Worker | Signs the project Worker's calls to the token broker |
| Instance signing key (ES256) | Instance vault; public key in each project Worker | Short-lived tokens for web calls to project Workers |
| API tokens (`bohr_…`) | Only their sha256, in the instance (`api_tokens`); the token itself on the person's computer (`bohr login`) or wherever they put it (`BOHR_TOKEN`) | The bohr CLI: list projects and deploy the projects bohr hosts, as the token's user, limited to the projects it lists; never with the instance admin role ([managed-hosting.md](managed-hosting.md#deploys-with-an-api-token)) |

The container never holds a credential: it sees placeholders, and the Gateway (a `WorkerEntrypoint` registered with `interceptOutboundHttps`) adds the Anthropic key to `api.anthropic.com` and a repository token to git traffic for that repository only. A malicious dependency installed in the sandbox can use the network, but cannot read the keys. The Gateway also limits what borrowed credentials can do:

- The Anthropic key only reaches `POST /v1/messages`, `POST /v1/messages/count_tokens` and `GET /v1/models`, and only while the agent works on a request, not while the dev server runs between requests.
- Pushes are accepted only while a request runs, and may only update `homolog`; production changes only through an approved merge.
- The sandbox's GitHub token has `contents: write` and nothing else. Without the workflows permission, GitHub refuses any push that changes `.github/workflows`, so code in the sandbox cannot add a workflow that would run with the repository's secrets. The project Worker's own token (pull requests, merges, the deploy workflow, workflow runs) never leaves the Worker.
- Credentialed requests do not follow redirects, so a redirect cannot carry a key to another host.
- The public preview URL never reaches the runner's control port.

The preview is served by the sandbox itself, so what a reviewer sees is what the container serves; the diff link in the decision message shows exactly the commit that approving publishes.

### Deploy credentials

A project in its owner's account deploys from GitHub Actions with `wrangler deploy`, and no Cloudflare token lives in the repository. The deploy workflow's `bohr credentials` step requests a GitHub OIDC token (audience `bohr.io`) and calls `POST /api/deploy/credentials`. The instance verifies the token (issuer `https://token.actions.githubusercontent.com`, audience, expiry, signature), finds the project by `repository_id` (by name only for a project that has no id yet, which records it) and answers only when:

- the project runs in its owner's account (`mode = 'byo'`, or a project bohr hosts whose move to the owner's account was prepared: its merged pull request makes the first deploy there);
- `ref` is the production branch, `job_workflow_ref` is `<owner>/<repo>/.github/workflows/bohr-deploy.yml@refs/heads/<production branch>` and `event_name` is `push` or `workflow_dispatch` (so no pull request, other branch, other workflow or reusable workflow from elsewhere gets them);
- the project has a Cloudflare connection of its owner (the user's, or the organization's for an org project): the project's own (`projects.cf_connection_id`, also when its runtime runs in bohr's account), else for older projects its runtime's, or the one chosen for the move. Without one (a runtime in the instance's own account and nothing else), or with a connection holding the instance's token, it is refused.

The answer is `{ accountId, apiToken, buildVariables }`: the owner's stored token (not a temporary one) and the production branch's build variables (project-wide, overridden by the branch's own). The step masks every value, exports the build variables for the install and build, and gives the token and account only to the deploy step (step outputs). Each answer is audited as `deploy.credentials` (repository, ref, run id; never the token). Every refusal is a 403 with the reason. The instance never hands out its own Cloudflare token: projects bohr hosts deploy with the deploy action ([managed hosting](managed-hosting.md)).

Code that runs in the production workflow (approved merges only) can use the token during the run, as before; any other workflow cannot get it. Repositories an older version set up keep the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets until their workflow on the production branch asks bohr instead (the project Worker rewrites it with the next approved change); the next provisioning of the runtime then deletes them.

### Deploy credentials for the CLI

`bohr deploy` (packages/cli) deploys a project in its owner's account with wrangler where the CLI runs, with the same token: it calls `POST /api/cli/projects/:id/credentials` `{ branch, production }` with a bohr API token. The instance answers `{ accountId, apiToken, buildVariables, workerName? }` (`Cache-Control: no-store`) only when:

- the token is valid and lists the project (or lists none), and its user may publish production on it: an owner of the project, or an admin of its organization (the instance admin role never counts). Members get **403** `own_account_not_allowed`, previews included, since the token gives access to the whole account;
- the project runs in its owner's account (`mode = 'byo'`; **409** `hosted` for projects bohr hosts, which deploy through the deploy API) and is not suspended;
- `branch` is valid, and the production branch says `production: true` (as with the deploy API);
- the project's connection is its owner's (as above: a runtime in the instance's account, or a connection holding the instance's token, is refused).

`buildVariables` are the requested branch's (project-wide, overridden by the branch's own); `workerName` is the `name` of the wrangler config on the production branch when the instance can read it, so the CLI refuses to deploy production from a folder whose config names another Worker. Each answer is audited as `cli.credentials` (actor `token:<id>`, the user, the branch, the account and connection; never the token), and one user gets at most 30 per project in 10 minutes (**429**, counted in `audit_log`). The CLI puts the token only in the environment of the wrangler processes; previews are `wrangler versions upload --preview-alias`, which leaves production as it is, and production applies the D1 migrations and runs `wrangler deploy`. It then reports the result to `POST /api/cli/projects/:id/deploys` (table `cli_deploys`, audited as `cli.deploy`), kept apart from `deployments`, whose rows are bohr's own copies in its dispatch namespace.

The instance keeps the model provider keys (sealed, so a new project Worker gets them without asking again), Cloudflare tokens and the GitHub App key, so users must trust whoever hosts the instance; scopes are kept minimal and every use is recorded in `audit_log`.

## State

| Data | Lives in |
| --- | --- |
| Users, identities (GitHub, Telegram), sessions, onboarding | Instance D1 |
| Projects, owners, Cloudflare connections, GitHub installations, runtimes | Instance D1 |
| Members, invites, requests, the chat, preview state, releases, settings | The project's Durable Object (source of truth for access) |
| The repository and the agent's working copy | GitHub; the container's disk is wiped when it sleeps |

## Provisioning a project

The provisioning Workflow (`apps/instance/src/workflows/provision.ts`) runs idempotent, checkpointed steps with the owner's token:

1. Check the account's workers.dev subdomain.
2. Copy the agent image into the account's Cloudflare registry (once per account and version) and prepare it.
3. Upload the project Worker (bundled into the instance at build time) with its Durable Object migration, the container with the `agent` image, its variables and `PROJECT_SECRET`.
4. Create the container application for the Durable Object namespace and enable workers.dev.
5. Upload the preview Worker with a service binding to the `Preview` entrypoint.

Then the owner adds the Anthropic key and creates the project bot (managed bots through the platform bot, or a BotFather token), and the instance asks the agent to import the repository: detect the stack, make the production build pass, add the deploy workflow and the preview settings.

## Open points

- The OCI copy of the agent image into `registry.cloudflare.com`, image preparation and container applications follow wrangler's behaviour and still need validation against real accounts.
- Updating existing project Workers to a new runtime version is manual (retry provisioning) until a bulk update lands.
- Telegram login on the web (OIDC) and Neon/Upstash integrations are planned.
