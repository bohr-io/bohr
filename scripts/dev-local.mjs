// Local development servers in the background (scripts/dev-local.md): the instance (wrangler dev with a local
// D1 and a simulated email service), the panel (Vite, proxying the API to the instance) and the website.
//
//   node scripts/dev-local.mjs start | stop | status | seed
//
// Logs and process ids go to BOHR_DEV_LOGS (default: <temp>/bohr-dev-local). On Windows the servers are started
// through WMI so they outlive the terminal (or agent session) that started them.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a local tool, not a turbo task
const logs = process.env.BOHR_DEV_LOGS ?? path.join(tmpdir(), 'bohr-dev-local');
const pidsFile = path.join(logs, 'pids.json');
const windows = process.platform === 'win32';
const node = process.execPath;

const PORTS = { instance: 8787, panel: 5180, site: 5181 };

const services = [
  {
    name: 'instance',
    url: `http://localhost:${PORTS.instance}/health`,
    cwd: path.join(root, 'apps/instance'),
    args: [
      path.join(root, 'apps/instance/node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '-c',
      'wrangler.local.jsonc',
      '--env-file',
      '.dev.vars.local',
      '--port',
      String(PORTS.instance),
      '--ip',
      'localhost',
    ],
  },
  {
    name: 'panel',
    url: `http://localhost:${PORTS.panel}/`,
    cwd: path.join(root, 'apps/web'),
    args: [path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), '--port', String(PORTS.panel), '--strictPort'],
  },
  {
    name: 'site',
    url: `http://localhost:${PORTS.site}/`,
    cwd: path.join(root, 'apps/site'),
    args: [path.join(root, 'apps/site/node_modules/vite/bin/vite.js'), '--port', String(PORTS.site), '--strictPort'],
  },
];

const readPids = () => {
  try {
    return JSON.parse(readFileSync(pidsFile, 'utf8'));
  } catch {
    return {};
  }
};

async function up(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

const quote = (value) => `"${value}"`;

/** Starts a command detached from this process, its output in `log`; returns the root process id. */
function launch(service, log) {
  if (windows) {
    const command = `cmd.exe /d /s /c " ${[node, ...service.args].map(quote).join(' ')} > ${quote(log)} 2>&1 "`;
    const script = `$ProgressPreference = 'SilentlyContinue'; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${command.replaceAll("'", "''")}'; CurrentDirectory = '${service.cwd.replaceAll("'", "''")}' }; $r.ProcessId`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return Number(
      execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  }
  const shell = `exec ${[node, ...service.args].map(quote).join(' ')} > ${quote(log)} 2>&1`;
  const child = spawn('sh', ['-c', shell], { cwd: service.cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

function kill(pid) {
  try {
    if (windows) execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function prepare() {
  // The instance's secrets: random ones on the first run (git ignores .dev.vars.*). Not .dev.vars, which the
  // instance's tests would load too.
  const devVars = path.join(root, 'apps/instance/.dev.vars.local');
  if (!existsSync(devVars)) {
    writeFileSync(
      devVars,
      `ADMIN_TOKEN=${randomBytes(32).toString('hex')}\nENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,
    );
    console.log('Created apps/instance/.dev.vars.local with random local secrets.');
  }
  // What `pnpm --filter @bohr/instance dev` runs first: the project Worker and the migrations, embedded
  execFileSync(node, ['scripts/embed-runtime.mjs'], { cwd: path.join(root, 'apps/instance'), stdio: 'inherit' });
}

async function start() {
  mkdirSync(logs, { recursive: true });
  prepare();
  const pids = readPids();
  for (const service of services) {
    if (await up(service.url)) {
      console.log(`${service.name}: already answering on ${new URL(service.url).origin}`);
      continue;
    }
    const log = path.join(logs, `${service.name}.log`);
    pids[service.name] = launch(service, log);
    console.log(`${service.name}: started (pid ${pids[service.name]}), log ${log}`);
  }
  writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
  // wrangler takes a few seconds; wait so `start` ends with everything answering
  for (const service of services) {
    for (let attempt = 0; attempt < 60 && !(await up(service.url)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await status();
}

function stop() {
  const pids = readPids();
  for (const [name, pid] of Object.entries(pids)) {
    console.log(`${name}: ${kill(pid) ? 'stopped' : 'not running'} (pid ${pid})`);
  }
  writeFileSync(pidsFile, '{}');
}

async function status() {
  for (const service of services) {
    console.log(
      `${service.name.padEnd(9)} ${(await up(service.url)) ? 'up  ' : 'down'}  ${new URL(service.url).origin}`,
    );
  }
  console.log(`Logs: ${logs}`);
}

const command = process.argv[2] ?? 'status';
if (command === 'start') await start();
else if (command === 'stop') stop();
else if (command === 'status') await status();
else if (command === 'seed') {
  prepare();
  execFileSync(node, ['apps/instance/scripts/seed-local.mjs'], { cwd: root, stdio: 'inherit' });
} else {
  console.error('Usage: node scripts/dev-local.mjs start | stop | status | seed');
  process.exitCode = 1;
}
