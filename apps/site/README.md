# bohr.io website

The public website of bohr, prerendered with [vite-ssg](https://github.com/antfu-collective/vite-ssg) and built on the design system in `packages/ui` (`@bohr/ui`).

## Run

Requirements: Node.js 22 and pnpm 10. From the repository root:

```sh
pnpm install
pnpm --filter @bohr/site dev        # dev server with hot reload
pnpm --filter @bohr/site build      # prerender every page into apps/site/dist
pnpm --filter @bohr/site preview    # serve dist locally
pnpm --filter @bohr/site test       # unit tests (Vitest + happy-dom)
pnpm --filter @bohr/site typecheck  # vue-tsc
```

## Pages

| Path | Locale | File in `dist` |
| --- | --- | --- |
| `/` | English (`en-US`) | `index.html` |
| `/pt/` | Brazilian Portuguese (`pt-BR`) | `pt/index.html` |
| `/es/` | Spanish (`es-ES`) | `es/index.html` |
| `/migration` | English | `migration.html` |
| `/pt/migration` | Brazilian Portuguese | `pt/migration.html` |
| `/es/migration` | Spanish | `es/migration.html` |

`dist` is a static site. Serve it from any static host; on Cloudflare (Workers static assets or Pages) the default `auto-trailing-slash` HTML handling maps the paths above to their files and redirects `/pt` to `/pt/`.

Every page sets `<html lang>`, a localized title and description, a canonical URL and `hreflang` alternates for the three locales plus `x-default`. The locale comes from the route, never from the browser, so the prerendered HTML and the hydrated app always agree.

## Layout

```
src/
  config.ts          external URLs (GitHub, Deploy to Cloudflare, Cloud, Discord, docs, contact)
  build-config.ts    vite-ssg, vue-i18n and Vue plugin options shared by the Vite and Vitest configs
  i18n/locales.ts    locales, page paths and the list of prerendered paths
  i18n/index.ts      vue-i18n instance (one per app, so concurrent prerenders never share a locale)
  locales/*.json     copy; pt-BR is the source, en-US and es-ES are translations
  router.ts          one route per page and locale, plus a catch-all redirect
  pages/             HomePage and MigrationPage
  components/home/   one component per Home section
  components/layout/ header, footer and language switcher
public/
  images/            bohr artwork from the v1 site (low-poly atom and texture)
  logos/             framework logos, trademarks of their owners (see THIRD_PARTY_NOTICES.md)
```

## Copy and translations

- Add a key to all three files in `src/locales`. A test fails when the locales do not have exactly the same keys or placeholders, or when a message does not compile.
- `{`, `}`, `@` and `|` are message syntax in vue-i18n. Keep e-mail addresses, URLs and commands out of the JSON and pass them as placeholders (for example `{command}` or `{email}`), as the existing messages do.

## Notes

- The site loads no trackers, analytics or web fonts. Text uses the system stack `"Helvetica Neue", Helvetica, Arial, sans-serif`.
- The only third-party request is the contributors list, fetched in the browser from the GitHub API. The avatar wall stays hidden while that request fails (for example while the repository is private).
- Motion respects `prefers-reduced-motion`: the demo chat is shown in its final state, and looping animations stop. The demo also has a pause button and only plays while it is on screen.
