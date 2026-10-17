// Release smoke test: a real deploy of a test project with an API token, through the published package, before
// the "latest" dist-tag moves to it (CONTRIBUTING.md, "Releasing the CLI and the deploy action").
//
//   BOHR_TOKEN=bohr_… BOHR_SMOKE_PROJECT=p… node packages/cli/scripts/smoke-test.mjs [package spec]
//
// The package spec defaults to "bohr@next" (the release candidate); "local" runs packages/cli/dist/bohr.mjs, and a
// version ("bohr@4.0.0") or a tarball path works too. BOHR_INSTANCE_URL picks the instance (default app.bohr.io).
// The project must be one bohr hosts (managed) that the token reaches; the script deploys a throwaway page to its
// "bohr-smoke-test" branch, never production, and checks it is served and that .env files are not.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spec = process.argv[2] ?? 'bohr@next';
const projectId = process.env.BOHR_SMOKE_PROJECT;
const branch = 'bohr-smoke-test';
if (!process.env.BOHR_TOKEN || !projectId) {
  console.error('Set BOHR_TOKEN (a token from the panel, Account › Tokens) and BOHR_SMOKE_PROJECT (a project id).');
  process.exit(2);
}

/** Runs the CLI under test; resolves with its exit code and output. */
function bohr(args, cwd) {
  const local = fileURLToPath(new URL('../dist/bohr.mjs', import.meta.url));
  const [command, commandArgs] =
    spec === 'local' ? [process.execPath, [local, ...args]] : ['npx', ['--yes', '--package', spec, 'bohr', ...args]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, shell: process.platform === 'win32' && spec !== 'local' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`);
  if (!ok) failures++;
}

const json = (run) => {
  try {
    return JSON.parse(run.stdout);
  } catch {
    return null;
  }
};

const work = await mkdtemp(join(tmpdir(), 'bohr-smoke-'));
try {
  const version = await bohr(['--version'], work);
  check(`${spec} runs (version ${version.stdout.trim()})`, version.code === 0, version.stderr);

  const me = json(await bohr(['whoami', '--json'], work));
  check('whoami: the token is valid', me?.ok === true, JSON.stringify(me));

  const list = json(await bohr(['projects', '--json'], work));
  const project = list?.projects?.find((entry) => entry.id === projectId);
  check(`projects: the token reaches ${projectId}`, project !== undefined, JSON.stringify(list));
  check('the project is one bohr hosts', project?.mode === 'managed', `mode: ${project?.mode}`);

  // A bohr v1 repository: the CLI stops before calling anyone
  const v1 = join(work, 'v1');
  await mkdir(join(v1, '.github', 'workflows'), { recursive: true });
  await writeFile(join(v1, '.github', 'workflows', 'bohr.yml'), 'steps:\n  - uses: bohr-io/action@main\n');
  const refused = await bohr(['deploy', '--json'], v1);
  check(
    'a bohr v1 repository is refused (exit 4, not_a_v2_project)',
    refused.code === 4 && json(refused)?.error?.code === 'not_a_v2_project',
    refused.stdout,
  );

  // A real deploy of a throwaway page to the smoke-test branch
  const nonce = randomUUID();
  const site = join(work, 'site');
  await mkdir(join(site, 'public'), { recursive: true });
  await writeFile(
    join(site, 'wrangler.jsonc'),
    JSON.stringify({ name: 'bohr-smoke-test', compatibility_date: '2026-10-01', assets: { directory: 'public' } }),
  );
  await writeFile(join(site, 'public', 'index.html'), `<!doctype html><title>bohr smoke test</title><p>${nonce}</p>\n`);
  await writeFile(join(site, 'public', '.env'), 'SMOKE_SECRET=must-not-be-published\n');
  const deployed = await bohr(['deploy', '--project', projectId, '--branch', branch, '--no-build', '--json'], site);
  const result = json(deployed);
  check(
    'deploy: a preview of the smoke-test branch',
    deployed.code === 0 && result?.ok === true,
    `${deployed.stdout}\n${deployed.stderr}`,
  );
  check('deploy: never production', result?.production === false && result?.branch === branch, JSON.stringify(result));

  if (result?.url) {
    let served = false;
    for (let attempt = 0; attempt < 30 && !served; attempt++) {
      const page = await fetch(result.url, { headers: { 'Cache-Control': 'no-cache' } }).catch(() => null);
      served = page?.ok === true && (await page.text()).includes(nonce);
      if (!served) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    check(`${result.url} serves the new page`, served);
    const env = await fetch(`${result.url}/.env`).catch(() => null);
    check('.env is not served', env !== null && env.status === 404, `HTTP ${env?.status}`);

    const opened = json(await bohr(['open', '--project', projectId, '--branch', branch, '--print', '--json'], site));
    check('open: prints the same URL', opened?.url === result.url, JSON.stringify(opened));
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSmoke test passed.' : `\n${failures} check(s) failed: do not move the dist-tag.`);
process.exit(failures === 0 ? 0 : 1);
