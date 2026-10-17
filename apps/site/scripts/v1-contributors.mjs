// Writes src/data/v1-contributors.json: the people who built bohr v1, from the GitHub contributors of the
// bohr-io organization's repositories. Most of v1 is private (bohr-io/core), so the browser cannot ask GitHub for
// them the way the site asks for bohr-io/bohr's; the list is committed and merged with the live one
// (src/composables/useContributors.ts). Run it again to refresh, with a token that reads the private repositories:
//
//   GITHUB_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p') \
//     node apps/site/scripts/v1-contributors.mjs
import { writeFile } from 'node:fs/promises';

const ORG = 'bohr-io';
const OUTPUT = new URL('../src/data/v1-contributors.json', import.meta.url);
// bohr v2 (its contributors come live from GitHub) and repositories that are not bohr's own work: a customer's
// code the organization hosted (cw-*) and forks of other projects
const SKIP_REPOS = new Set(['bohr', 'deploy-action', 'wfp-smoke']);
const SKIP_REPO_PATTERN = /^cw-/;
// v1's release bot is a user account, so GitHub does not mark it as a bot
const SKIP_LOGINS = new Set(['bohr-bot']);

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Set GITHUB_TOKEN to a token that reads the bohr-io repositories.');
  process.exit(1);
}

async function github(path) {
  const results = [];
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bohr-site' },
      },
    );
    // 204: an empty repository
    if (response.status === 204) return results;
    if (!response.ok) throw new Error(`GitHub ${path}: ${response.status} ${await response.text()}`);
    const items = await response.json();
    results.push(...items);
    if (items.length < 100) return results;
  }
}

const repos = (await github(`/orgs/${ORG}/repos?type=all`)).filter(
  (repo) => !repo.fork && !SKIP_REPOS.has(repo.name) && !SKIP_REPO_PATTERN.test(repo.name),
);
const people = new Map();
for (const repo of repos) {
  for (const contributor of await github(`/repos/${ORG}/${repo.name}/contributors`)) {
    const { login } = contributor;
    if (contributor.type === 'Bot' || login.endsWith('[bot]') || SKIP_LOGINS.has(login)) continue;
    const person = people.get(login.toLowerCase()) ?? {
      login,
      avatarUrl: contributor.avatar_url,
      href: contributor.html_url,
      contributions: 0,
    };
    person.contributions += contributor.contributions;
    people.set(login.toLowerCase(), person);
  }
}

const list = [...people.values()].sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
await writeFile(OUTPUT, `${JSON.stringify(list, null, 2)}\n`);
console.log(`${list.length} contributors from ${repos.length} repositories`);
