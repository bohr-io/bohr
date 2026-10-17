import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  DEPLOY_CREDENTIALS_STEP_ID,
  d1MigrationBindings,
  deployConfigSchema,
  renderDeployWorkflow,
  stripJsonComments,
  usesBohrV1Action,
  usesDeployCredentials,
} from '../src/index';

type Workflow = {
  on: { push: { branches: string[] } };
  permissions: Record<string, string>;
  jobs: {
    deploy: {
      defaults: { run: { 'working-directory': string } };
      steps: {
        name?: string;
        id?: string;
        uses?: string;
        run?: string;
        with?: Record<string, string>;
        env?: Record<string, string>;
      }[];
    };
  };
};

const label = (step: Workflow['jobs']['deploy']['steps'][number]) =>
  step.uses ??
  (step.name === 'Build variables'
    ? 'build variables'
    : step.name === 'D1 migrations'
      ? 'd1 migrations'
      : step.name === 'Deploy' && step.run?.includes('wrangler.bohr-gate')
        ? 'gated deploy'
        : step.run);

/** The GitHub Actions expression that reads a repository secret. */
const secret = (name: string) => `\${{ secrets.${name} }}`;

const render = (config: unknown, target: 'wrangler' | 'bohr-cloud' = 'wrangler', instanceUrl?: string) =>
  parse(
    renderDeployWorkflow(deployConfigSchema.parse(config), {
      productionBranch: 'main',
      target,
      ...(instanceUrl ? { instanceUrl } : {}),
    }),
  ) as Workflow;

describe('deploy workflow', () => {
  it('deploys to the owner account only on pushes to production, with the credentials bohr hands the run', () => {
    const workflow = render({ install: 'npm ci', build: 'npm run build' });
    expect(workflow.on).toEqual({ push: { branches: ['main'] } });
    expect(workflow.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    const steps = workflow.jobs.deploy.steps;
    expect(steps.map(label)).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'build variables',
      'bohr-io/deploy-action@v1',
      'npm ci',
      'npm run build',
      'gated deploy',
    ]);
    expect(steps[0]?.with).toEqual({ 'persist-credentials': false });
    expect(steps[1]?.with).toEqual({ 'node-version': '24' });
    // Before install and build, which need the build variables it exports
    expect(steps[3]).toEqual({
      name: 'bohr credentials',
      id: DEPLOY_CREDENTIALS_STEP_ID,
      uses: 'bohr-io/deploy-action@v1',
      with: { credentials: 'true' },
    });
    // The Cloudflare token only reaches the deploy step, and never comes from the repository's secrets
    expect(steps.at(-1)?.env).toEqual({
      CLOUDFLARE_API_TOKEN: `\${{ steps.bohr-credentials.outputs.cloudflare-api-token }}`,
      CLOUDFLARE_ACCOUNT_ID: `\${{ steps.bohr-credentials.outputs.cloudflare-account-id }}`,
    });
    for (const step of steps.slice(0, -1)) expect(JSON.stringify(step)).not.toContain('CLOUDFLARE_');
    const text = renderDeployWorkflow(deployConfigSchema.parse({ build: 'npm run build' }), {
      productionBranch: 'main',
      target: 'wrangler',
    });
    expect(text).not.toContain('secrets.CLOUDFLARE');
    expect(usesDeployCredentials(text)).toBe(true);

    // A self-hosted instance: the step asks it
    const own = render({}, 'wrangler', 'https://bohr.acme.dev').jobs.deploy.steps[3];
    expect(own?.with).toEqual({ credentials: 'true', 'instance-url': 'https://bohr.acme.dev' });
    expect(render({}, 'wrangler', 'https://app.bohr.io').jobs.deploy.steps[3]?.with).toEqual({ credentials: 'true' });
  });

  it('tells workflows that still read the Cloudflare secrets from the ones that ask bohr', () => {
    const custom = renderDeployWorkflow(deployConfigSchema.parse({ deploy: 'npm run deploy' }), {
      productionBranch: 'main',
      target: 'wrangler',
    });
    expect(usesDeployCredentials(custom)).toBe(true);
    const legacy = custom.replace(
      /steps\.bohr-credentials\.outputs\.cloudflare-api-token/,
      'secrets.CLOUDFLARE_API_TOKEN',
    );
    expect(usesDeployCredentials(legacy)).toBe(false);
    const cloud = renderDeployWorkflow(deployConfigSchema.parse({}), {
      productionBranch: 'main',
      target: 'bohr-cloud',
    });
    expect(usesDeployCredentials(cloud)).toBe(false);
    expect(
      usesDeployCredentials("      - uses: 'bohr-io/deploy-action@v1'\n        with:\n          credentials: 'true'\n"),
    ).toBe(true);
  });

  it('deploys managed projects with the bohr action and OIDC, without Cloudflare secrets', () => {
    const workflow = render({ directory: 'apps/web', packageManager: 'pnpm', install: 'pnpm i' }, 'bohr-cloud');
    expect(workflow.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(workflow.jobs.deploy.defaults.run['working-directory']).toBe('apps/web');
    const steps = workflow.jobs.deploy.steps;
    expect(steps.map(label)).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'corepack enable',
      'build variables',
      'pnpm i',
      'bohr-io/deploy-action@v1',
    ]);
    expect(steps.at(-1)?.with).toEqual({ 'working-directory': 'apps/web' });
    expect(JSON.stringify(workflow)).not.toContain('secrets.');

    const own = render({}, 'bohr-cloud', 'https://bohr.acme.dev');
    expect(own.jobs.deploy.steps.at(-1)?.with).toEqual({
      'working-directory': '.',
      'instance-url': 'https://bohr.acme.dev',
    });
  });

  it('passes the build secrets the project names to install and build, never the Cloudflare ones', () => {
    const steps = render({ install: 'npm ci', build: 'npm run build', secrets: ['NEXT_PUBLIC_API', 'SENTRY_TOKEN'] })
      .jobs.deploy.steps;
    const env = { NEXT_PUBLIC_API: secret('NEXT_PUBLIC_API'), SENTRY_TOKEN: secret('SENTRY_TOKEN') };
    expect(steps.find((step) => step.run === 'npm ci')?.env).toEqual(env);
    expect(steps.find((step) => step.run === 'npm run build')?.env).toEqual(env);
    for (const secrets of [['CLOUDFLARE_API_TOKEN'], ['GITHUB_TOKEN'], ['lower'], ['A-B']]) {
      expect(deployConfigSchema.safeParse({ secrets }).success, secrets[0]).toBe(false);
    }
  });

  it('deploys with a Node.js wrangler runs on when the project builds on an older one', () => {
    const steps = render({ node: '20', install: 'npm ci', build: 'npm run build' }).jobs.deploy.steps;
    expect(steps.map(label)).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'build variables',
      'bohr-io/deploy-action@v1',
      'npm ci',
      'npm run build',
      'actions/setup-node@v5',
      'gated deploy',
    ]);
    expect(steps[1]?.with).toEqual({ 'node-version': '20' });
    expect(steps[6]?.with).toEqual({ 'node-version': '22' });
    // Newer projects, and managed hosting (the bohr action runs on its own Node), keep one setup-node
    expect(
      render({ node: '22' }).jobs.deploy.steps.filter((step) => step.uses === 'actions/setup-node@v5'),
    ).toHaveLength(1);
    expect(
      render({ node: '20' }, 'bohr-cloud').jobs.deploy.steps.filter((step) => step.uses === 'actions/setup-node@v5'),
    ).toHaveLength(1);
  });

  it('sets up Bun and Python when the project uses them', () => {
    const steps = render({ packageManager: 'bun', python: '3.12', build: 'bun run build' }).jobs.deploy.steps;
    expect(steps.map(label)).toEqual([
      'actions/checkout@v5',
      'oven-sh/setup-bun@v2',
      'actions/setup-node@v5',
      'actions/setup-python@v6',
      'build variables',
      'bohr-io/deploy-action@v1',
      'bun run build',
      'gated deploy',
    ]);
  });

  it('keeps commands on their own line and refuses expressions and odd folders', () => {
    const tricky = render({ build: 'echo "a: b" # c', deploy: "npx wrangler deploy --var 'X:1'" });
    expect(
      tricky.jobs.deploy.steps
        .filter((step) => step.name !== 'Build variables')
        .map((step) => step.run)
        .filter(Boolean),
    ).toEqual(['echo "a: b" # c', "npx wrangler deploy --var 'X:1'"]);
    for (const config of [
      { build: 'npm run build\n      - run: curl evil' },
      { build: `echo ${secret('CLOUDFLARE_API_TOKEN')}` },
      { directory: '../other' },
      { directory: '/etc' },
      { directory: 'apps/../..' },
      { directory: '.github' },
      { node: 'latest' },
    ]) {
      expect(deployConfigSchema.safeParse(config).success, JSON.stringify(config)).toBe(false);
    }
  });

  it('loads the BOHR_BUILD_ secrets into the build environment, and nothing else', () => {
    const step = render({ build: 'npm run build' }).jobs.deploy.steps.find(
      (candidate) => candidate.name === 'Build variables',
    );
    expect(step?.env).toEqual({ BOHR_SECRETS: `\${{ toJSON(secrets) }}` });
    const script = (step?.run ?? '').split('\n').slice(1, -2).join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'bohr-build-vars-'));
    const githubEnv = join(dir, 'env');
    writeFileSync(githubEnv, '');
    execFileSync(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        GITHUB_ENV: githubEnv,
        BOHR_SECRETS: JSON.stringify({
          BOHR_BUILD_API_URL: 'https://api.example.com',
          BOHR_BUILD_MULTI: 'line 1\nline 2',
          CLOUDFLARE_API_TOKEN: 'never-in-the-build',
          github_token: 'ghs_x',
        }),
      },
    });
    const written = readFileSync(githubEnv, 'utf8');
    expect(written).toMatch(/^API_URL<<(EOF\w+)\nhttps:\/\/api\.example\.com\n\1\n/);
    expect(written).toMatch(/MULTI<<(EOF\w+)\nline 1\nline 2\n\1\n/);
    expect(written).not.toContain('never-in-the-build');
    expect(written).not.toContain('ghs_x');
  });
});

describe('D1 migrations', () => {
  const withMigrations = (config: unknown, target: 'wrangler' | 'bohr-cloud' = 'wrangler') =>
    parse(
      renderDeployWorkflow(deployConfigSchema.parse(config), { productionBranch: 'main', target, d1Migrations: true }),
    ) as Workflow;
  const script = (workflow: Workflow) => {
    const step = workflow.jobs.deploy.steps.find((candidate) => candidate.name === 'D1 migrations');
    return (step?.run ?? '').split('\n').slice(1, -2).join('\n');
  };

  it('applies them after the build and before the deploy, with the deploy credentials', () => {
    const workflow = withMigrations({ install: 'npm ci', build: 'npm run build' });
    const steps = workflow.jobs.deploy.steps;
    expect(steps.map(label)).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'build variables',
      'bohr-io/deploy-action@v1',
      'npm ci',
      'npm run build',
      'd1 migrations',
      'gated deploy',
    ]);
    expect(steps.at(-2)?.env).toEqual(steps.at(-1)?.env);
    expect(script(workflow)).toContain(
      "execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', name, '--remote']",
    );
    // A custom deploy command too; projects bohr hosts have no D1 of their own
    expect(withMigrations({ deploy: 'npm run deploy' }).jobs.deploy.steps.map(label).slice(-2)).toEqual([
      'd1 migrations',
      'npm run deploy',
    ]);
    expect(withMigrations({}, 'bohr-cloud').jobs.deploy.steps.map(label)).not.toContain('d1 migrations');
    // Without migrations the workflow is the one projects already have
    expect(render({ build: 'npm run build' }).jobs.deploy.steps.map(label)).not.toContain('d1 migrations');
  });

  it('finds the databases that declare a migrations folder in a wrangler.jsonc', () => {
    const config = JSON.parse(
      stripJsonComments(`{
        // The site
        "name": "loja", /* "d1_databases": [] */
        "url": "https://example.com/a//b",
        "d1_databases": [
          { "binding": "DB", "database_name": "loja-db", "migrations_dir": "migrations" },
          { "database_name": "logs", "migrations_dir": "logs/migrations" },
          { "binding": "CACHE", "database_name": "cache" }
        ]
      }`),
    );
    expect(config.url).toBe('https://example.com/a//b');
    expect(d1MigrationBindings(config)).toEqual(['DB', 'logs']);
    expect(d1MigrationBindings({ name: 'site' })).toEqual([]);
    expect(d1MigrationBindings(null)).toEqual([]);
  });

  it('runs nothing without a wrangler config or a migrations folder', () => {
    const run = script(withMigrations({}));
    const dir = mkdtempSync(join(tmpdir(), 'bohr-d1-'));
    execFileSync(process.execPath, ['-e', run], { cwd: dir });
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      '{ "d1_databases": [{ "binding": "DB", "database_name": "x", "migrations_dir": "missing" }] }',
    );
    expect(execFileSync(process.execPath, ['-e', run], { cwd: dir, encoding: 'utf8' })).toBe('');
  });

  it('applies each database that has its migrations folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bohr-d1-'));
    mkdirSync(join(dir, 'migrations'));
    const log = join(dir, 'npx.log');
    // npx stands in for itself: a node script that records its arguments
    const npx = join(dir, 'npx.cjs');
    writeFileSync(
      npx,
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`,
    );
    const original = "execFileSync('npx', [";
    expect(script(withMigrations({}))).toContain(original);
    const run = script(withMigrations({})).replace(
      original,
      `execFileSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(npx)}, `,
    );
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `{
        // comments are fine
        "d1_databases": [
          { "binding": "DB", "database_name": "loja-db", "migrations_dir": "migrations" },
          { "binding": "OTHER", "database_name": "other", "migrations_dir": "missing" }
        ]
      }`,
    );
    execFileSync(process.execPath, ['-e', run], { cwd: dir });
    expect(readFileSync(log, 'utf8')).toBe('wrangler d1 migrations apply DB --remote\n');
  });
});

describe('bohr v1 workflows', () => {
  it('recognizes the v1 action, not the v2 deploy action', () => {
    const v1 = [
      'name: bohr.io deploy',
      'on: [push]',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: bohr-io/action@main',
      '        with:',
      '          project: anaelucas',
    ].join('\n');
    expect(usesBohrV1Action(v1)).toBe(true);
    expect(usesBohrV1Action('    steps:\n      - name: Deploy\n        uses: "bohr-io/action@v1" # old\n')).toBe(true);
    expect(usesBohrV1Action('      - uses: bohr-io/action\n')).toBe(true);

    expect(usesBohrV1Action('      - uses: bohr-io/deploy-action@v1\n')).toBe(false);
    expect(usesBohrV1Action('      - uses: bohr-io/action-cache@v1\n')).toBe(false);
    expect(usesBohrV1Action('      # uses: bohr-io/action@main\n')).toBe(false);
    const v2 = renderDeployWorkflow(deployConfigSchema.parse({ build: 'npm run build' }), {
      productionBranch: 'main',
      target: 'bohr-cloud',
      instanceUrl: 'https://app.bohr.io',
    });
    expect(usesBohrV1Action(v2)).toBe(false);
  });
});
