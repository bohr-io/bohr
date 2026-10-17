// Development only: fills the LOCAL database of `wrangler dev -c wrangler.local.jsonc` (scripts/dev-local.md)
// with realistic data: people who sign in with an emailed code (printed in the instance's log), personal
// projects, and two organizations with members and projects. Never touches a remote database (--local).
//
//   node apps/instance/scripts/seed-local.mjs
//
// Safe to run again: existing rows are kept, missing ones (a project deleted while testing) come back.
// Placeholders stand in for credentials (Cloudflare tokens), so anything that calls Cloudflare or GitHub fails.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const instanceDir = path.join(here, '..');
const require = createRequire(import.meta.url);
const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const CONFIG = 'wrangler.local.jsonc';

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const ago = (days, hours = 0) => now - days * DAY - hours * 60 * 60_000;

const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(Math.round(value));
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
};
const statements = [];
const insert = (table, row) => {
  const columns = Object.keys(row);
  statements.push(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column])).join(', ')}) ON CONFLICT DO NOTHING;`,
  );
};

// People: sign in at the panel with "Email" and one of these addresses.
const people = [
  { id: 'u_local_dev', name: 'Dev Local', email: 'dev@localhost.test', role: 'admin', github: [910001, 'dev-local'] },
  { id: 'u_local_ana', name: 'Ana Souza', email: 'ana@localhost.test', role: 'user', github: [910002, 'ana-souza'] },
  {
    id: 'u_local_bruno',
    name: 'Bruno Lima',
    email: 'bruno@localhost.test',
    role: 'user',
    github: [910003, 'brunolima'],
  },
];
for (const person of people) {
  insert('users', { id: person.id, name: person.name, email: person.email, role: person.role, created_at: ago(120) });
  insert('identities', {
    id: `i_${person.id}_email`,
    user_id: person.id,
    provider: 'email',
    provider_user_id: person.email,
    username: person.email,
    created_at: ago(120),
  });
  insert('identities', {
    id: `i_${person.id}_github`,
    user_id: person.id,
    provider: 'github',
    provider_user_id: String(person.github[0]),
    username: person.github[1],
    created_at: ago(120),
  });
  // The onboarding is done: the projects page lists projects instead of sending people to /start
  insert('onboarding', {
    user_id: person.id,
    step: 'done',
    data: JSON.stringify({ step: 'done' }),
    updated_at: ago(100),
  });
}

// GitHub App installations (personal accounts and organizations) and Cloudflare accounts (placeholder tokens)
const installations = [
  { id: 950001, account_login: 'dev-local', account_type: 'User', user_id: 'u_local_dev' },
  { id: 950002, account_login: 'ana-souza', account_type: 'User', user_id: 'u_local_ana' },
  { id: 950010, account_login: 'acme-labs', account_type: 'Organization', user_id: 'u_local_dev' },
  { id: 950011, account_login: 'globex', account_type: 'Organization', user_id: 'u_local_ana' },
];
for (const row of installations) insert('github_installations', { ...row, created_at: ago(110) });

const orgs = [
  {
    id: 'org_local_acme',
    slug: 'acme-labs',
    name: 'Acme Labs',
    github_account_id: 960010,
    github_login: 'acme-labs',
    installation_id: 950010,
  },
  {
    id: 'org_local_globex',
    slug: 'globex',
    name: 'Globex',
    github_account_id: 960011,
    github_login: 'globex',
    installation_id: 950011,
  },
];
for (const org of orgs) {
  insert('orgs', { ...org, avatar_url: null, members_permission: true, created_at: ago(90), updated_at: ago(10) });
}

const connections = [
  {
    id: 'cf_local_dev',
    user_id: 'u_local_dev',
    org_id: null,
    account_id: 'local0000000000000000000000000001',
    account_name: 'Dev Local',
  },
  {
    id: 'cf_local_ana',
    user_id: 'u_local_ana',
    org_id: null,
    account_id: 'local0000000000000000000000000002',
    account_name: 'Ana Souza',
  },
  {
    id: 'cf_local_acme',
    user_id: 'u_local_dev',
    org_id: 'org_local_acme',
    account_id: 'local0000000000000000000000000010',
    account_name: 'Acme Labs',
  },
];
for (const connection of connections) {
  insert('cf_connections', {
    ...connection,
    token_sealed: 'local-placeholder',
    capabilities: JSON.stringify({}),
    workers_subdomain: connection.account_name.toLowerCase().replaceAll(' ', '-'),
    verified_at: ago(80),
    created_at: ago(80),
  });
}

// Members: Dev is an admin of Acme Labs and a member of Globex; Carol has not signed in to bohr yet (pending)
const members = [
  ['org_local_acme', 910001, 'dev-local', 'u_local_dev', 'admin', 'active'],
  ['org_local_acme', 910002, 'ana-souza', 'u_local_ana', 'member', 'active'],
  ['org_local_acme', 910003, 'brunolima', 'u_local_bruno', 'member', 'active'],
  ['org_local_acme', 910004, 'carol-dev', null, 'member', 'pending'],
  ['org_local_globex', 910002, 'ana-souza', 'u_local_ana', 'admin', 'active'],
  ['org_local_globex', 910001, 'dev-local', 'u_local_dev', 'member', 'active'],
];
for (const [orgId, githubUserId, login, userId, role, status] of members) {
  insert('org_members', {
    org_id: orgId,
    github_user_id: githubUserId,
    github_login: login,
    user_id: userId,
    role,
    status,
    source: 'github',
    github_role: role,
    created_at: ago(90),
    updated_at: ago(30),
  });
}

// Projects: [id, name, repository, mode, owner, org, extra members, production hostname, updated days ago]
const projects = [
  ['p_local_portfolio', 'portfolio', 'dev-local/portfolio', 'byo', 'u_local_dev', null, [], 'portfolio.bohr.io', 2],
  ['p_local_blog', 'blog', 'dev-local/blog', 'managed', 'u_local_dev', null, ['u_local_ana'], 'blog-dev.bohr.io', 5],
  ['p_local_landing', 'landing-page', 'dev-local/landing-page', 'byo', 'u_local_dev', null, [], null, 12],
  ['p_local_notes', 'notes-app', 'dev-local/notes-app', 'byo', 'u_local_dev', null, [], null, 30],
  [
    'p_local_recipes',
    'recipes',
    'ana-souza/recipes',
    'byo',
    'u_local_ana',
    null,
    ['u_local_dev'],
    'recipes.bohr.io',
    7,
  ],
  ['p_local_acme_web', 'acme-web', 'acme-labs/acme-web', 'byo', 'u_local_dev', 'org_local_acme', [], 'acme.bohr.io', 1],
  ['p_local_acme_api', 'acme-api', 'acme-labs/acme-api', 'byo', 'u_local_dev', 'org_local_acme', [], null, 3],
  [
    'p_local_acme_docs',
    'acme-docs',
    'acme-labs/acme-docs',
    'managed',
    'u_local_ana',
    'org_local_acme',
    [],
    'docs.acme.bohr.io',
    9,
  ],
  ['p_local_acme_shop', 'acme-shop', 'acme-labs/acme-shop', 'byo', 'u_local_bruno', 'org_local_acme', [], null, 20],
  [
    'p_local_globex_portal',
    'globex-portal',
    'globex/portal',
    'byo',
    'u_local_ana',
    'org_local_globex',
    ['u_local_dev'],
    'portal.globex.bohr.io',
    4,
  ],
  ['p_local_globex_status', 'globex-status', 'globex/status', 'byo', 'u_local_ana', 'org_local_globex', [], null, 15],
];
let repoId = 970000;
for (const [id, name, repository, mode, owner, orgId, extra, hostname, updatedDays] of projects) {
  const [repoOwner, repoName] = repository.split('/');
  repoId += 1;
  insert('projects', {
    id,
    owner_user_id: owner,
    name,
    repo_owner: repoOwner,
    repo_name: repoName,
    repo_key: repository.toLowerCase(),
    repo_id: repoId,
    production_branch: 'main',
    mode,
    status: 'active',
    org_id: orgId,
    created_at: ago(updatedDays + 40),
    updated_at: ago(updatedDays),
  });
  insert('project_members', { project_id: id, user_id: owner, role: 'owner', created_at: ago(updatedDays + 40) });
  for (const member of extra) {
    insert('project_members', { project_id: id, user_id: member, role: 'member', created_at: ago(updatedDays + 20) });
  }
  if (hostname !== null) {
    insert('hostnames', {
      hostname,
      project_id: id,
      branch: 'main',
      is_production: true,
      status: 'live',
      created_at: ago(updatedDays + 40),
    });
  }
  // A few deploys: the latest one failed for every third project
  const failedLast = repoId % 3 === 0;
  for (let index = 0; index < 3; index++) {
    const at = ago(updatedDays + index * 2, 3);
    const status = index === 0 && failedLast ? 'error' : 'success';
    insert('deployments', {
      id: `d_${id}_${index}`,
      project_id: id,
      branch: index === 1 ? 'feature/new-header' : 'main',
      script: `${name}-main`,
      commit_sha: (repoId * 7919 + index).toString(16).padStart(40, 'a').slice(0, 40),
      status,
      error: status === 'error' ? 'Build failed: npm run build exited with code 1' : null,
      bundle_key: null,
      actor: 'github-actions',
      created_at: at,
      finished_at: at + 90_000,
    });
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'bohr-seed-'));
const file = path.join(dir, 'seed.sql');
writeFileSync(file, `${statements.join('\n')}\n`);
// wrangler prints every statement's result: only its errors are shown
const run = (args, quiet = false) =>
  execFileSync(process.execPath, [wrangler, ...args, '--local', '-c', CONFIG], {
    cwd: instanceDir,
    stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'],
  });
try {
  // The instance also applies them on its first request; this keeps the seed independent of that
  run(['d1', 'migrations', 'apply', 'DB']);
  run(['d1', 'execute', 'DB', `--file=${file}`], true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nSeeded ${projects.length} projects, ${orgs.length} organizations and ${people.length} people.`);
console.log('Sign in with Email and one of:');
for (const person of people)
  console.log(`  ${person.email}  (${person.name}${person.role === 'admin' ? ', instance admin' : ''})`);
console.log('The code is in the instance log: look for "Subject: <code> is your bohr code".');
