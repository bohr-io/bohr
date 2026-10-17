import { z } from 'zod';
import { gateSetupScript, JSONC_STRIP_SCRIPT } from './site-gate';

/** Where the agent describes the production build. bohr turns it into the deploy workflow. */
export const DEPLOY_CONFIG_PATH = '.bohr/deploy.json';
/** The workflow bohr writes from DEPLOY_CONFIG_PATH. The sandbox itself can never change workflows. */
export const DEPLOY_WORKFLOW_PATH = '.github/workflows/bohr-deploy.yml';
/** First line of the workflows bohr writes. bohr only replaces a workflow that starts with it. */
export const DEPLOY_WORKFLOW_HEADER = `# Written by bohr from ${DEPLOY_CONFIG_PATH}.`;
/** Where GitHub Actions workflows live. */
export const WORKFLOWS_DIR = '.github/workflows';
/** The GitHub Action of bohr v1, whose API no longer answers. */
export const BOHR_V1_ACTION = 'bohr-io/action';

/**
 * A workflow that runs bohr v1's action (`uses: bohr-io/action@main`). Those fail on every push now, so bohr
 * removes them when it prepares the repository. bohr-io/deploy-action (v2) is not one of them.
 */
export function usesBohrV1Action(workflow: string): boolean {
  return /^\s*(?:-\s+)?uses:\s*["']?bohr-io\/action(?:@[^\s"']*)?["']?\s*(?:#.*)?$/im.test(workflow);
}

/** Where bohr.io Cloud deploys from when the instance does not say otherwise (the deploy action's default). */
export const BOHR_CLOUD_URL = 'https://app.bohr.io';

/**
 * Build variables of projects bohr hosts are repository Actions secrets named BOHR_BUILD_<NAME>. Deploy
 * workflows load every one of them, without the prefix, before installing and building; other secrets (like
 * the Cloudflare token) are not exposed to the build. Projects in their owner's account keep their build
 * variables sealed in bohr instead (deployCredentialsStep); their workflow still loads the BOHR_BUILD_ secrets
 * an earlier version wrote, until each is saved again in bohr.
 */
export const BUILD_VARIABLE_PREFIX = 'BOHR_BUILD_';

/** The workflow step that loads the build variables (lines indented for a job's steps). */
export function buildVariablesStep(indent = '      '): string[] {
  return [
    `${indent}- name: Build variables`,
    `${indent}  env:`,
    `${indent}    BOHR_SECRETS: \${{ toJSON(secrets) }}`,
    `${indent}  run: |`,
    `${indent}    node <<'NODE'`,
    `${indent}    const fs = require('node:fs');`,
    `${indent}    const { randomUUID } = require('node:crypto');`,
    `${indent}    for (const [name, value] of Object.entries(JSON.parse(process.env.BOHR_SECRETS))) {`,
    `${indent}      if (!name.startsWith('${BUILD_VARIABLE_PREFIX}')) continue;`,
    `${indent}      const end = 'EOF' + randomUUID().replaceAll('-', '');`,
    `${indent}      fs.appendFileSync(process.env.GITHUB_ENV, name.slice(${BUILD_VARIABLE_PREFIX.length}) + '<<' + end + '\\n' + value + '\\n' + end + '\\n');`,
    `${indent}    }`,
    `${indent}    NODE`,
  ];
}

/** The id of the step that asks bohr for the deploy credentials; the deploy step reads its outputs. */
export const DEPLOY_CREDENTIALS_STEP_ID = 'bohr-credentials';
/** The Actions secrets older versions of bohr kept the Cloudflare credentials in (own-account projects). */
export const LEGACY_CLOUDFLARE_SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const;

/**
 * The step that asks bohr for the deploy credentials of a project in its owner's account, with the run's
 * GitHub OIDC token (the job needs `id-token: write`). bohr answers only runs of this workflow on pushes to
 * the production branch. The build variables go to the environment of the next steps; the Cloudflare token
 * and account only to the deploy step, through the step's outputs.
 */
export function deployCredentialsStep(instanceUrl?: string, indent = '      '): string[] {
  return [
    `${indent}- name: bohr credentials`,
    `${indent}  id: ${DEPLOY_CREDENTIALS_STEP_ID}`,
    `${indent}  uses: bohr-io/deploy-action@v1`,
    `${indent}  with:`,
    `${indent}    credentials: "true"`,
    ...(instanceUrl !== undefined && instanceUrl !== BOHR_CLOUD_URL
      ? [`${indent}    instance-url: ${JSON.stringify(instanceUrl)}`]
      : []),
  ];
}

/**
 * A workflow that gets the Cloudflare credentials from bohr (deployCredentialsStep) and never from the
 * repository's secrets: the copies older versions kept there are no longer needed.
 */
export function usesDeployCredentials(workflow: string): boolean {
  return (
    /^\s*(?:-\s+)?uses:\s*["']?bohr-io\/deploy-action@[^\s"']+["']?\s*(?:#.*)?$/m.test(workflow) &&
    /^\s*credentials:\s*["']?true["']?\s*(?:#.*)?$/m.test(workflow) &&
    !/secrets\.CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)\b/.test(workflow)
  );
}

/** The plain deploy command; with it, the workflow wraps the site in bohr's protection gate. */
export const DEFAULT_DEPLOY_COMMAND = 'npx wrangler deploy';
/** The deploy message and version tag in the dashboard, so account owners can tell bohr's deploys apart. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion in the workflow, not a JS template
const BOHR_DEPLOY_FLAGS = '--message "bohr" --tag "bohr-${GITHUB_SHA::12}"';

/**
 * The deploy step to the owner's account, after deployCredentialsStep. With the default command it first
 * wraps the site in the gate that applies Basic Auth (site-gate.ts); a custom command deploys the site as it is.
 */
export function wranglerDeployStep(command: string = DEFAULT_DEPLOY_COMMAND, indent = '      '): string[] {
  // Only this step gets the Cloudflare credentials, from the outputs of deployCredentialsStep
  const outputs = `steps.${DEPLOY_CREDENTIALS_STEP_ID}.outputs`;
  const credentials = [
    `${indent}  env:`,
    `${indent}    CLOUDFLARE_API_TOKEN: \${{ ${outputs}.cloudflare-api-token }}`,
    `${indent}    CLOUDFLARE_ACCOUNT_ID: \${{ ${outputs}.cloudflare-account-id }}`,
  ];
  if (command !== DEFAULT_DEPLOY_COMMAND) {
    return [`${indent}- name: Deploy`, `${indent}  run: ${JSON.stringify(command)}`, ...credentials];
  }
  const script = gateSetupScript()
    .split('\n')
    .map((line) => (line === '' ? '' : `${indent}    ${line}`));
  return [
    `${indent}- name: Deploy`,
    `${indent}  run: |`,
    `${indent}    gate="$(node <<'NODE'`,
    ...script,
    `${indent}    NODE`,
    `${indent}    )"`,
    `${indent}    if [ -n "$gate" ]; then npx wrangler deploy --config "$gate" ${BOHR_DEPLOY_FLAGS}; else npx wrangler deploy ${BOHR_DEPLOY_FLAGS}; fi`,
    ...credentials,
  ];
}

/** Strips // and /* *\/ comments outside strings, so a wrangler.jsonc parses as JSON. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * The D1 databases of a wrangler config (parsed) whose migrations the deploy applies: the ones that declare a
 * `migrations_dir`, by binding (or database name). The workflow only gets the migrations step when there are some.
 */
export function d1MigrationBindings(config: unknown): string[] {
  const databases = (config as { d1_databases?: unknown } | null)?.d1_databases;
  if (!Array.isArray(databases)) return [];
  return databases.flatMap((database: { binding?: unknown; database_name?: unknown; migrations_dir?: unknown }) => {
    const name = typeof database?.binding === 'string' ? database.binding : database?.database_name;
    return typeof name === 'string' && name !== '' && typeof database.migrations_dir === 'string' ? [name] : [];
  });
}

/**
 * Applies the D1 migrations before the deploy (`wrangler d1 migrations apply <binding> --remote`), with the
 * same credentials: for each D1 database of the deploy folder's wrangler config that declares a `migrations_dir`
 * the repository has. D1 records the migrations it applied, so each one runs once.
 */
const D1_MIGRATIONS_SCRIPT = `const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
${JSONC_STRIP_SCRIPT}const config = ['wrangler.jsonc', 'wrangler.json'].find((file) => fs.existsSync(file));
if (!config) process.exit(0);
const settings = JSON.parse(strip(fs.readFileSync(config, 'utf8')));
for (const database of settings.d1_databases || []) {
  const name = database.binding || database.database_name;
  if (!name || !database.migrations_dir || !fs.existsSync(database.migrations_dir)) continue;
  console.log('D1 migrations of ' + name + ' (' + database.migrations_dir + ')');
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', name, '--remote'], { stdio: 'inherit' });
}`;

/** The D1 migrations step (lines indented for a job's steps), after deployCredentialsStep and the build. */
export function d1MigrationsStep(indent = '      '): string[] {
  const outputs = `steps.${DEPLOY_CREDENTIALS_STEP_ID}.outputs`;
  return [
    `${indent}- name: D1 migrations`,
    `${indent}  run: |`,
    `${indent}    node <<'NODE'`,
    ...D1_MIGRATIONS_SCRIPT.split('\n').map((line) => (line === '' ? '' : `${indent}    ${line}`)),
    `${indent}    NODE`,
    `${indent}  env:`,
    `${indent}    CLOUDFLARE_API_TOKEN: \${{ ${outputs}.cloudflare-api-token }}`,
    `${indent}    CLOUDFLARE_ACCOUNT_ID: \${{ ${outputs}.cloudflare-account-id }}`,
  ];
}

/** "wrangler" deploys to the owner's account with the credentials bohr hands the run; "bohr-cloud" to managed hosting. */
export type DeployTarget = 'wrangler' | 'bohr-cloud';

// One shell line. GitHub expressions are refused, so the commands cannot read secrets or contexts.
const command = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\r\n\0]/.test(value), 'Use a single line.')
  .refine((value) => !value.includes('${{'), 'GitHub expressions are not allowed.');

// "." or a relative path whose segments do not start with a dot (so no "..", no hidden folders)
const directory = z
  .string()
  .max(200)
  .regex(
    /^(\.|[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)$/,
    'Use a relative folder, like "." or "apps/web".',
  );

export const deployConfigSchema = z.object({
  /** Folder with the project's package.json and wrangler config, relative to the repository root. */
  directory: directory.default('.'),
  /** Node.js major version for the build. */
  node: z
    .string()
    .regex(/^\d{2}$/, 'A Node.js major version, like "24".')
    .default('24'),
  /** The package manager the commands use; pnpm and yarn come from Corepack. */
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).default('npm'),
  /** Python version, when the build needs it (Python Workers). */
  python: z
    .string()
    .regex(/^3\.\d{1,2}$/, 'A Python version, like "3.12".')
    .optional(),
  /** Installs dependencies, e.g. "npm ci". */
  install: command.optional(),
  /** Builds production, e.g. "npm run build". */
  build: command.optional(),
  /** Deploys the build to the owner's account (wrangler target only), e.g. "npx wrangler deploy". */
  deploy: command.default(DEFAULT_DEPLOY_COMMAND),
  /** Repository secrets the install and build steps need, by name (e.g. "NEXT_PUBLIC_API_KEY"). */
  secrets: z
    .array(
      z
        .string()
        .regex(/^[A-Z_][A-Z0-9_]*$/, 'Secret names use A-Z, 0-9 and _.')
        .refine((name) => !name.startsWith('GITHUB_'), 'GITHUB_ names are reserved by GitHub.')
        .refine(
          (name) => !name.startsWith('CLOUDFLARE_'),
          'The Cloudflare token and account only go to the deploy step, which bohr writes.',
        ),
    )
    .max(50)
    .default([]),
});
export type DeployConfig = z.infer<typeof deployConfigSchema>;

/** The oldest Node.js major wrangler runs on (its `engines`). */
export const WRANGLER_MIN_NODE = 22;

/** A JSON string is also a valid YAML double-quoted scalar, so values cannot break out of their line. */
const quote = (value: string) => JSON.stringify(value);

/**
 * The production deploy workflow, from a fixed template: it runs only on pushes to the production branch,
 * which only an approved merge makes, so the agent's unreviewed code never runs with the deploy credentials
 * (bohr hands them only to runs of this workflow on pushes to the production branch).
 */
export function renderDeployWorkflow(
  config: DeployConfig,
  options: {
    productionBranch: string;
    target: DeployTarget;
    instanceUrl?: string;
    /** The deploy folder's wrangler config has D1 migrations (d1MigrationBindings): applied before the deploy. */
    d1Migrations?: boolean;
  },
): string {
  const cloud = options.target === 'bohr-cloud';
  // Build secrets reach the install and build steps; the workflow only runs on approved code
  const secretEnv =
    config.secrets.length === 0
      ? []
      : ['        env:', ...[...new Set(config.secrets)].map((name) => `          ${name}: \${{ secrets.${name} }}`)];
  const lines = [
    `${DEPLOY_WORKFLOW_HEADER} Change that file instead: bohr rewrites this one.`,
    'name: bohr deploy',
    'on:',
    '  push:',
    `    branches: [${quote(options.productionBranch)}]`,
    'concurrency:',
    '  group: bohr-deploy',
    '  cancel-in-progress: false',
    'permissions:',
    '  contents: read',
    // GitHub OIDC: bohr.io Cloud deploys with it, and projects in their owner's account get their credentials
    '  id-token: write',
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 30',
    '    defaults:',
    '      run:',
    `        working-directory: ${quote(config.directory)}`,
    '    steps:',
    '      - uses: actions/checkout@v5',
    '        with:',
    '          persist-credentials: false',
  ];
  if (config.packageManager === 'bun') lines.push('      - uses: oven-sh/setup-bun@v2');
  lines.push('      - uses: actions/setup-node@v5', '        with:', `          node-version: ${quote(config.node)}`);
  if (config.python !== undefined) {
    lines.push(
      '      - uses: actions/setup-python@v6',
      '        with:',
      `          python-version: ${quote(config.python)}`,
    );
  }
  if (config.packageManager === 'pnpm' || config.packageManager === 'yarn') lines.push('      - run: corepack enable');
  lines.push(...buildVariablesStep());
  // After the BOHR_BUILD_ secrets, so the values saved in bohr win over copies left in the repository
  if (!cloud) lines.push(...deployCredentialsStep(options.instanceUrl));
  if (config.install !== undefined) {
    lines.push('      - name: Install', `        run: ${quote(config.install)}`, ...secretEnv);
  }
  if (config.build !== undefined)
    lines.push('      - name: Build', `        run: ${quote(config.build)}`, ...secretEnv);
  if (cloud) {
    lines.push(
      '      - uses: bohr-io/deploy-action@v1',
      '        with:',
      `          working-directory: ${quote(config.directory)}`,
    );
    if (options.instanceUrl !== undefined && options.instanceUrl !== BOHR_CLOUD_URL) {
      lines.push(`          instance-url: ${quote(options.instanceUrl)}`);
    }
  } else {
    // The build keeps the project's Node; wrangler needs a newer one (projects migrated from v1 build on Node 20)
    if (Number(config.node) < WRANGLER_MIN_NODE) {
      lines.push(
        '      - name: Node for the deploy',
        '        uses: actions/setup-node@v5',
        '        with:',
        `          node-version: ${quote(String(WRANGLER_MIN_NODE))}`,
      );
    }
    // Only when there are migrations: the workflows of projects without them stay as they were
    if (options.d1Migrations === true) lines.push(...d1MigrationsStep());
    lines.push(...wranglerDeployStep(config.deploy));
  }
  return `${lines.join('\n')}\n`;
}
