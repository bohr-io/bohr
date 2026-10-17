# @bohr/instance

The control plane Worker of a bohr instance (Hono on Cloudflare Workers, D1 with Drizzle). Self-hosted instances deploy it from the root `wrangler.jsonc` together with the web interface; bohr.io Cloud deploys `apps/instance/wrangler.jsonc` with billing and the hosting of the projects migrated from v1 turned on.

## Routes

| Path | What it does | Auth |
| --- | --- | --- |
| `/setup`, `/setup/github/*` | First run: creates the GitHub App from a manifest; GitHub's post-install redirect | `ADMIN_TOKEN` (form), install `state` |
| `/auth/github`, `/auth/telegram`, `/auth/logout` | Sign-in with GitHub, or with Telegram through the platform bot | OAuth `state` cookie / one-time code bound to a cookie |
| `/api/onboarding/*` | The wizard: Cloudflare token, hosting choice, GitHub installation, repositories, project creation | Session |
| `/api/templates`, `/api/templates/*` | New projects from a template: the catalog, the request that goes through GitHub's user authorization (finished at `/auth/github/callback`), the admin password shown once | Session |
| `/api/projects/:id/runtime/*` | Runtime status, retry, Anthropic key, project bot token, import | Session, owner |
| `/api/projects/:id/agent/*` | Proxy to the project Worker's runtime API, with a 5-minute ES256 token for the member | Session |
| `/api/runtime/v1/*` | Token broker and member sync for project Workers | HMAC with the project secret |
| `/api/telegram/platform` | The platform bot's webhook | Telegram `secret_token` |
| `/api/github/webhook` | GitHub App installations | `X-Hub-Signature-256` |
| `/.well-known/bohr-runtime-jwks.json` | Public key project Workers trust | Public |
| `/api/admin/*` | Platform bot setup, runtime updates, v1 import and managed hosting operations | `ADMIN_TOKEN` |
| `/api/deploy/*` | Managed hosting deploys from GitHub Actions | GitHub OIDC |
| `/api/billing/*`, `/api/stripe/webhook` | bohr.io Cloud billing | Session / Stripe signature |

## Pieces

- `services/provision.ts` and `workflows/provision.ts`: create a project's runtime in the account that runs it (see [docs/architecture.md](../../docs/architecture.md)).
- `services/onboarding.ts` and `services/platform-bot.ts`: the onboarding steps, shared by the web wizard and the platform bot.
- `services/templates.ts`: new projects from a template: the repository (with the user's GitHub token, used once), its D1 database, the admin password and the setup commits that deploy it.
- `services/github-app.ts`: the App credentials (setup flow or secrets) and repository-scoped installation tokens.
- `services/runtime-keys.ts`: the ES256 key that signs calls to project Workers.
- `lib/vault.ts`: envelope encryption for everything sealed in D1 (`@bohr/vault`).
- `scripts/embed-runtime.mjs`: bundles `runtime/project-worker` into `src/generated/runtime.ts` before dev, typecheck, test and deploy.

## Development

```sh
pnpm --filter @bohr/instance test        # Workers pool, fakes for Cloudflare, GitHub, Telegram and Stripe
pnpm --filter @bohr/instance typecheck
pnpm --filter @bohr/instance db:generate # after changing src/db/schema.ts
```
