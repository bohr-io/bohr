# @bohr/github

The GitHub calls bohr makes: GitHub App authentication, the App manifest flow, webhook signatures, Actions secrets, and a small REST/GraphQL client for branches, pull requests, workflow runs and files. It uses only Web APIs (`fetch`, WebCrypto), so the same code runs on Cloudflare Workers and Node 22+.

```ts
import { createInstallationToken, GithubClient } from '@bohr/github';

const { token } = await createInstallationToken({
  appId: env.GITHUB_APP_ID,
  privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
  installationId,
  repositories: ['site'],
  permissions: { contents: 'write', pull_requests: 'write' },
});
const github = new GithubClient({ token });
const pr = await github.findOpenPullRequest('acme', 'site', 'homolog', 'main');
```

## API

GitHub App

- `createAppJwt(appId, privateKeyPem, now?)`: RS256 App JWT, `iat` one minute back and `exp` nine minutes ahead. Accepts PKCS#1 (`BEGIN RSA PRIVATE KEY`, what GitHub issues) and PKCS#8 PEM, including PEMs whose newlines were escaped as `\n` in an environment variable.
- `createInstallationToken({ appId, privateKeyPem, installationId, repositories?, permissions? })`: one-hour installation token, optionally narrowed.
- `getRepositoryInstallation({ appId, privateKeyPem, owner, repo })`: the App's installation on a repository, or `null`.
- `appManifest(options)` and `exchangeManifestCode(code)`: register a GitHub App from a manifest and collect its credentials. The manifest asks for contents, pull requests, workflows and secrets (write), actions and metadata (read), and subscribes to `push` and `pull_request`. `installation` and `installation_repositories` reach every App without a subscription.

Webhooks and secrets

- `verifyWebhookSignature(rawBody, request.headers.get('X-Hub-Signature-256'), secret)`
- `sealSecret(publicKeyBase64, value)`: libsodium sealed box (`crypto_box_seal`), the format Actions secrets take.

`GithubClient({ token, fetch?, apiBase?, userAgent?, sleep? })`

- `request(method, path, body?)`, `graphql(query, variables?)`, `paginate(path, pick)`
- Repositories and branches: `getRepository`, `getBranchSha`, `createBranch`, `updateBranch`, `deleteBranch`, `compare`
- Pull requests: `findOpenPullRequest`, `createPullRequest`, `getPullRequest`, `mergePullRequest`, `closePullRequest`, `revertPullRequest` (GraphQL)
- Actions: `listWorkflowRuns`, `setActionsSecret`
- Files: `getFile` (UTF-8 text, `null` when missing), `putFile`
- Installations and users: `listInstallationRepositories`, `listUserInstallations`, `listUserInstallationRepositories`, `getAuthenticatedUser`

Behavior:

- Non-2xx responses throw `GithubError` with `status`, the parsed `body` and `documentationUrl`; the message is `GitHub <status>: <message>`, including validation details. GraphQL responses carrying `errors` throw too.
- A 403/429 rate limit is retried once, after `retry-after` when it is 10 seconds or less, or after 10 seconds on a secondary rate limit without `retry-after`. Nothing else is retried.
- Lists follow `Link: rel="next"` for up to 20 pages of 100.
- `apiBase` defaults to `https://api.github.com`; for GitHub Enterprise Server pass `https://HOST/api/v3` (GraphQL then goes to `/api/graphql`).

## Security notes

- Imported App keys are cached in memory per PEM. JWTs live nine minutes and installation tokens one hour, so mint tokens per task and narrow them with `repositories` and `permissions`.
- The client keeps its token in a private field, out of `console.log` and `JSON.stringify`. Pagination never follows a link to another origin, so the token is not sent off the API host.
- Path segments are percent-encoded, and `.`/`..` segments are refused so that input such as a file path cannot move a request to another endpoint.
- `verifyWebhookSignature` compares the HMAC in constant time (WebCrypto `verify`) and returns false for a missing or malformed header or an empty secret. Pass the body exactly as received, before parsing it.
- `exchangeManifestCode` returns the App's private key, client secret and webhook secret. Store them encrypted and never log them; the code works once, within an hour.
- `sealSecret` uses a fresh ephemeral key pair for each value and zeroes the ephemeral secret key afterwards.

## Workers

tweetnacl contains a Node-only fallback (`require('crypto')`) that never runs on Workers, but wrangler turns it into an `import "crypto"`. Workers that bundle this package therefore need Node.js modules: the `nodejs_compat` flag with a compatibility date of 2024-09-23 or later, which `apps/instance` and `runtime/project-worker` already set.

## Development

```sh
pnpm --filter @bohr/github test       # vitest; tests never reach the network
pnpm --filter @bohr/github typecheck  # also checks src against Workers types alone
```
