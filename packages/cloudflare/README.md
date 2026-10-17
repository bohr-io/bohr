# @bohr/cloudflare

Typed client for the Cloudflare API calls bohr makes. Everything in `src/` runs on Cloudflare Workers (Web APIs only)
and talks to the REST API with `fetch`, so the instance never needs wrangler or docker.

`CloudflareClient` sends the API token and unwraps the `{ success, errors, result }` envelope. Failures throw
`CloudflareError` with the HTTP status and the API error codes (`error.hasCode(10007)`); `isNotFoundError(error)` covers
the "script/service/subdomain not found" codes.

| Module | What it covers |
| --- | --- |
| `client` | `CloudflareClient`, `CloudflareError`, pagination (`requestAllPages`) |
| `workers-for-platforms` | Scripts in a dispatch namespace (bohr.io Cloud), assets upload sessions, secrets |
| `routes`, `zones` | Worker routes, zone lookup for a hostname |
| `tokens` | Token verification, account listing, capability probes, token template URL |
| `account-workers` | Scripts in an account: upload, secrets, migration tag, Durable Object namespaces, workers.dev |
| `containers` | Managed registry credentials, image preparation, Durable Object-managed container applications |
| `registry` | `copyImageToAccount`: copies a public image into the account's registry over the OCI API |
| `d1` | D1 databases: create, find by name, delete (the databases of projects created from a template) |

## User-account provisioning

A self-hosted instance receives the user's API token and creates, in the user's account, the project Worker (a script
whose Durable Object class `Project` owns a container through `ctx.container`) and a small preview Worker. The calls
below run in this order; `cf` is a `CloudflareClient` built with the user's token (its `accountId` is not used by these
functions, which take the account explicitly).

1. **Token.** Send the user to `apiTokenTemplateUrl({ name: 'bohr' })`. It pre-fills Workers Scripts: Edit (which also
   covers Durable Object namespaces and the workers.dev subdomain), Account Settings: Read, D1: Edit (only projects
   created from a template need it, so the diagnosis does not probe it) and the zone permission Workers Routes: Edit
   (serves a domain that already has DNS records from a Worker route when a project moves to its owner's account;
   probing it needs a zone, so the diagnosis does not). Containers has a permission group but no documented template
   key, so the user adds **Containers: Edit** by hand. It is optional: the account then runs the agent's container
   (Workers Paid); sites, previews, routes and domains work without it.
2. **Verify.** `verifyApiToken(cf)` for user tokens. Account-owned tokens fail there; retry with
   `verifyAccountApiToken(cf, accountId)`. `listAccounts(cf)` lists the accounts the token reaches.
3. **Diagnose.** `diagnoseToken(cf, accountId)` probes with harmless reads and returns `capabilities` plus the API
   message for each missing one (`errors`). A read can't prove write access, so the first deploy is the real check.
   `containers` is optional (`OPTIONAL_CAPABILITIES`): `ok` ignores it, and a missing one can also mean the account has
   no Containers access (Workers Paid). `canRunContainers(cf, accountId)` answers that alone. Steps 4 to 8 need it.
4. **Copy the agent image.** `copyImageToAccount({ cf, accountId, source: 'ghcr.io/bohr-io/agent:0.1.0',
   repository: 'bohr-agent', tag: '0.1.0' })` copies the linux/amd64 image and returns the digest-pinned
   `reference` (`registry.cloudflare.com/<account>/bohr-agent@sha256:…`). Layers stream through without being buffered.
   Blobs already in the registry are skipped, so a failed copy can be re-run. Prefer GHCR as the source: Docker Hub
   rate-limits anonymous pulls per IP, and Workers share egress IPs.
5. **Prepare the image.** `prepareContainerImage(cf, accountId, reference)` polls until the image is `ready`.
6. **Upload the project Worker.** `getAccountScriptSettings(cf, accountId, script)` returns `null` for a new script or
   the applied `migrationTag`. Send the migration only when it is not applied yet:

   ```ts
   const settings = await getAccountScriptSettings(cf, accountId, script);
   await uploadAccountScript(cf, accountId, script, {
     main_module: 'index.js',
     compatibility_date: '2026-10-01',
     bindings: [{ type: 'durable_object_namespace', name: 'PROJECT', class_name: 'Project' }],
     keep_bindings: ['secret_text'],
     migrations: settings?.migrationTag ? undefined : { new_tag: 'v1', new_sqlite_classes: ['Project'] },
     containers: [{ name: `${script}-project`, class_name: 'Project', images: { agent: reference } }],
   }, modules);
   ```

   The `images` key (`agent`) is the name the Durable Object uses for the image (`ctx.container.images`).
7. **Find the namespace.** `findDurableObjectNamespaceId(cf, accountId, script, 'Project')` returns the namespace the
   migration created (`listDurableObjectNamespaces` lists them all).
8. **Create the container application.** `ensureContainerApplication(cf, accountId, { name, namespaceId })` creates
   the Durable Object-managed application (its id is the namespace id), or checks that the existing one has the same
   name and policy. Pass the same `name` as `containers[].name` in the upload (`<script>-project` above).
9. **Secrets.** `putAccountScriptSecret(cf, accountId, script, name, value)` for each secret (Anthropic key, webhook
   secrets…). `keep_bindings: ['secret_text']` keeps them across later uploads.
10. **workers.dev.** `getWorkersSubdomain(cf, accountId)` returns `null` until the account registers its
    `<name>.workers.dev` subdomain once in the dashboard. Then `enableWorkersDevForScript(cf, accountId, script)` and
    `workersDevUrl(script, subdomain)` give the project Worker's URL (bot webhook, API for the instance and the web).
11. **Preview Worker.** Upload a second script with a service binding to the project Worker, then enable workers.dev
    on it under a hard-to-guess name:

    ```ts
    await uploadAccountScript(cf, accountId, previewScript, {
      main_module: 'preview.js',
      compatibility_date: '2026-10-01',
      bindings: [{ type: 'service', name: 'PROJECT', service: script }],
    }, previewModules);
    await enableWorkersDevForScript(cf, accountId, previewScript);
    ```

`deleteAccountScript(cf, accountId, script, { force: true })` and `deleteAccountScriptSecret` undo these steps; both
ignore "not found".

### What is confirmed and what still needs a real account

Confirmed by both wrangler 4.149's source and the public API reference:

- Registry credentials: `POST /accounts/{id}/containers/registries/{domain}/credentials` with
  `{ expiration_minutes, permissions }`, answering `{ username, password, registry_host, account_id }`.
- Image preparation: `POST /accounts/{id}/containers/image-preparations` with `{ image }`, answering
  `{ status: 'pending' | 'ready' | 'error', reason? }`. The 2 s interval and 15 min timeout are wrangler's.
- Applications: `POST /accounts/{id}/containers/applications` with
  `{ name, scheduling_policy: 'durable_object', durable_objects: { namespace_id } }`, and `GET …/applications/{id}`
  answering 404 when it does not exist.
- Script upload bindings, `migrations` and `keep_bindings`, and `migration_tag` in the upload response. Durable Object
  namespaces list (`page`/`per_page` up to 1000), secrets, workers.dev endpoints, token verification, accounts list.

Confirmed only by wrangler's source (not in the public API reference):

- The upload metadata `containers: [{ name, class_name, images }]`, and that each image must be a digest-pinned
  managed-registry reference (`registry.cloudflare.com/<account>/<repo>@sha256:<64 hex>`).
- Creating the application after the upload, from the namespace the upload created, and the name/policy/namespace
  identity check.
- Reading the applied migration tag from `GET /accounts/{id}/workers/services/{script}`
  (`default_environment.script.migration_tag`).
- The `Cloudflare-Workers-Script-Api-Date: 2025-08-01` header on the workers.dev call, and the
  `excludeScript=true&bindings_inherit=strict` query on uploads.
- Basic auth `v1:<password>` against `registry.cloudflare.com` (wrangler's `containers images list/delete`).

Inferred, to validate against a real account before relying on them:

- **Pushing over HTTP.** wrangler only pushes with `docker push`, so the OCI push flow against `registry.cloudflare.com`
  is untested: whether it accepts Basic auth directly or answers with a Bearer challenge (both are handled), the
  `Location` it returns, and whether one monolithic `PUT` per layer is accepted for large layers. If a request size
  limit shows up, layers need chunked `PATCH` uploads.
- **Credential lifetime.** Credentials last 15 minutes (wrangler's value). A copy that takes longer fails with a 401;
  re-running it skips the blobs already pushed.
- **Account namespace.** Images live under `<account id>/<repository>`, as wrangler's image validation and
  `containers images list` assume. `docker push` in wrangler uses `external_account_id` from `GET …/containers/me`
  instead, which we assume is the same id.
- **Image preparation** of an image that was not pushed by docker.
- **Diagnosis status codes.** Which status (401 or 403) the Containers API returns for a token without Containers, and
  how an account without Containers access answers. Both are reported as a missing capability.
- **Timing.** That the Durable Object namespace is listed right after the upload, and whether secret writes on a
  script with containers roll the container.
- **Template URL.** That the dashboard pre-fills the documented keys, so only Containers is added by hand.
