# @bohr/shared

Contracts shared by the instance, the project Worker and the agent runner, as zod schemas and types:

| Module | Contract |
| --- | --- |
| `agent.ts` | Project Worker ↔ agent runner: the job, the events the runner pushes to `bohr.internal`, the runner's endpoints and the `.bohr/preview.json` format |
| `requests.ts` | Request statuses and the preview ("homolog") state machine |
| `runtime-api.ts` | The runtime API the web interface reaches through the instance, the member keys and the instance's token claims |
| `broker.ts` | Project Worker → instance calls (GitHub tokens, member sync) and their HMAC signatures |
| `invites.ts` | Single-use invite codes (Crockford base32, stored hashed) |
| `locales.ts`, `defaults.ts` | Supported languages and defaults (model, budget, turns, work branch, invite lifetime) |

Changing a schema here changes a wire format between components that may be deployed at different times: keep new fields optional.
