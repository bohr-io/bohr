#!/usr/bin/env node
// Publishes the starter templates in templates/<slug>/ to the public GitHub template repositories
// bohr-io/template-<slug> (the "new project from template" catalog, templates/catalog.json).
//
//   GITHUB_TOKEN=... node scripts/publish-templates.mjs            # dry run: shows what would change
//   GITHUB_TOKEN=... node scripts/publish-templates.mjs --apply    # creates the repositories and pushes
//   node scripts/publish-templates.mjs --only=waitlist,booking     # some templates only
//
// For each template it creates the repository when missing (public, marked as a template), then writes the
// directory's files (the ones git would track: .gitignore'd files such as node_modules, .wrangler and .dev.vars
// are left out) as ONE commit on `main`, through the Git data API. Publishing the same content again changes
// nothing. The token needs to create repositories in the organization and write their contents.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const API = 'https://api.github.com';
const BRANCH = 'main';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a script run by hand, not a turbo task
const token = process.env.GITHUB_TOKEN;

if (apply && !token) {
  console.error('GITHUB_TOKEN is required with --apply.');
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(path.join(TEMPLATES_DIR, 'catalog.json'), 'utf8'));
const entries = catalog.filter((entry) => !only || only.includes(entry.slug));
if (only) {
  const unknown = only.filter((slug) => !catalog.some((entry) => entry.slug === slug));
  if (unknown.length > 0) {
    console.error(`Not in templates/catalog.json: ${unknown.join(', ')}`);
    process.exit(1);
  }
}

const sourceCommit = git(['rev-parse', '--short', 'HEAD']).trim();
const sourceDirty = git(['status', '--porcelain', '--', 'templates']).trim() !== '';

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The template's files that git would track (committed or not, minus ignored ones), relative to its folder. */
function templateFiles(slug) {
  const prefix = `templates/${slug}/`;
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', prefix])
    .split('\0')
    .filter(Boolean);
  const files = [...new Set(listed)]
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    // Never publish local secrets or build state, even if an ignore rule is missing
    .filter((file) => !/(^|\/)(node_modules|\.wrangler)\//.test(file) && !/(^|\/)\.dev\.vars$/.test(file))
    .sort();
  if (files.length === 0) throw new Error(`templates/${slug} has no files.`);
  for (const required of ['package.json', 'wrangler.jsonc', 'migrations/0001_init.sql', 'README.md']) {
    if (!files.includes(required)) throw new Error(`templates/${slug} is missing ${required}.`);
  }
  return files.map((file) => ({ path: file, content: readFileSync(path.join(TEMPLATES_DIR, slug, file)) }));
}

async function github(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bohr-publish-templates',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404) return null;
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(`${method} ${url}: ${response.status} ${data?.message ?? ''}`.trim());
    error.status = response.status;
    throw error;
  }
  return data;
}

async function currentHead(fullName) {
  try {
    const ref = await github('GET', `/repos/${fullName}/git/ref/heads/${BRANCH}`);
    if (ref === null) return null;
    const commit = await github('GET', `/repos/${fullName}/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: commit.tree.sha };
  } catch (error) {
    // 409: the repository is empty
    if (error.status === 409) return null;
    throw error;
  }
}

async function ensureRepository(org, name, entry) {
  const fullName = `${org}/${name}`;
  const description = entry.locales?.en?.description ?? `bohr starter template: ${entry.slug}`;
  const existing = await github('GET', `/repos/${fullName}`);
  if (existing === null) {
    console.log(`  creating ${fullName}`);
    // auto_init gives the repository a first commit, which the Git data API needs to write to it
    const created = await github('POST', `/orgs/${org}/repos`, {
      name,
      description,
      homepage: 'https://bohr.io',
      private: false,
      is_template: true,
      auto_init: true,
      has_wiki: false,
      has_projects: false,
    });
    return { fullName, created: true, defaultBranch: created.default_branch };
  }
  if (!existing.is_template || existing.private || existing.description !== description) {
    console.log(`  updating ${fullName} settings (template, public, description)`);
    await github('PATCH', `/repos/${fullName}`, { is_template: true, private: false, description });
  }
  return { fullName, created: false, defaultBranch: existing.default_branch };
}

async function publish(entry) {
  const [org, name] = entry.repository.split('/');
  if (!org || !name || name !== `template-${entry.slug}`) {
    throw new Error(`${entry.slug}: repository must be <org>/template-${entry.slug}, got ${entry.repository}.`);
  }
  const files = templateFiles(entry.slug);
  const bytes = files.reduce((total, file) => total + file.content.length, 0);
  console.log(`\n${entry.slug} → ${entry.repository} (${files.length} files, ${(bytes / 1024).toFixed(1)} KiB)`);

  if (!apply) {
    for (const file of files) console.log(`  ${file.path}`);
    if (token) {
      const repo = await github('GET', `/repos/${entry.repository}`);
      if (repo === null)
        console.log(`  [dry run] would create ${entry.repository} (public template) and push ${BRANCH}`);
      else
        console.log(
          `  [dry run] exists (template: ${repo.is_template}); would push one commit to ${BRANCH} if anything changed`,
        );
    } else {
      console.log('  [dry run] set GITHUB_TOKEN to compare with GitHub');
    }
    return;
  }

  const repo = await ensureRepository(org, name, entry);
  let head = await currentHead(repo.fullName);
  // A just-created repository may take a moment before its first commit shows up
  for (let attempt = 0; repo.created && repo.defaultBranch === BRANCH && head === null && attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    head = await currentHead(repo.fullName);
  }

  const tree = [];
  for (const file of files) {
    const blob = await github('POST', `/repos/${repo.fullName}/git/blobs`, {
      content: file.content.toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  // No base_tree: the template's files replace everything, so removed files disappear too
  const newTree = await github('POST', `/repos/${repo.fullName}/git/trees`, { tree });
  if (head !== null && head.tree === newTree.sha) {
    console.log('  up to date');
  } else {
    const commit = await github('POST', `/repos/${repo.fullName}/git/commits`, {
      message: `Template ${entry.slug} from bohr-io/bohr@${sourceCommit}${sourceDirty ? ' (with uncommitted changes)' : ''}`,
      tree: newTree.sha,
      parents: head === null ? [] : [head.commit],
    });
    if (head === null) {
      await github('POST', `/repos/${repo.fullName}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
    } else {
      await github('PATCH', `/repos/${repo.fullName}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
    }
    console.log(`  pushed ${commit.sha.slice(0, 12)} to ${BRANCH}`);
  }
  if (repo.defaultBranch !== undefined && repo.defaultBranch !== BRANCH) {
    await github('PATCH', `/repos/${repo.fullName}`, { default_branch: BRANCH });
    console.log(`  default branch set to ${BRANCH}`);
  }
}

console.log(
  apply
    ? `Publishing ${entries.length} template(s) from ${sourceCommit}${sourceDirty ? ' (templates/ has uncommitted changes)' : ''}`
    : `Dry run for ${entries.length} template(s) — pass --apply to publish`,
);
let failed = false;
for (const entry of entries) {
  try {
    await publish(entry);
  } catch (error) {
    failed = true;
    console.error(`  failed: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
