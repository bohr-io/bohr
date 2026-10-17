# @bohr/web

The bohr web panel (Vue 3). The instance Worker (`apps/instance`) serves the built `dist/` on the same origin as its API.

```sh
pnpm --filter @bohr/web dev        # dev server; /api, /auth… go to a local instance (BOHR_INSTANCE_URL, default http://localhost:8787)
pnpm --filter @bohr/web build      # type-checks, then builds dist/
pnpm --filter @bohr/web test       # vitest
pnpm --filter @bohr/web typecheck
```

## Demo mode

To see the panel without an instance, a GitHub App or a Cloudflare account:

```sh
pnpm --filter @bohr/web demo
```

It opens the Vite dev server (http://localhost:5173, or the next free port it prints) with a mock of the instance (`demo/`, loaded only by `vite --mode demo`; never part of the build). You are signed in as Ana Souza on bohr.io Cloud, an admin of the instance, with demo data in memory:

- **Loja Aurora**: the agent at work, plus site variables, build variables and two custom domains under Configurações. Builds lists its deploys with their logs (one fails, the newest is still running when the server starts). The preview has changes to approve, a request runs while another waits, and the agent asked a question. Messages you send get an answer within a few seconds. Approving, discarding, answering, cancelling, rolling back, inviting and removing members, and changing the settings all work on the demo data.
- **Portfólio Ana**: a project migrated from bohr v1 and still hosted by bohr, with Basic Auth on (user `cliente`). It shows the agent activation and the move to your own Cloudflare account. The first "Concluir a mudança" leaves a domain pending; the second finishes the move.
- **Blog da Aurora**: a project whose agent is still being set up, with no builds yet (its overview lists what is missing).

The agent's provider is set up under Conta → Agente (`/account/agente`); removing it turns the agent off everywhere and shows the notices that ask for it. In the danger zone (Configurações → Geral) any project can be deleted. New projects start at `/projects/new`: creating one adds it to the demo, and its agent is ready about 12 seconds later.

Conta (`/account`) lists the connected accounts: the sign-in methods (GitHub, email), the GitHub App installations, the Cloudflare accounts, Telegram and the agent. Every disconnection asks first. Some show the instance's refusals: the GitHub App on `anasouza` and the `Ana Souza` Cloudflare account are still used by projects (409, listing them), while `aurora-comercio` and `Aurora Comércio` disconnect (the Cloudflare one with the hint to delete its API token). The last sign-in method cannot be removed. "Adicionar e-mail" adds an address with a code (`123456`; `carla@cafelume.com.br` belongs to another user, 409). "Conectar login do GitHub" fails the first time (the `?error=` toast) and links the second. The danger zone at the bottom deletes the account: the demo starts over, signed out, at the sign-in page.

Signed out (Sair da conta, or after deleting the account), `/login` offers GitHub and email. The email sign-in accepts the code `123456` (the page says so in the demo only); five wrong codes expire it, and a sixth code request for the same address is rate limited.

The admin area is at `/admin` (Administração in the main bar): the overview with "Atualizar runtimes", the users (search, roles, deleting an account; Diego is the other admin, and removing the role from the last one answers 409), the projects of every user with their runtimes (the Site do Bruno opens with the "viewing as administrator" banner) and the telemetry, with its payload.

The onboarding is at `/start`. Add `?step=<step>` to preview any step: `subscription`, `cloudflare`, `cloudflare_account`, `github`, `done`.

The data resets when the server restarts, or at `/__demo/reset`.
