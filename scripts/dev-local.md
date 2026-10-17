# Local development

Runs a bohr instance on your machine with realistic data, so panel and API changes can be tried on localhost
without deploying anything.

| Service | URL | What it is |
| --- | --- | --- |
| Panel | http://localhost:5180 | `apps/web` on Vite (hot reload), the API proxied to the instance |
| Instance | http://localhost:8787 | `apps/instance` on `wrangler dev`: local D1, simulated email |
| Site | http://localhost:5181 | `apps/site` on Vite |

```sh
pnpm dev:local          # starts the three in the background (survives the terminal), waits until they answer
pnpm dev:local:seed     # first time: people, personal projects, two organizations (run again to restore deleted rows)
pnpm dev:local:status
pnpm dev:local:stop
```

Logs and process ids go to `BOHR_DEV_LOGS` (default: `<temp>/bohr-dev-local`): `instance.log`, `panel.log`,
`site.log`, `pids.json`.

## Signing in

Open http://localhost:5180, choose **Email** and use a seeded address:

- `dev@localhost.test`: instance admin; personal projects, admin of **Acme Labs**, member of **Globex**
- `ana@localhost.test`: admin of Globex, member of Acme Labs
- `bruno@localhost.test`: member of Acme Labs

Nothing is emailed: wrangler simulates Cloudflare Email Service and the code is in `instance.log`, on a line like
`Subject: 123456 is your bohr code`. The session cookie is `Secure`, which browsers accept on `localhost`
(Chrome, Edge, Firefox; not Safari).

## How it is set up

- `apps/instance/wrangler.local.jsonc`: local only, never deployed. No custom build (Vite serves the panel, so a
  type error in `apps/web` does not stop the instance), a local `EMAIL` binding, `APP_URL` = the panel.
- `apps/instance/.dev.vars.local`: random `ADMIN_TOKEN` and `ENCRYPTION_KEY`, created on the first start (git
  ignores it). Not `.dev.vars`, which the instance's tests would load as well.
- `apps/instance/scripts/seed-local.mjs`: applies the migrations and inserts the data with
  `wrangler d1 execute --local`. Credentials are placeholders: anything that calls Cloudflare or GitHub for real
  (provisioning, Cloudflare settings, the GitHub App) fails or answers with warnings.
- The local database lives in `apps/instance/.wrangler/state`; delete that folder to start over.

## Troubleshooting

- `wrangler dev` from the repository root runs the root `wrangler.jsonc`, whose custom build runs `vue-tsc` and
  `vite build` first: a type error in `apps/web` (or another process on port 8787) makes it exit. A `wrangler dev`
  killed abruptly can leave `workerd.exe` holding the port; `pnpm dev:local` reuses whatever answers on a port, so
  stop strays first (`netstat -ano | findstr :8787`, then `taskkill /F /PID <pid>`).
