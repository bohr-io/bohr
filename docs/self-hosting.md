# Self-hosting bohr

An instance is one Cloudflare Worker: the API, the onboarding (web and Telegram), the credential vault and the web interface. Projects do not run there: each one runs in its owner's Cloudflare account, which the instance provisions with the owner's API token.

## 1. Deploy the instance

### With the Deploy to Cloudflare button

Click the button in the [README](../README.md). Cloudflare copies the repository to your GitHub account, creates the D1 database and asks for two secrets:

| Secret | Value |
| --- | --- |
| `ADMIN_TOKEN` | A random string of at least 32 characters (`openssl rand -hex 32`). It protects `/setup` and the admin API. |
| `ENCRYPTION_KEY` | 32 random bytes in base64 (`openssl rand -base64 32`). It is the vault's master key. **Keep a copy**: without it the stored Cloudflare tokens and GitHub App keys cannot be read. |

Leave `APP_URL` empty unless you already know the instance's final address.

### With wrangler

```sh
git clone https://github.com/bohr-io/bohr && cd bohr
pnpm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ENCRYPTION_KEY
```

`wrangler deploy` runs the build in `wrangler.jsonc` (it bundles the project Worker into the instance and builds the web interface), creates the D1 database on the first deploy and publishes. The instance applies its database migrations itself on the first request; `npx wrangler d1 migrations apply DB --remote` does the same by hand.

## 2. Finish the setup

Open `https://<your instance>/setup`, enter the admin token and create the GitHub App. GitHub shows the permissions before you confirm:

| Permission | Why |
| --- | --- |
| Contents: write | The agent pushes to the `homolog` branch; approvals merge to production |
| Pull requests: write | Approvals open and merge pull requests; rollbacks open revert pull requests |
| Workflows: write | The project Worker writes the deploy workflow (the sandbox's own token never gets this permission) |
| Secrets: write | Build variables of projects bohr hosts, and removing Actions secrets older versions wrote (the Cloudflare token of own-account projects is never stored in GitHub: the deploy workflow asks the instance for it) |
| Actions: read | The bot reports when the production deploy finishes |
| Organization › Members: read | Organizations in bohr mirror the members of the GitHub organization |
| Administration: write | Create repositories from templates (new projects from a template; only with the user's own authorization) |

The App subscribes to three webhook events (`GITHUB_APP_EVENTS` in `packages/github/src/app.ts`), delivered to `https://<your instance>/api/github/webhook`:

| Event | Why |
| --- | --- |
| Organization | Members added to or removed from a GitHub organization: its bohr organization's members follow |
| Push, Pull request | Subscribed since the first version; the instance acknowledges them and does nothing with them today (deploys run from the repository's workflow, approvals from the project Worker) |

**Installation** events reach every App without a subscription: the instance records each installation (and forgets a removed one) and links a GitHub organization's installation to its bohr organization.

Keep "Other people can install it" checked if other users will bring their own repositories. The address you used to open `/setup` becomes the instance URL (unless `APP_URL` is set): use your final domain from the start.

## 3. Optional: the platform bot

Users can go through onboarding on the web. To offer it on Telegram too:

1. Create a bot with [@BotFather](https://t.me/BotFather) and, in its settings, allow it to manage other bots (Bot API managed bots). That lets it create each project's bot with one tap; without it, users paste a BotFather token instead.
2. `npx wrangler secret put TELEGRAM_BOT_TOKEN`
3. Point the bot at the instance:

```sh
curl -X POST https://<your instance>/api/admin/platform-bot -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## 4. Optional: sign-in with an emailed code

Users can sign in with GitHub, or with a one-time code sent by email through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/):

```sh
npx wrangler email sending enable mail.example.com
```

Then, in `wrangler.jsonc`, uncomment the `send_email` binding and set `EMAIL_FROM` (for example `bohr <login@mail.example.com>`). Without the binding the sign-in page only offers GitHub.

## 5. What users do

Each user signs in (GitHub or an emailed code) and goes through the required steps once:

1. **Cloudflare.** Create an API token from the link the instance shows. The link asks for Workers Scripts: Edit, Account Settings: Read, **D1: Edit** (only projects created from a template need it, for their database; a token without it asks for it when such a project is created) and the zone permission **Workers Routes: Edit** (a domain that already has DNS records, when a project moves to its owner's account). Any plan works; the account needs a workers.dev subdomain (open Workers & Pages once in the dashboard). The agent also needs Workers Paid (its sandbox is a Container) and **Containers: Edit** on the token, which the link cannot prefill. Without them, projects are still created and deploy (deploy workflow, `bohr deploy`, previews, domains), and the project's panel says the agent needs Workers Paid; bohr checks the account again whenever the agent is turned on (open the project and press Check again).
2. **GitHub.** Install the instance's GitHub App on the repositories bohr may use.

Then, whenever they want:

- **New project.** Pick a repository; the instance creates the project Worker and the preview Worker in the user's account (one to three minutes) when the account can run Containers. A Telegram bot for the project is optional.
- **Agent.** In Account › Agent, the user chooses the model provider (an Anthropic API key, or any endpoint compatible with the Anthropic API with its base URL and key), the model and the effort. It applies to all their projects; keys go to each project Worker as secrets.
- **Accounts.** Settings lists the connected accounts (GitHub, Cloudflare, Telegram, agent), each of which can be disconnected, and lets the user delete their account and everything bohr created for it.

## 6. Organizations

A team works in an organization: a GitHub organization with the instance's GitHub App installed. In the panel, "+ Nova organização" opens the App's install page, where the user picks the GitHub organization (GitHub cannot create organizations through its API; create one at github.com first). When GitHub comes back, bohr creates the organization, imports its members and opens it. An installation made outside bohr also creates it, when the person who installed it already uses bohr.

- **Members mirror GitHub.** Owners of the GitHub organization are admins in bohr, the other members are members. People without a bohr account yet stay pending until they sign in with that GitHub account (or link it to their account). Members added to or removed from the GitHub organization follow through the Organization webhook; admins can also sync by hand, change a role in bohr (kept until GitHub changes that member's role) or remove someone's access in bohr (GitHub is not touched; later syncs respect it).
- **Its own resources.** Each organization has its own Cloudflare account (every project of the organization runs there), its own agent settings (the same providers as personal settings, including a Claude subscription) and, on bohr.io Cloud, its own subscription paid by an admin. Members need no subscription of their own.
- **Access.** Admins own every project of the organization (settings, domains, variables, deleting); members work on them. Projects created in an organization use its Cloudflare account and agent, whoever creates them.
- **Deleting.** An admin can delete the organization: its projects, subscription, Cloudflare connections and agent settings go, and the App is uninstalled from the GitHub organization. Uninstalling the App on GitHub only leaves the organization without installation; its projects keep running.

Apps created before organizations existed need two changes in the App's settings on GitHub (Permissions & events): the **Members** organization permission (read-only) and the **Organization** event. Each GitHub organization then accepts the new permission. Until it does, bohr only adds the person who installed the App and the panel asks for the permission.

Apps created before templates existed need the **Administration** repository permission (read and write) to create projects from a template; each account that installed the App accepts it once. Until then, GitHub refuses to create the repository and the panel says so.

## 7. Admins

The first user who signs in becomes the instance's admin. Admins see every user and project (Admin in the panel), change roles, update the project runtimes and choose whether the instance sends anonymous telemetry ([README](../README.md#telemetry); off by default, `BOHR_TELEMETRY=off` forces it off). The admin token can also set roles:

```sh
curl -X POST https://<your instance>/api/admin/users/role -H "Authorization: Bearer <ADMIN_TOKEN>"   -H "Content-Type: application/json" -d '{"email":"you@example.com","role":"admin"}'
```

## The agent image

Each project's sandbox runs the image in `runtime/agent`. On the first project of an account, the instance copies the published image (`ghcr.io/bohr-io/agent:<version>`) into that account's Cloudflare registry. To use your own build:

```sh
pnpm --filter @bohr/agent build
docker build -f runtime/agent/Dockerfile -t ghcr.io/<you>/bohr-agent:<tag> .
docker push ghcr.io/<you>/bohr-agent:<tag>
npx wrangler secret put RUNTIME_IMAGE   # or a var: ghcr.io/<you>/bohr-agent:<tag>
```

The image must be public (GitHub Container Registry or Google Artifact Registry recommended; Docker Hub limits anonymous pulls).

## Optional: the sign-in container

Connecting a Claude subscription (Account › Agent, or an organization's agent) runs the official CLI's `claude setup-token`. Without anything else, it runs in the container of one of the owner's projects: the owner needs a project whose agent is ready, and a sleeping container has to start first. A small dedicated container attached to the instance removes both: the connection works before any project exists and starts in seconds. It runs `runtime/claude-login` (published as `ghcr.io/bohr-io/claude-login:<version>`): Node, the CLI binary and a server with only the sign-in endpoints. It gets no secrets; the token it returns goes to the instance, never to the browser. Each user or organization signing in gets its own container, which stops 10 minutes after the last use (as long as a sign-in may take).

It needs Workers Paid on the instance's account (Containers) and the image in that account's registry:

1. Create an API token with **Containers: Edit** on the instance's account and copy the image (the version in `runtime/claude-login/package.json` by default; pass another image as an argument):

   ```sh
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account ID> node apps/instance/scripts/copy-login-image.mjs
   ```

2. In `wrangler.jsonc`, uncomment `durable_objects`, `migrations` and `containers` under "Optional: a small dedicated container", with your account ID in the image (the script prints the line), and deploy again.

Without these entries the instance keeps using a project container, and the panel asks for a project when there is none. Copy the new image and update its tag when you update bohr.

## Rotating the master key

`ENCRYPTION_KEY` accepts several keys, current first: `k2:<new base64>,k1:<old base64>`. New values are sealed with `k2`; old ones still open with `k1`. To move everything to `k2`, then drop `k1`:

```sh
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>,k1:<old base64>
curl -X POST https://<your instance>/api/admin/vault/rewrap -H "Authorization: Bearer <ADMIN_TOKEN>"
npx wrangler secret put ENCRYPTION_KEY   # k2:<new base64>
```

## Costs

| Account | Pays for |
| --- | --- |
| The instance's | Workers, D1 and Workflows. A small instance fits in the free plan; Workers Paid is US$5/month (needed for the optional sign-in container, a `basic` container that runs only while someone connects a Claude subscription). |
| Each user's Cloudflare | Whatever the project itself uses in production and, for the agent, Workers Paid (US$5/month) and the sandbox while the agent works (a `standard-1` container costs cents per hour and sleeps when idle). |
| Each user's Anthropic | The agent's tokens. Every request has a budget (US$5 by default, set per project). |

## Updating

Pull the upstream changes into your copy of the repository and deploy again (`npx wrangler deploy`, or push to the branch Workers Builds deploys). New migrations run on the first request after the deploy. To move every project's runtime to the new version: `curl -X POST https://<your instance>/api/admin/runtimes/update -H "Authorization: Bearer <ADMIN_TOKEN>"`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "The GitHub App is not set up yet" | Finish `/setup`. |
| The project's panel says the agent needs Workers Paid | The account cannot run Containers. Upgrade it to Workers Paid and add Containers: Edit to the token (or reconnect the account with a new token), then open the project and press Check again. |
| "no workers.dev subdomain" | Open Workers & Pages once in the user's Cloudflare dashboard, then retry from the project page. |
| The project bot does not answer | `/status` in the platform bot; the project's runtime must be `ready` and have a bot. |
| The preview shows "starting" for minutes | The sandbox installs dependencies after sleeping; the project's chat shows errors from the dev server. |
