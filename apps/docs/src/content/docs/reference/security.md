---
title: Security model
description: What bohr can access, how credentials are stored, and why the agent cannot publish or leak your keys.
sidebar:
  order: 4
---

## What bohr can access

| Access | Given by | Used for |
| --- | --- | --- |
| The repositories you select | bohr's GitHub App ([permissions](/getting-started/install-github-app/#what-the-app-can-do)) | The agent's branch, pull requests, merges, the deploy workflow, build logs |
| Your Cloudflare account | The API token you create ([permissions](/getting-started/connect-cloudflare/#create-the-token)) | Creating and updating each project's Workers, sandbox and preview; your production deploy; domains, variables and protection |
| Your model provider | Your API key or Claude subscription token | The agent's requests |

## How credentials are stored

| Credential | Stored | Notes |
| --- | --- | --- |
| Cloudflare API token | In the instance's vault, envelope-encrypted (AES-256-GCM) | Every use is recorded in the instance's audit log. Handed to your production deploy at run time (and to an owner's `bohr deploy`), never stored in GitHub. |
| GitHub App private key | In the instance's vault | Used for short-lived installation tokens scoped to one repository |
| Model key or Claude token | Encrypted in the instance, and as a secret of each project Worker | The sandbox only ever holds a placeholder |
| Build variables | Encrypted in the instance | Bound to their project, branch and name |
| Site variables | Secrets of your production Worker | bohr keeps plain values only to show them |
| Site passwords | PBKDF2-SHA256 hashes only | — |
| CLI and API tokens (`bohr_…`) | Only their SHA-256 hash | The token itself lives on your computer or in `BOHR_TOKEN` |
| Invite codes | Hashed | Single use, 24 hours |

## The agent's sandbox

The sandbox is a Cloudflare Container in the project owner's account. It **never holds a credential**:

- The agent sees placeholders. A gateway in the project Worker adds the real model key, only to the provider's message endpoints and only while a request runs, not while the preview runs between requests.
- Git traffic gets a short-lived token for that one repository, with **contents: write** and nothing else. Pushes are accepted only while a request runs, and only to `homolog`.
- Without the workflows permission, GitHub refuses any push that changes `.github/workflows`, so code in the sandbox cannot add a workflow that would run with the repository's secrets.
- Requests carrying credentials do not follow redirects, so a redirect cannot carry a key elsewhere.
- A malicious dependency installed in the sandbox can use the network, but cannot read the keys.

The one exception: connecting a Claude subscription runs `claude setup-token` in a container, where the new token exists until the sign-in ends. Instances with the dedicated sign-in container run it there, where no project code runs.

## Approvals

- Production changes only through an approved, merged pull request. The merge names the reviewed commit: changes pushed after a review cannot be published by that approval.
- The diff link in each decision shows exactly the commit that approving publishes.
- The preview is public but unlisted (an unguessable `workers.dev` name, `noindex`), and never reaches the sandbox's control port.

## Deploy credentials

Projects in your own account deploy from GitHub Actions with `wrangler deploy`, and **no Cloudflare token lives in the repository**. The workflow's first bohr step requests a GitHub OIDC token (audience `bohr.io`) and asks the instance for credentials. The instance verifies the token (issuer, audience, expiry, signature), finds the project by its repository id, and answers only when:

- the run is `.github/workflows/bohr-deploy.yml` on the production branch, triggered by `push` or `workflow_dispatch` (no pull request, other branch or other workflow);
- the project runs in its owner's Cloudflare account, with a connection of its owner (the user's, or the organization's).

Every answer is audited (repository, ref, run id; never the token). Every refusal is an HTTP 403 with the reason. Code that runs in the production workflow comes only from approved merges or people with write access to the production branch.

## Tokens

A `bohr_…` token acts as its user, only on the projects it lists, and never with the instance administrator role. Deploy sessions opened with a token can only be finished with the same token.

For [`bohr deploy`](/cli/deploy/#projects-in-your-own-cloudflare-account) of a project in its owner's Cloudflare account, a token can also obtain that account's Cloudflare API token and account id, which wrangler needs. The instance answers only when:

- the token reaches the project and its user is an owner of the project (for an organization's project: an admin of the organization);
- the project runs in its owner's Cloudflare account, with a connection of its owner. Never for projects bohr hosts, and never the token of bohr's own account.

Every issuance is recorded in the audit log (user, token, project), answered with `Cache-Control: no-store`, and limited to 30 per user and project in 10 minutes (HTTP 429 past that). The CLI puts the Cloudflare token only in wrangler's environment: never on a command line, in a log or on disk.

## What bohr leaves in your Cloudflare account

Every API call sends `User-Agent: bohr/<version> (+https://bohr.io)`; bohr's Workers carry the tags `bohr` and `bohr-project:<id>`; production deploys, and the versions `bohr deploy` uploads, carry the message `bohr` and the tag `bohr-<commit>` (`bohr-local` for a working tree with uncommitted changes).

## Reporting a vulnerability

Email [contact@bohr.io](mailto:contact@bohr.io). Please do not open public issues for security problems. We answer within 3 business days.
