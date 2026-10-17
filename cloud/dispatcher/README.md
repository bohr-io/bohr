# @bohr/dispatcher

The Cloudflare Worker in front of every bohr.io Cloud managed project. It looks up the request's hostname in the `ROUTES` KV namespace and forwards the request to the customer's Worker in the `bohr-cloud` Workers for Platforms dispatch namespace.

The route record format and the expected behaviour are specified in [docs/managed-hosting.md](../../docs/managed-hosting.md), sections "Route record (KV namespace `ROUTES`)" and "Dispatcher behaviour". Record keys are hostnames as `new URL(url).hostname` returns them: lowercase, with IDNs in punycode.

## Request flow

1. The dispatcher looks up the hostname, lowercased and without a trailing dot. If there is no exact record, it tries wildcard keys from the most specific parent domain down to two labels. For example, `a.b.example.co.uk` tries `*.b.example.co.uk`, then `*.example.co.uk`, then `*.co.uk`, and never `*.uk`. The first hit wins. A wildcard does not match the bare domain: `*.example.com` does not serve `example.com`.
2. If nothing is found, a `www.` hostname gets a 301 to the same URL without `www.`, with path and query kept. Any other hostname gets the 404 page.
3. If the record has `suspended: true`, the dispatcher returns the 503 page and does not call the customer Worker.
4. If `auth.type` is `basic`, a request without valid credentials gets a 401 with `WWW-Authenticate: Basic realm="<hostname>", charset="UTF-8"`. Paths listed in `bypassPaths` skip this check; they must match the URL pathname exactly.
5. The request is sent with `env.DISPATCHER.get(script).fetch(request)`. If the script is missing from the namespace, the visitor gets the 404 page. Any other failure is logged and the visitor gets the 502 page, which contains no error details.
6. Every response gets `Strict-Transport-Security: max-age=31536000; includeSubDomains` and `X-Content-Type-Options: nosniff`, followed by the record's `headers`.

A record that is not valid v1 gets a 502 and is logged. This covers invalid JSON, an unknown `v` or `auth.type`, and invalid header names or values. Failing this way means a site is never served without the protection its record asks for.

### Per-isolate caches

| Entry | Kept for |
| --- | --- |
| Route record found in KV | 30 s |
| KV miss | 5 s |
| Verified `Authorization` value, keyed by sha256(hostname + header) | 5 min, or until that user's hash changes in the record |

A new or changed route record takes effect within about 30 s, plus KV propagation time. PBKDF2 runs once per visitor per isolate. Failed attempts are never cached.

## Passwords

`src/auth.ts` exports `hashPassword(password, { iterations })` and `verifyPassword(password, record)`. Both use PBKDF2-SHA256 with a random 16-byte salt and a 32-byte hash, stored as base64. The default is 20,000 iterations; workerd accepts at most 100,000. Credentials in the `Authorization` header are decoded as UTF-8.

## Deploy

Run these from the repository root:

```sh
# Once: the dispatch namespace that holds the customer Workers
pnpm --filter @bohr/dispatcher exec wrangler dispatch-namespace create bohr-cloud

# Once: the KV namespace for route records. Copy the printed id into
# wrangler.jsonc, replacing REPLACE_WITH_ROUTES_KV_ID. apps/instance writes to the same namespace.
pnpm --filter @bohr/dispatcher exec wrangler kv namespace create ROUTES

# Every release (use `run`: plain `pnpm deploy` is a pnpm built-in command)
pnpm --filter @bohr/dispatcher run deploy
```

`wrangler.jsonc` declares no routes and turns off workers.dev, because apps/instance creates a route for each hostname through the Cloudflare API. Do not add `routes` to the config. When `routes` is set, `wrangler deploy` replaces every route on the Worker and drops the ones the instance created.

## Development

```sh
pnpm --filter @bohr/dispatcher typecheck
pnpm --filter @bohr/dispatcher test
pnpm --filter @bohr/dispatcher exec wrangler types   # after changing wrangler.jsonc
```

Tests run in workerd through `@cloudflare/vitest-pool-workers` against a local KV namespace. Dispatch namespaces cannot be simulated locally, so the tests call the exported `fetch` with a fake `DISPATCHER` (see `test/helpers.ts`). For the same reason, `wrangler dev` cannot reach customer Workers. Keep `compatibility_date` no newer than the date the test pool's bundled workerd supports.
