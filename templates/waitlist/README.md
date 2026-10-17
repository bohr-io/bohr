# Waitlist

A landing page that collects sign-ups for something you are about to launch: name, email and optional
phone, company and "how do you plan to use it". Each email can join only once, and every visitor sees their
position in line. The admin lists, searches and removes sign-ups, exports them as CSV and edits the page texts.

Runs as one Cloudflare Worker (Hono API + static files in `public/`) with a D1 database. The page speaks
Brazilian Portuguese, English and Spanish, following the visitor's browser.

## Admin password

The admin (`/admin`) uses the `ADMIN_PASSWORD` variable. bohr sets it when it creates the project; to change it,
edit the site variable in bohr or run `npx wrangler secret put ADMIN_PASSWORD`. Without it the admin stays
closed and explains how to set it.

## Routes

| Route | What |
| --- | --- |
| `/` | Landing page with the sign-up form (`?ref=` or `?utm_source=` is saved as the source) |
| `/admin` | Admin: sign-ups, stats, CSV export, page texts |
| `GET /api/page` | Page texts, which optional fields to show, sign-up count |
| `POST /api/signups` | Join: `{ name, email, phone?, company?, note?, source? }` → `{ position }` (409 `already_registered`) |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | Admin session |
| `GET /api/admin/signups?q=&page=` | Sign-ups, newest first |
| `GET /api/admin/stats` | Total, today, last 7 days |
| `DELETE /api/admin/signups/:id` | Remove a sign-up |
| `GET /api/admin/signups.csv` | CSV export |
| `GET/PUT /api/admin/settings` | Title, headline, description and optional fields |

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # sets ADMIN_PASSWORD for local development
npx wrangler d1 migrations apply DB --local && npx wrangler dev
```

Schema changes go in a new file in `migrations/` (for example `0002_add_city.sql`); deploys apply them.

## Ideas to ask the agent

- Send a welcome email to each new sign-up (with Resend or another email API).
- Referral links: give each person a link and move them up the list for every friend who joins.
- Add a launch countdown and a "notify everyone" button that emails the whole list.
- Ask a custom question with options and show the answers as a chart in the admin.
- Add social preview tags (Open Graph image and description) for sharing.
