---
title: AGENTS.md / CLAUDE.md snippet
description: Copy-paste instructions that teach a coding agent to deploy your project with the bohr CLI.
sidebar:
  order: 4
---

Paste this section into your repository's instructions file: `AGENTS.md` (Codex, Cursor and many others), `CLAUDE.md` (Claude Code), `.cursor/rules`, or whatever your agent reads. It tells the agent how to deploy previews, when not to deploy production, and what to do on each exit code.

**Download:** [AGENTS.md](/downloads/AGENTS.md) (plain Markdown).

To append it to your `AGENTS.md` from a terminal (it is added only if the download really is the snippet):

```sh
tmp=$(mktemp)
if curl -fsSL https://docs.bohr.io/downloads/AGENTS.md -o "$tmp" && grep -q 'npx --yes bohr@latest' "$tmp" &&
  ! grep -qi '<html' "$tmp"; then
  printf '\n' >> AGENTS.md && cat "$tmp" >> AGENTS.md && echo "Added to AGENTS.md"
else
  echo "The download is not the bohr snippet: AGENTS.md was not changed." >&2
fi
rm -f "$tmp"
```

<!-- download:start -->

````markdown
## Deploying with bohr

This project deploys with [bohr](https://docs.bohr.io). Use the bohr CLI; never deploy with other tools.

- Authentication: the `BOHR_TOKEN` environment variable (a token from the bohr panel, Account › Tokens). Never print it, log it, commit it or pass it on the command line.
- Always run the CLI non-interactively with `--json`: `npx --yes bohr@latest <command> --json`. stdout is exactly one JSON object; logs go to stderr.
- Find the project once: `npx --yes bohr@latest projects --json`. Use the `id` of the project whose `repository` matches this repo. `mode: "managed"`: bohr hosts it. `mode: "byo"`: it runs in its owner's Cloudflare account, and only an owner's token can deploy it (previews too).
- Deploy a **preview** after each change you want to show:
  `npx --yes bohr@latest deploy --project <id> --branch <branch> --json`
  Read `url` from the JSON and give it to the user. Use a branch name that describes the change (for example `agent/fix-contact-form`).
- **Never deploy production** (`--prod`) unless the user explicitly asked for a production deploy in this conversation. Production needs the owner role.
- Never commit `.env` files or secrets. bohr never publishes `.git` or `.env*` files.
- Exit codes: 0 done; 1 failed (read `error.message`, fix the build, retry once); 2 wrong usage (fix the command); 3 not signed in or token rejected (stop and ask the user for a valid `BOHR_TOKEN`); 4 project not found or not a bohr v2 project (check `projects --json`, do not guess); 5 not allowed (do not retry; tell the user: production without the owner role, a project in its owner's Cloudflare account without the owner role, a suspended project, or a wrangler config for another Worker).
- If `error.code` is `own_account_not_allowed`, this token cannot deploy the project: commit to a branch, open a pull request to the production branch and let a person merge it. Do not push to the production branch yourself. If it is `own_account`, the CLI is outdated: run `npx --yes bohr@latest`.
- For `mode: "byo"` projects, previews use the production D1 databases and apply no migrations: ask the user before deploying a preview that writes data or needs a schema change. If `url` is `null`, the Worker has no preview URLs (`"preview_urls": true` in its wrangler config).
- Build settings live in `.bohr/deploy.json`; the preview's dev server in `.bohr/preview.json`. Do not edit `.github/workflows/bohr-deploy.yml`: bohr generates it.
````

<!-- download:end -->

## Adapting it

- If you always deploy the same project, replace the `projects --json` step with its id, or run `bohr link` and commit `.bohr/project.json`.
- Keep the production rule unless you really want the agent to publish without asking, and keep the token limited to the project either way.
- Keep the `own_account_not_allowed` and D1 rules for projects in your own Cloudflare account: only an owner's token deploys them, and their previews use production's D1 databases ([details](/cli/deploy/#projects-in-your-own-cloudflare-account)).
