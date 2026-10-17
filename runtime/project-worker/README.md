# @bohr/project-worker

The Worker each project runs in its owner's Cloudflare account (or, on bohr.io Cloud, in bohr's). It is the project's half of bohr: the project bot, the request queue, the agent's container and the preview. The bohr instance provisions it once and then stays out of the way, except to hand out short-lived GitHub tokens.

```
Telegram ──webhook──▶ /__bohr/telegram ─┐
web chat ─instance JWT─▶ /__bohr/api/v1 ─┤──▶ Project (Durable Object, one per project)
preview Worker ──service binding──▶ Preview ─┘        │  SQLite: members, invites, requests, chat, releases
                                                      │  ctx.container: the agent sandbox (runtime/agent)
                                                      ▼
                         Gateway (outbound from the container): Anthropic key, GitHub token, agent events
```

## Exports

| Export | What it is |
| --- | --- |
| `default` | Routes `/__bohr/health`, `/__bohr/telegram` (checks `X-Telegram-Bot-Api-Secret-Token`) and `/__bohr/api/v1/*` (checks the instance's ES256 JWT). Everything else is 404. |
| `Project` | Durable Object with the container. Holds the queue and runs one request at a time. |
| `Gateway` | `WorkerEntrypoint` the container's outbound traffic goes through (`interceptOutboundHttps`/`interceptOutboundHttp`). |
| `Preview` | `WorkerEntrypoint` the preview Worker forwards to; it serves the dev server running in the container. |

## A request, end to end

1. A member writes to the project bot (or the web chat). The request is queued; the bot answers with a status message it keeps editing.
2. An alarm starts the container if needed (Gateway interception first, then `start()`), waits for the runner, and posts the job (`@bohr/shared` `AgentJob`).
3. The runner pushes events to `http://bohr.internal/v1/agent/events`; the Gateway hands them to the Durable Object. Progress edits the status message at most every 4 seconds. A watchdog alarm checks the runner every minute and recovers missed events.
4. When the job finishes with commits on `homolog`, the Worker writes `.github/workflows/bohr-deploy.yml` from `.bohr/deploy.json` if it changed, and takes the head of `homolog` from GitHub: the preview has a new version, pinned to that commit. The bot shows the summary (never the cost or the preview's address: a button opens the preview) and a link to the diff, with **Approve** and **Discard** buttons bound to that version (typed `/approve` and `/discard` show the same buttons).
5. **Approve** opens (or reuses) the pull request `homolog → main` and squash-merges it only if its head is still the reviewed commit. `homolog` is reset to the merge commit, the agent session starts fresh, and the release is tracked until its GitHub Actions run finishes.
6. **Discard** resets `homolog` to production. `/rollback` opens GitHub's revert pull request for the last release and merges it.

Requests in the same preview cycle continue the same agent session, so "make it bigger" has context. A question the agent asks (`needs_input`) shows its options as buttons; the answer resumes that session. Each member can have up to five requests waiting; revoking a member cancels theirs.

## Security

- The container sees only placeholders. The Gateway adds the Anthropic key to `POST /v1/messages`, `POST /v1/messages/count_tokens` and `GET /v1/models` while a request runs (with `AGENT_PROVIDER=subscription`, the owner's Claude subscription token as a bearer token, also to a few read-only account endpoints the CLI calls, listed in `gateway.ts`), and a repository token (from the instance broker, signed with `PROJECT_SECRET`) to git traffic for this repository only. Other GitHub traffic goes out without credentials, and credentialed requests do not follow redirects.
- The sandbox's token (`sandbox` scope) can only write contents, so GitHub refuses pushes that change workflows; pushes are accepted only while a request runs and only to `homolog`. The Worker's own token (`worker` scope: pull requests, workflows, workflow runs) stays in the Worker.
- The webhook is checked with Telegram's `secret_token`; the web API with the instance's public key (`INSTANCE_JWKS`), audience `project:<id>`, 10-minute maximum age.
- Membership is keyed by Telegram user id (`tg:<id>`) or instance user id (`u:<id>`). Invite codes are single use, expire in 24 hours and are stored hashed.
- Merges name the reviewed commit, so changes pushed after a review cannot be published by that approval.
- The preview is public but unlisted: an unguessable workers.dev name and `X-Robots-Tag: noindex`. It never proxies to the runner's control port (4840).

## Configuration

Vars: `PROJECT_ID`, `PROJECT_NAME`, `REPO_OWNER`, `REPO_NAME`, `PRODUCTION_BRANCH`, `INSTANCE_URL`, `INSTANCE_JWKS`, `PREVIEW_URL`, `PRODUCTION_URL`, `OWNER_KEY`, `OWNER_NAME`, `DEFAULT_LOCALE`, `CONTAINER_INSTANCE_TYPE`.
Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (optional: without it the agent is off and pushes still deploy; with the subscription provider it holds the `sk-ant-oat01-` token), `AGENT_PROVIDER` (`anthropic`, `compatible` or `subscription`), `AGENT_BASE_URL`, `AGENT_MODEL`, `AGENT_EFFORT`, `PROJECT_SECRET`.

The runtime API also has `POST /claude-login/start`, `/claude-login/finish` and `/claude-login/cancel` (owner only): they start the container if needed and relay to the runner's `claude setup-token` sign-in. The instance calls them only when it has no dedicated sign-in container (`runtime/claude-login`); its chat proxy does not reach them, since `finish` answers with the token.

`wrangler.jsonc` shows the deployed shape (Durable Object with SQLite, `containers` with `scheduling_policy: "durable_object"` and the `agent` image). The instance uploads the same shape through the Cloudflare API.

## Tests

`pnpm --filter @bohr/project-worker test` runs in the Workers pool with `wrangler.test.jsonc`. Containers have no local simulator, so tests replace the container, the repository API and outbound `fetch` through `src/deps.ts`, and fire alarms by hand.
