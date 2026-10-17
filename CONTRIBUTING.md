# Contributing

Thanks for helping build bohr.

## Setup

Requirements: Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

## Layout

| Path | What lives there |
| --- | --- |
| `apps/instance` | The control plane Worker: API, onboarding, platform bot, GitHub App, vault (D1), provisioning |
| `apps/web` | The instance's web interface |
| `apps/site` | The bohr.io website |
| `runtime/project-worker` | The Worker each project runs: project bot, queue, sandbox, preview |
| `runtime/agent` | The agent runner inside the sandbox and its container image |
| `packages/shared` | Contracts between the instance, the project Worker and the agent |
| `packages/ui` | The bohr design system (Vue) |
| `packages/cloudflare` | Typed client for the Cloudflare API calls bohr makes |
| `packages/github` | GitHub App authentication and the GitHub calls bohr makes |
| `packages/telegram` | Telegram Bot API client |
| `packages/vault` | Envelope encryption for stored credentials |
| `packages/lambda-adapter` | Runs AWS Lambda style handlers on Workers |
| `cloud/dispatcher` | bohr.io Cloud: routes customer hostnames to their Workers |
| `packages/cli` | The bohr CLI (npm `bohr`): deploys from a terminal, scripts, AI agents and CI; the deploy action runs it |
| `cloud/deploy-action` | bohr.io Cloud: GitHub Action that deploys managed projects, a wrapper that runs the latest CLI |

Read [docs/architecture.md](docs/architecture.md) for how the pieces fit.

## Releasing the CLI and the deploy action

The CLI (`packages/cli`, npm `bohr`) is the deploy code. `bohr-io/deploy-action@v1` installs `bohr@latest` with npm into `RUNNER_TEMP` and runs it with node (`bohr action`), not through npx: npx starts a bin with `sh -c`, which drops the hyphenated `INPUT_*` variables the runner passes the inputs in (`INPUT_BUILD-PLAN`). So a published CLI runs in every repository that uses the action, on its next run.

npm versions: bohr v2's CLI is 4.x. 1.1.x, 2.x and 3.x belong to an unrelated 2016 package; bohr v1 is 1.0.x, and the CLI hands v1 repositories to exactly `bohr@1.0.577` (`src/v1.ts`; a range like `bohr@1` resolves to 1.1.1, which has no executable).

1. **Check.** On the release commit: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then `git diff --exit-code -- cloud/deploy-action/dist` (the committed wrapper is current).
2. **Deploy the instance first** when the CLI needs something new from it: `pnpm --filter @bohr/instance deploy`.
3. **Smoke test the build** with a token (Account › Tokens) limited to a test project bohr hosts:
   ```sh
   BOHR_TOKEN=bohr_… BOHR_SMOKE_PROJECT=p… node packages/cli/scripts/smoke-test.mjs local
   ```
   It checks `--version`, the token (`whoami`) and that it reaches a project bohr hosts (`projects`), that a bohr v1 repository is refused without calling anyone (exit 4), then deploys a throwaway page to the project's `bohr-smoke-test` branch (never production), waits until it is served and checks that `.env` is not. `local` runs `dist/bohr.mjs`; pass a version (`bohr@4.1.1`) or a tarball to test a package (the script's default, `bohr@next`, is no longer published).
4. **Publish.** Bump `version` in `packages/cli/package.json`, commit, then tag and push:
   ```sh
   git tag cli-v<version> && git push origin cli-v<version>
   npm view bohr dist-tags                   # once the "Release CLI" workflow is done: latest is <version>
   ```
   `.github/workflows/release-cli.yml` checks that the tag matches the version, tests, builds and publishes with npm's trusted publishing (GitHub OIDC: no npm token or 2FA code). The package's Trusted Publisher on npmjs.com names the repository the tag is pushed to, that workflow and the `npm` environment. Run the smoke test again with `bohr@<version>`.
5. **Release the action** (only when `cloud/deploy-action` changed): copy `action.yml`, `README.md`, `package.json` and `dist/index.js` into the `bohr-io/deploy-action` repository, commit and push a new tag `v1.<n>`, without moving `v1` yet: every customer repository runs `v1`. Test it first: point a branch of `bohr-io/action` at `bohr-io/deploy-action@v1.<n>`, and in a repository migrated from v1 push a test branch whose `bohr.yml` uses `bohr-io/action@<that branch>`; check the run. Then move `v1`: `git tag -f v1 v1.<n> && git push -f origin v1`. (To run an unpublished CLI in the action, set `BOHR_CLI_PACKAGE` in the step's `env` to a version or a tarball.)
6. **Watch** a few real runs: a migrated repository on a build plan (`bohr.yml`), a project in its owner's account (`bohr-deploy.yml`, credentials mode) and a managed one.

Rolling back: `npm dist-tag add bohr@<previous 4.x> latest` (an owner, with their npm 2FA code) fixes every run at once; `git tag -f v1 v1.<previous>` in `bohr-io/deploy-action` brings back the previous action. Never unpublish a version: deprecate it (`npm deprecate bohr@<version> "<why>"`).

## Pull requests

- Keep each pull request to one change, with tests for the behavior it adds or fixes.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before opening it.
- Never commit secrets. Local values go in `.dev.vars`, which git ignores.
