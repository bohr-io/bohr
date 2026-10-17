# bohr v2

bohr deploys a GitHub repository as a Cloudflare Worker and lets an AI agent change it by conversation; each change
lands on a preview ("homologação") that the owner approves before production. Open source and self-hosted, and run
as bohr.io Cloud (app.bohr.io).

**Two repositories.** Work happens in the private `bohr-io/bohr-cloud`. The open-source `bohr-io/bohr` is a copy
of it without `internal/`, published by hand (`node internal/publish-public.mjs`), never pushed to directly.
`internal/` holds what must stay private: operating bohr.io Cloud (deploys, releases, incidents), the state of
the v1 migration and its customers, pending work and product decisions. **Start there:**
[internal/README.md](internal/README.md) (it does not exist in the public copy). Customer data and secrets never
go anywhere else in the repository, nor in commit messages: commits reach the public copy.

The package map is in [CONTRIBUTING.md](CONTRIBUTING.md#layout); how the pieces fit, in
[docs/architecture.md](docs/architecture.md) and [docs/managed-hosting.md](docs/managed-hosting.md). Public docs:
`apps/docs` (docs.bohr.io).

## Commands

```sh
pnpm install
pnpm lint          # biome check . (pnpm exec biome check --write <paths> to fix)
pnpm typecheck     # turbo, every package
pnpm test          # turbo, every package (vitest; the instance and dispatcher run in workerd)
pnpm build
pnpm --filter @bohr/web test     # one package
```

Run lint, typecheck and the tests of every package you touched before calling a change done.

## Local development

`pnpm dev:local` runs the instance (8787), the panel (5180) and the site (5181) in the background; `pnpm
dev:local:seed` fills a local database (sign in with `dev@localhost.test`; the email code is in `instance.log`).
See [scripts/dev-local.md](scripts/dev-local.md).

`apps/instance/wrangler.prod-db.jsonc` runs the local instance on bohr.io Cloud's production D1, KV and R2, with
only `ENCRYPTION_KEY` and `ADMIN_TOKEN` in `.dev.vars.prod-db` (git-ignored). It never migrates production, refuses
to start when the code has a migration production lacks, and is read-only (sign-in aside) unless
`LOCAL_ALLOW_WRITES=1` — its writes would be real. With `LOCAL_SIGN_IN_AS=<github login>` in that file,
http://localhost:5180/auth/local signs that account in (GitHub OAuth cannot call back to localhost); with
`CF_API_TOKEN` there, the Cloud-only features that read Cloudflare (DNS) work too. A migration production lacks is
additive by convention: apply it with `wrangler d1 migrations apply DB --remote` from `apps/instance` (the deployed
code ignores new tables and columns).

## How we work

- **API (instance) and front (panel, site) changes:** don't commit or deploy. Leave them running locally and tell
  the user what to test on localhost; commit and deploy after they approve ("pode publicar"). A production
  incident is fixed and deployed right away, then reported.
- **Never take a site down.** A deploy only switches what is served after everything is uploaded; a failed deploy
  leaves the previous version. Migrations of customer projects cut over with a health check and roll back on 5xx.
- **Secrets:** never print, log or commit them. Credentials live in `.secrets/` at the repository root (ignored
  by git and by biome; it never goes into a commit, so a new machine needs a copy: see internal/README.md); read
  them into the environment of a command (`$(grep '^KEY=' .secrets/<file> | cut -d= -f2-)`), never echo them.
- **Comments** explain why, in the surrounding code's density; code, comments and commits in English. Panel text
  goes through the locales, and `apps/web/src/locales/{pt-BR,en,es}.json` must stay in sync (a test checks it).
- Match the existing style and add tests in the style of the file next door.
- Deploys, releases and operations: [internal/operations.md](internal/operations.md).

## Gotchas

- **npm `bohr`:** versions 1.1.x, 2.x and 3.x belong to an unrelated 2016 package. v2's CLI is 4.x; it hands bohr v1
  repositories to exactly `bohr@1.0.577` (a range like `bohr@1` resolves to 1.1.1, which has no executable).
- **npx and inputs:** npx starts a bin through `sh -c`, which drops environment variables with a hyphen —
  GitHub passes action inputs that way (`INPUT_BUILD-PLAN`). The deploy action installs the CLI with npm and runs
  it with node.
- **D1:** at most 100 bound parameters per query; use `inChunks` (`apps/instance/src/lib/chunks.ts`).
- **Static assets:** Cloudflare caps a file at 25 MiB. Never publish `.git` or `.env*` (the deploy skips them and
  the dispatcher answers 404). Projects migrated from v1 follow v1's asset rules (`BOHR_V1_ASSETS`).
- **`pnpm deploy` is pnpm's own command:** a package's deploy script is `pnpm --filter <package> run deploy`.
- **Builds on Windows:** a checkout under the user's home folder picks up packages from an old
  `node_modules` above it (Node resolves upwards); keep checkouts in a folder like `C:\Work`.
- **docs.bohr.io and other `*.bohr.io` names:** bohr v1's edge has a `*/*` route on the zone; a Worker needs a
  specific route (`name.bohr.io/*`) besides a custom domain to win over it.
- **Workers' I/O belongs to the request that started it.** Never keep a promise, a database pool or a client at
  module level and reuse it from another request: when the first request is cancelled the promise never settles
  and every later request on that isolate hangs (an outage of `/api/me`), and a pool hands the next request a
  socket it cannot use (APIs answering empty from the second call). Keep only outcomes; open connections per
  request. The agent's prompt teaches customers' code the same.
- **bohr v1's `/api`:** v1 served `api/core` under `/api` and handed it the path without that prefix (`/api/login`
  reached the app as `/login`); prepared repositories must keep those addresses working.
- **Containers need Workers Paid.** Many accounts are on the free plan, where a Container deploy fails. Node HTTP
  servers (Express and the like) run in a Worker with `nodejs_compat` and `httpServerHandler` from
  `cloudflare:node`; nothing at module level may do I/O (a mail transporter created at import fails the deploy).
- **Logging errors:** in Workers Observability events, `console.error(message, error)` keeps only the stack: put
  `error.message` in the message itself.
- **Windows:** Python's text mode writes CRLF; write files with `newline=''` (or the Edit tool), or biome and git
  see every line changed. Some files are checked out with CRLF: keep what the file has. Heredocs mangle
  backslashes in regexes: prefer the Edit tool for code.
