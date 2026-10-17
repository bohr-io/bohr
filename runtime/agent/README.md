# bohr agent runner

The program that runs inside each project's Cloudflare Container. The project's Durable Object (`runtime/project-worker`) owns the container through `ctx.container` and talks to this runner over HTTP. The runner:

- runs **jobs**: checks out the repository, lets the bohr agent (the Claude Agent SDK) change it on the work branch, then commits and pushes the result;
- runs the **preview**: the project's dev server, from `.bohr/preview.json`;
- reports everything as numbered **events**, which it pushes to the Durable Object.

The contract with the Durable Object is `packages/shared/src/agent.ts` (`@bohr/shared`).

## Endpoints

The runner listens on `0.0.0.0:4840` (`AGENT_PORT`). Bodies are JSON.

| Endpoint | Answer |
| --- | --- |
| `GET /health` | `RunnerHealth`: `{ ok, version, busy, jobId?, lastSeq }` |
| `POST /jobs` | Body: `AgentJob`. `202 { accepted: true }`; `409 { error: "busy", jobId }` while a job runs; `400 { error: "invalid_job", issues }` |
| `POST /jobs/:jobId/cancel` | `202` when that job is running (it ends `cancelled`); `404` otherwise |
| `GET /events?after=N` | `{ events, lastSeq }`: buffered events (the last 1000) with `seq > N` |
| `POST /git/sync` | Body: `{ branch }`. Makes the checkout match `origin/<branch>` and answers `{ headSha }`. `404 { error: "branch_not_found" }` when the branch does not exist; `409 { error: "busy" }` while a job runs; `409 { error: "repository_unknown" }` when there is no checkout and no repository to clone (see `BOHR_REPO`) |
| `POST /preview/restart` | `202`; restarts the dev server |
| `GET /preview/status` | `{ status: "starting" \| "running" \| "failed" \| "stopped", port?, log }` |
| `POST /claude-login/start` | Starts the official CLI's `claude setup-token` and answers `{ loginId, url }`, the authorization URL it printed. `409 login_running` while another sign-in runs; `504 timeout` when no URL appears within 30 s; `502 cli_failed` when the CLI cannot start or stops first |
| `POST /claude-login/finish` | Body: `{ loginId, code }`. Types the code into the CLI and answers `{ token }` (`sk-ant-oat01-…`). `400 invalid_code`; `404 unknown_login` (unknown, finished or expired); `422 code_rejected` with the CLI's error line; `504 timeout` after 60 s |
| `POST /claude-login/cancel` | Body: `{ loginId }`. `{ cancelled }` |

`/git/sync` also works on a fresh container (the disk is wiped when the container sleeps): it clones the repository first. It keeps ignored files such as `node_modules`.

## Claude subscription sign-in

An owner can power the agent with their Claude subscription (Pro/Max) instead of an API key. bohr implements no OAuth client: the official CLI the Agent SDK ships (its native binary, `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, found the way the SDK finds it) runs `claude setup-token` here and performs the whole flow. `setup-token` draws a terminal interface and prints nothing without a terminal, so it runs under util-linux `script` in a 4000-column pseudo-terminal, with a fresh temporary `HOME` (deleted afterwards), `BROWSER=true`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and no `ANTHROPIC_*` or `CLAUDE*` variables. The runner reads the authorization URL and the token out of the output, and types the code the user pasted. One sign-in at a time; one nobody finishes ends after 10 minutes. The output, the code and the token are never logged.

Jobs with `auth: "oauth"` run the agent with `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-bohr-placeholder` and no `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` (an API key would take precedence over the token).

## Events

Every event has a `seq` (global, from 1) and an ISO `at`: `job.started`, `job.progress` (a short status line such as "Editing src/App.vue", in the job's locale), `job.message` (text the agent wrote for the user), `job.finished` (exactly one per job) and `preview.status`.

The runner POSTs `{ events }` batches (at most 100) to `http://bohr.internal/v1/agent/events`, which the Durable Object intercepts. It waits about 500 ms so events arriving together share a request, sends one request at a time in `seq` order, and retries failures (network errors, 408, 429, 5xx) with exponential backoff up to 10 s between tries. A batch refused with another 4xx is dropped rather than blocking every later event; the Durable Object can still read it from `GET /events`. Delivery never holds up a job.

## Jobs

1. `job.started`, with the session id (a new UUID, or the session being resumed).
2. Checkout: clone, or fetch with `--prune`. The repository-local git identity is the job's `author`. The work branch starts from `origin/<workBranch>` when it exists, otherwise from `origin/<baseBranch>`; the working tree is reset and cleaned. If the preview is installing dependencies, the job waits for that to finish.
3. The agent runs in the checkout with bohr's instructions appended to the default system prompt, `bypassPermissions` (the container is the sandbox), the repository's `CLAUDE.md` and `.claude/settings.json`, and an in-process MCP server `bohr` with one tool, `ask_user`.
4. Publish: everything left in the working tree is committed (title from the first line of the agent's summary) and `HEAD` is pushed to the work branch, never forced. `job.finished` lists the new commits and `headSha`. When nothing changed, the job succeeds with no commits.

Outcomes:

- **failed** (budget or turns exhausted, an agent error, a push that was refused) and **cancelled**: the work branch is reset to where the job started; nothing is pushed. `summary` explains it in the user's language and `error` carries the technical reason.
- **needs_input**: the agent called `ask_user`. Nothing is committed and the working tree is kept. When the next job resumes that session (`resumeSessionId`) on the same branch, still unchanged on GitHub, it continues from that working tree. If a `/git/sync` happened in between, the agent is told its uncommitted changes were discarded.
- A resumed session whose transcript is gone (the container restarted) starts a new session, and the agent is told so.
- Cancelling stops the job until the agent has finished; once it is committing and pushing, the job completes normally.

Details worth knowing:

- `costUsd` is what this job spent. The SDK reports a resumed session's cost including its earlier runs; the runner subtracts what it reported before for that session.
- Changes under `.github/workflows` never reach GitHub unless the job allows them (`allowWorkflowEdits`), however they were made: the runner puts those files back before committing (folding any commits the agent made into one) and says so in the summary. Workflows run with the repository's secrets. bohr's project Worker never allows them: the sandbox's token cannot push workflow changes anyway, and the Worker writes the deploy workflow itself from `.bohr/deploy.json`.
- Commits and pushes skip git hooks: nobody is there to fix a failing hook after the agent finished, and the agent is asked to run the project's checks itself.
- `node_modules/`, `.venv/`, `__pycache__/` and `.wrangler/` are excluded locally (`.git/info/exclude`), so they are never committed even when `.gitignore` misses them.

## Preview

`.bohr/preview.json` (`previewConfigSchema`): `{ "install": "npm ci", "command": "npm run dev -- --host 0.0.0.0 --port 8080", "port": 8080, "env": {} }`.

- `install` runs at the first start and whenever a dependency manifest or lockfile changed (`package.json`, lockfiles, `requirements*.txt`, `pyproject.toml` and the like, anywhere in the checkout).
- `command` runs with `bash -lc` in its own process group, with `PORT`, `HOST=0.0.0.0`, `BROWSER=none`, `CI=1` and the config's `env`. The preview is `running` once `127.0.0.1:<port>` accepts connections (within 3 minutes), `failed` when the command exits or times out (the event carries the end of the log), `stopped` when there is no checkout or no valid config.
- Restarting stops the whole process group (SIGTERM, SIGKILL after 5 s).
- It starts at boot when the checkout exists. After every job and every `/git/sync`, it restarts when the config or the dependencies changed, or when it is not running; otherwise the dev server's own reload picks up the change.

## Security model

- Credentials never enter the container. The agent gets `ANTHROPIC_API_KEY=sk-ant-bohr-placeholder` (sent as `x-api-key`), or `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-bohr-placeholder` with a Claude subscription (sent as a bearer token), and the git remote is `https://x-access-token:bohr-placeholder@github.com/<owner>/<name>.git`. The Durable Object intercepts HTTPS to `api.anthropic.com` and `github.com` and swaps in the real credentials. The runner also drops any real Anthropic token variables, and variables of a parent agent session, from the agent's environment.
- The exception is the Claude subscription sign-in: `claude setup-token` creates the token inside the container, so it exists there (in the CLI and the runner) until the sign-in ends, and the authorization link comes from the container. Code running in the container at that moment could read the token or swap the link. Instances with the dedicated sign-in container (`runtime/claude-login`, which serves the same endpoints with this package's `ClaudeLogin`) run it there instead, where no project code runs; this path is their fallback.
- The container is the security boundary. The PreToolUse hook is a guard rail that refuses the obvious ways out of bohr's workflow, with a reason the agent can act on: `git push` (also `git -C`, `bash -c`, `$( )`), changing remotes, credential helpers and git aliases, calls to `bohr.internal` or the runner's port, edits under `.git/`, edits to workflows the job does not allow, and writes outside the checkout and `/tmp`. Code the agent runs can still do anything the container allows.
- Because of that, the Durable Object should treat what the container sends as untrusted. For example, it can swap credentials only while a job runs, accept pushes only to the work branch, and check reported events (such as `headSha`) against GitHub.

## Configuration

Everything has a default for the container; the overrides exist for local runs and tests.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOHR_AGENT_PORT` | `4840` | Control server port |
| `BOHR_WORKSPACE_DIR` | `/workspace/repo` | Where the checkout lives |
| `BOHR_GIT_REMOTE_BASE` | `https://x-access-token:bohr-placeholder@github.com` | Remotes are `<base>/<owner>/<name>.git`; tests use a `file://` directory |
| `BOHR_EVENTS_URL` | `http://bohr.internal/v1/agent/events` | Where events are pushed |
| `BOHR_REPO` | | `<owner>/<name>` to clone when `/git/sync` runs before any job on a fresh container. Set it when starting the container |

## Container image

The image is built from the repository root, so it can copy the built runner:

```sh
pnpm --filter @bohr/agent build
docker build --platform linux/amd64 -f runtime/agent/Dockerfile -t bohr-agent .
```

`pnpm build` writes `dist/runner.mjs` (the runner with its dependencies bundled, except the SDK), `dist/package.json` (installs only `@anthropic-ai/claude-agent-sdk`, at the version pinned in this package) and `dist/THIRD_PARTY_LICENSES.txt`. Docker reads `runtime/agent/Dockerfile.dockerignore`, so only those files and `entrypoint.sh` are sent as build context. Cloudflare Containers run `linux/amd64` images.

The image is `node:24-trixie-slim` with git, ripgrep, Python and a C++ toolchain for typical projects, the Sandbox SDK's `sandbox-shim`, and `tini` as init. The entrypoint adds Cloudflare's interception CA (`/etc/cloudflare/certs/cloudflare-containers-ca.crt`) to the system store when present, for git and curl; Node and the agent read it through `NODE_EXTRA_CA_CERTS`. The container runs as root.

The image installs the Claude Agent SDK and its native binary, which are distributed under Anthropic's terms, not the MIT License.

## Development

```sh
pnpm --filter @bohr/agent test        # vitest; needs git, no network
pnpm --filter @bohr/agent typecheck
pnpm --filter @bohr/agent build
pnpm exec biome check runtime/agent   # from the repository root
```

The tests run the job flow against a temporary bare repository with a fake agent backend, so they make no SDK calls. The preview tests start small Node servers. The test that checks bash and process groups only runs on Linux and macOS.

To try the runner locally, build it and start `node dist/runner.mjs` with `BOHR_AGENT_PORT`, `BOHR_WORKSPACE_DIR`, `BOHR_GIT_REMOTE_BASE`, `BOHR_REPO` and `BOHR_EVENTS_URL` pointing at local paths and a local receiver. Jobs call the Anthropic API with the placeholder key, so they need something that swaps in a real one, as the Durable Object does.
