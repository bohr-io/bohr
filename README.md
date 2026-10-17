# bohr

**Ask more, code less.** bohr is an open-source, self-hosted deploy platform operated by an AI agent. You ask for a change in Telegram or in the web chat; the agent edits your repository in an isolated sandbox, shows you a preview on its own URL, and publishes to production only when someone approves.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bohr-io/bohr)

- **Runs in your accounts.** Each project runs in its owner's Cloudflare account, with their GitHub repository and their Anthropic key. The instance is a thin control plane: onboarding, a credential vault and the web interface.
- **Nothing reaches production without approval.** Every change lands on a `homolog` branch with a preview first. Approve to merge and deploy; discard to drop it; roll back with one command.
- **Open source (MIT).** Install one instance for yourself, your team or your clients.

## How it works

```
You (Telegram or web) ──▶ project bot ──▶ project Worker (your Cloudflare account)
                                            ├─ request queue, members, invites (Durable Object)
                                            ├─ agent sandbox (Container) ──▶ Anthropic, GitHub
                                            └─ preview URL (dev server in the sandbox)
Approve ──▶ pull request homolog → main ──▶ GitHub Actions deploys production
```

1. **Connect** your Cloudflare account, install the instance's GitHub App and pick a repository. The instance creates the project's Worker in your account and a Telegram bot for the project.
2. **Ask** for a change in plain words, in Telegram or on the web.
3. **Review** the preview. Ask for adjustments as many times as you want.
4. **Approve** and it is merged and deployed. `/rollback` brings back the previous version.

Members join with single-use invite codes. Owners and members can request changes and approve them; only owners manage keys and access.

## Install your instance

Use the button above, or deploy with wrangler:

```sh
git clone https://github.com/bohr-io/bohr && cd bohr
pnpm install
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN      # openssl rand -hex 32
npx wrangler secret put ENCRYPTION_KEY   # openssl rand -base64 32
```

Then open `https://<your-worker>/setup` to create the instance's GitHub App. Full guide: [docs/self-hosting.md](docs/self-hosting.md).

What each person needs:

| Who | Needs |
| --- | --- |
| Whoever hosts the instance | A Cloudflare account (Workers, D1 and Workflows; the free plan is enough to start) |
| Each user | A Cloudflare account (the agent needs Workers Paid: its sandbox is a Container; without it, projects still deploy), a GitHub account, and an Anthropic API key or a provider compatible with the Anthropic API. Telegram is optional. |

Prefer not to host it? [bohr.io Cloud](https://bohr.io) runs the same instance for you for US$20/month; your sites still deploy to your own Cloudflare account, and a free Cloudflare account is enough (the agent then runs in bohr's account).

## Deploy from your terminal, scripts and AI agents

The bohr CLI ([`npx bohr`](packages/cli/README.md)) deploys a project from wherever its code is:

```sh
npx bohr login            # approve this computer in the panel
npx bohr deploy           # a preview of the current branch; --prod for production (owners only)
BOHR_TOKEN=bohr_… npx bohr deploy --json   # an AI agent or a script, with a token from Account › Tokens
```

Deploys are previews unless you say `--prod`, and what is served only changes once the new version is fully uploaded and accepted. Tokens act as their user, only on the projects they list, and are revoked in the panel. The GitHub Action `bohr-io/deploy-action` runs the same CLI. For now the CLI deploys the projects bohr hosts; projects in your own Cloudflare account keep deploying from their workflow.

## What bohr leaves in your Cloudflare account

So you can always tell bohr's work apart from yours:

- Every call bohr makes to the Cloudflare API sends `User-Agent: bohr/<version> (+https://bohr.io)`; it shows in your account's audit log.
- The Workers bohr creates (each project's agent Worker and preview Worker) carry the tags `bohr` and `bohr-project:<id>`, and their deployments the message `bohr`.
- Production deploys from GitHub Actions run `wrangler deploy --message "bohr" --tag "bohr-<commit>"`.

## Telemetry

Self-hosted instances can send anonymous usage telemetry. It is **off by default**: an instance admin turns it on in the panel (Admin › Telemetry), which shows exactly what is sent.

- **What:** a random instance ID created for this purpose, the instance version and the number of projects. Nothing else: no names, emails, URLs, repositories or IP-derived data are stored.
- **When:** once a day, from the instance's hourly cron, as a `POST` to `https://app.bohr.io/api/telemetry`.
- **Why:** to know how many instances and versions are out there, so we know what to keep compatible.
- **Turning it off:** switch it off in the panel, or set the variable `BOHR_TELEMETRY=off`, which keeps it off whatever the panel says.

bohr.io Cloud never sends telemetry; it only receives these pings.

## Repository

| Path | What lives there |
| --- | --- |
| `apps/instance` | The instance Worker: API, onboarding, platform bot, GitHub App, vault, provisioning |
| `apps/web` | The instance's web interface: chat, preview, versions, members, settings |
| `apps/site` | The bohr.io website |
| `runtime/project-worker` | The Worker each project runs: project bot, queue, sandbox, preview |
| `runtime/agent` | The agent runner inside the sandbox (Claude Agent SDK) and its container image |
| `packages/cli` | The bohr CLI (npm `bohr`): deploys from a terminal, scripts, AI agents and GitHub Actions |
| `packages/*` | Shared code: contracts, Cloudflare, GitHub and Telegram clients, vault, design system |
| `cloud/*` | bohr.io Cloud only: dispatcher and deploy action (a wrapper that runs the CLI) for the projects migrated from bohr v1, which bohr still hosts |
| `docs/` | [Self-hosting](docs/self-hosting.md), [architecture](docs/architecture.md), [managed hosting](docs/managed-hosting.md) |

## Development

Node.js 22 and pnpm 10:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The bohr name and logo are not covered by the license; see [TRADEMARKS.md](TRADEMARKS.md).
