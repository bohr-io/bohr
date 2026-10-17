# Link in bio

A public page with your photo, name, short bio, social icons and one big button per link, the page you put in
your Instagram or TikTok bio. Every button goes through `/go/<id>`, which counts the click on the server and
redirects (it works without JavaScript). The admin adds, edits, hides, deletes and reorders links, shows clicks
per link (total and last 7 days, day by day) and edits the profile: name, bio, photo, page color and social
handles, with a live phone preview.

Runs as one Cloudflare Worker (Hono API + static files in `public/`) with a D1 database. The page speaks
Brazilian Portuguese, English and Spanish, following the visitor's browser.

## Admin password

The admin (`/admin`) uses the `ADMIN_PASSWORD` variable. bohr sets it when it creates the project; to change it,
edit the site variable in bohr or run `npx wrangler secret put ADMIN_PASSWORD`. Without it the admin stays
closed and explains how to set it.

## Routes

| Route | What |
| --- | --- |
| `/` | The public page (phone first) with a share button |
| `/go/:id` | Counts a click and redirects (302) to the link's address; hidden or missing links show the 404 page |
| `/admin` | Admin: links, clicks, profile and a live preview |
| `GET /api/profile` | Name, bio, photo, color, social handles and the visible links (`id`, `title`, `icon`) in order |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | Admin session |
| `GET /api/admin/links` | Every link with `clicks`, `days` (last 7 days) and `week`, plus the page stats |
| `POST /api/admin/links` | Add a link: `{ title, url, visible? }` (409 `too_many_links` past 100) |
| `PUT /api/admin/links/:id` | Edit a link: `{ title, url, visible }` |
| `DELETE /api/admin/links/:id` | Delete a link and its clicks |
| `PUT /api/admin/links/order` | New order: `{ ids }`, every link id exactly once |
| `GET/PUT /api/admin/profile` | `{ name, bio, avatar_url, theme, socials: { instagram, tiktok, youtube, x, linkedin, github } }` |

Link addresses may be `https://`, `http://`, `mailto:` or `tel:`. Clicks from robots (link previews, search
engines) and more than 60 per visitor in 10 minutes are not counted. Days are counted in UTC.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # sets ADMIN_PASSWORD for local development
npx wrangler d1 migrations apply DB --local && npx wrangler dev
```

Schema changes go in a new file in `migrations/` (for example `0002_link_schedule.sql`); deploys apply them.

## Ideas to ask the agent

- Render the name, bio and photo into Open Graph tags on the server, for nicer previews when the page is shared.
- Use my own domain for the page.
- Schedule links: show a link only between two dates (a promotion, a live event).
- Embed a YouTube video or a Spotify player right on the page.
- Add a newsletter block that collects emails, with a CSV export in the admin.
- Show a QR code of the page in the admin, ready to print.
