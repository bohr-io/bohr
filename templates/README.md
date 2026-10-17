# Starter templates

Small, useful apps that bohr can create a project from ("new project from template"). Each one is a
Cloudflare Worker (TypeScript + [Hono](https://hono.dev)) with static assets in `public/` (plain HTML, CSS and
JavaScript modules, no build step) and a D1 database, ready to deploy with no changes and to be extended by
asking bohr's agent.

| Template | What you get | Repository |
| --- | --- | --- |
| [waitlist](waitlist) | Landing page that collects sign-ups, admin with search and CSV export | `bohr-io/template-waitlist` |
| [booking](booking) | Appointment booking: services, weekly availability, free slots, agenda | `bohr-io/template-booking` |
| [link-in-bio](link-in-bio) | Profile page with links, click counts and an editor | `bohr-io/template-link-in-bio` |
| [forms](forms) | Form and survey builder with public links, results and CSV export | `bohr-io/template-forms` |
| [menu](menu) | Digital menu with cart and checkout over WhatsApp, orders in the admin | `bohr-io/template-menu` |
| [short-links](short-links) | URL shortener with custom slugs and daily click stats | `bohr-io/template-short-links` |

`catalog.json` describes them for the instance's template picker (names and descriptions in pt-BR, en and es).

## Conventions every template follows

- `wrangler.jsonc` at the root: `name` and the D1 `database_name` are the template's slug, `database_id` is
  `00000000-0000-0000-0000-000000000000`. bohr replaces the three after it creates the repository and the database.
  Exactly one D1 binding, `DB`, with `migrations_dir: "migrations"`; static assets in `./public` with binding `ASSETS`.
- Schema in `migrations/0001_init.sql`; later changes are new migration files (deploys run
  `wrangler d1 migrations apply DB --remote` before `wrangler deploy`).
- The Worker answers `/api/*` (and routes like `/go/:id`), listed in `assets.run_worker_first` so browser
  navigations reach it instead of the static 404 page, and hands every other request to `ASSETS` (bohr's deploy may
  wrap the Worker in its protection gate, which turns `run_worker_first` on for everything).
- The admin (`/admin`) is protected by the `ADMIN_PASSWORD` variable (a Worker secret bohr sets at creation). Admin
  sessions are HMAC-signed cookies (HttpOnly, Secure, SameSite=Lax). Without the variable the admin stays closed and
  explains how to set it.
- `.bohr/deploy.json` and `.bohr/preview.json` tell bohr how to build, deploy and preview the project.
- All visible text goes through `public/assets/i18n.js` (pt-BR default, en, es, picked from `navigator.language`).
- The files shared by all templates (`src/lib/*`, `src/env.ts`, `public/assets/base.css`, `public/assets/ui.js`) are
  identical copies; change them in every template at once.

## Run one locally

```sh
cd templates/<slug>
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local && npx wrangler dev
```

## Publish

`node scripts/publish-templates.mjs` (dry run) and `GITHUB_TOKEN=... node scripts/publish-templates.mjs --apply`
create the public template repositories `bohr-io/template-<slug>` when missing and push each directory to `main`
as one commit (nothing changes when the content is the same).
