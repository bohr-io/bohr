// The demo's GitHub Actions runs (Builds): a deploy workflow per project, with jobs, steps and logs that
// look like GitHub's. A run can be in progress for a while after the dev server starts, then completes.
import type { Build, BuildJob } from '../src/api.ts';

const MINUTE = 60_000;

/** The deploy job's steps, in order. */
const STEPS = [
  'Set up job',
  'Checkout',
  'Setup pnpm',
  'Setup Node.js',
  'Install dependencies',
  'Build',
  'Deploy to Cloudflare',
  'Complete job',
] as const;

export interface DemoBuildSpec {
  /** Minutes before the dev server started. */
  minutesAgo: number;
  title: string;
  branch?: string;
  event?: string;
  /** failure: the build step fails; running: still deploying for `runningMs` after the server starts. */
  outcome: 'success' | 'failure' | 'cancelled' | 'running';
  runningMs?: number;
}

export interface DemoBuild {
  build: Omit<Build, 'status' | 'conclusion' | 'updatedAt'>;
  outcome: 'success' | 'failure' | 'cancelled';
  startedAt: number;
  /** When the run completes (in the past, except for one that is still running). */
  completesAt: number;
  worker: string;
  repository: string;
}

let nextRunId = 18_430_000_000;

/** A commit hash that looks like one, the same for the same run. */
function sha(seed: number): string {
  let value = seed % 2_147_483_647 || 1;
  let hex = '';
  // A few rounds first, so close seeds give unrelated hashes.
  for (let round = 0; round < 8; round++) value = (value * 48_271) % 2_147_483_647;
  while (hex.length < 40) {
    value = (value * 48_271) % 2_147_483_647;
    hex += value.toString(16).padStart(8, '0');
  }
  return hex.slice(0, 40);
}

export function demoBuilds(repository: string, worker: string, specs: DemoBuildSpec[]): DemoBuild[] {
  const now = Date.now();
  return specs.map((spec, index) => {
    const id = nextRunId++;
    const startedAt = now - spec.minutesAgo * MINUTE;
    const outcome = spec.outcome === 'running' ? 'success' : spec.outcome;
    const completesAt =
      spec.outcome === 'running'
        ? now + (spec.runningMs ?? 45_000)
        : startedAt + (outcome === 'failure' ? 38_000 : 72_000);
    return {
      build: {
        id,
        number: specs.length - index + 20,
        workflow: 'Deploy',
        title: spec.title,
        branch: spec.branch ?? 'main',
        commit: sha(id),
        event: spec.event ?? 'push',
        createdAt: new Date(startedAt).toISOString(),
        url: `https://github.com/${repository}/actions/runs/${id}`,
      },
      outcome,
      startedAt,
      completesAt,
      worker,
      repository,
    };
  });
}

/** The run as GitHub reports it now. */
export function buildView(run: DemoBuild): Build {
  const done = Date.now() >= run.completesAt;
  return {
    ...run.build,
    status: done ? 'completed' : 'in_progress',
    conclusion: done ? run.outcome : null,
    updatedAt: new Date(Math.min(Date.now(), run.completesAt)).toISOString(),
  };
}

/** How far the run got: the index of the step running (or failed), and whether it is over. */
function progress(run: DemoBuild): { step: number; done: boolean } {
  if (Date.now() >= run.completesAt) {
    return { step: run.outcome === 'failure' ? STEPS.indexOf('Build') : STEPS.length, done: true };
  }
  const fraction = (Date.now() - run.startedAt) / (run.completesAt - run.startedAt);
  return { step: Math.min(STEPS.length - 1, Math.floor(fraction * STEPS.length)), done: false };
}

export function buildJobs(run: DemoBuild): BuildJob[] {
  const { step: reached, done } = progress(run);
  const failed = done && run.outcome === 'failure';
  const cancelled = done && run.outcome === 'cancelled';
  const steps = STEPS.map((name, index) => {
    if (index < reached || (done && !failed && !cancelled)) {
      return { number: index + 1, name, status: 'completed', conclusion: 'success' };
    }
    if (index === reached) {
      if (failed) return { number: index + 1, name, status: 'completed', conclusion: 'failure' };
      if (cancelled) return { number: index + 1, name, status: 'completed', conclusion: 'cancelled' };
      return { number: index + 1, name, status: 'in_progress', conclusion: null };
    }
    // After a failure GitHub still runs "Complete job".
    if (done && name === 'Complete job') return { number: index + 1, name, status: 'completed', conclusion: 'success' };
    return { number: index + 1, name, status: done ? 'completed' : 'queued', conclusion: done ? 'skipped' : null };
  });
  return [
    {
      id: run.build.id + 1,
      name: 'deploy',
      status: done ? 'completed' : 'in_progress',
      conclusion: done ? run.outcome : null,
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: done ? new Date(run.completesAt).toISOString() : null,
      url: `${run.build.url}/job/${run.build.id + 1}`,
      steps,
      log: jobLog(run, done ? (failed || cancelled ? reached : STEPS.length) : reached, failed, cancelled),
    },
  ];
}

/** GitHub's log of the deploy job, up to the step reached. */
function jobLog(run: DemoBuild, reached: number, failed: boolean, cancelled: boolean): string {
  const name = run.repository.split('/')[1] ?? run.worker;
  const sections: string[][] = [
    [
      'Current runner version: 2.329.0',
      '##[group]Runner Image',
      'Image: ubuntu-24.04',
      'Version: 20261005.1',
      '##[endgroup]',
      '##[group]GITHUB_TOKEN Permissions',
      'Contents: read',
      'Metadata: read',
      '##[endgroup]',
      "Download action repository 'actions/checkout@v5'",
      "Download action repository 'pnpm/action-setup@v4'",
      "Download action repository 'actions/setup-node@v5'",
    ],
    [
      '##[group]Run actions/checkout@v5',
      'with:',
      `  repository: ${run.repository}`,
      '##[endgroup]',
      `Syncing repository: ${run.repository}`,
      '##[group]Fetching the repository',
      `[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +${run.build.commit}:refs/remotes/origin/${run.build.branch}`,
      '##[endgroup]',
      `HEAD is now at ${run.build.commit.slice(0, 7)} ${run.build.title}`,
    ],
    ['##[group]Run pnpm/action-setup@v4', '##[endgroup]', 'Installing pnpm 10.18.2', 'Done in 1.4s'],
    [
      '##[group]Run actions/setup-node@v5',
      'with:',
      '  node-version: 22',
      '  cache: pnpm',
      '##[endgroup]',
      'Found in cache @ /opt/hostedtoolcache/node/22.20.0/x64',
      'Cache restored successfully',
    ],
    [
      '##[group]Run pnpm install --frozen-lockfile',
      'pnpm install --frozen-lockfile',
      '##[endgroup]',
      'Lockfile is up to date, resolution step is skipped',
      'Progress: resolved 412, reused 398, downloaded 14, added 412, done',
      '',
      'dependencies:',
      '+ vue 3.5.43',
      '+ vue-router 5.4.0',
      '',
      'devDependencies:',
      '+ vite 8.3.4',
      '+ wrangler 4.42.0',
      '',
      'Done in 6.2s',
    ],
    failed
      ? [
          '##[group]Run pnpm build',
          'pnpm build',
          '##[endgroup]',
          '',
          `> ${name}@1.0.0 build /home/runner/work/${name}/${name}`,
          '> vue-tsc --noEmit && vite build',
          '',
          "src/components/Carrossel.vue:42:18 - error TS2339: Property 'imagem' does not exist on type 'Produto'.",
          '',
          '42       :src="produto.imagem"',
          '                    ~~~~~~',
          '',
          'Found 1 error in src/components/Carrossel.vue:42',
          '',
          ' ELIFECYCLE  Command failed with exit code 2.',
          '##[error]Process completed with exit code 2.',
        ]
      : [
          '##[group]Run pnpm build',
          'pnpm build',
          '##[endgroup]',
          '',
          `> ${name}@1.0.0 build /home/runner/work/${name}/${name}`,
          '> vue-tsc --noEmit && vite build',
          '',
          'vite v8.3.4 building for production...',
          'transforming...',
          '✓ 128 modules transformed.',
          'rendering chunks...',
          'computing gzip size...',
          'dist/index.html                   0.62 kB │ gzip:  0.38 kB',
          'dist/assets/index-4f1c2b9e.css   18.40 kB │ gzip:  4.12 kB',
          'dist/assets/index-9a8b7c6d.js   142.77 kB │ gzip: 46.90 kB',
          '✓ built in 3.41s',
        ],
    [
      '##[group]Run npx wrangler deploy',
      'npx wrangler deploy',
      '##[endgroup]',
      '',
      ' ⛅️ wrangler 4.42.0',
      '───────────────────',
      'Total Upload: 162.31 KiB / gzip: 52.04 KiB',
      `Uploaded ${run.worker} (2.31 sec)`,
      `Deployed ${run.worker} triggers (0.84 sec)`,
      `  https://${run.worker}.ana-souza.workers.dev`,
      `Current Version ID: ${run.build.commit.slice(0, 8)}-${run.build.commit.slice(8, 12)}-4a2b-9c1d-${run.build.commit.slice(12, 24)}`,
    ],
    ['Post job cleanup.', 'Cleaning up orphan processes'],
  ];
  const lines = sections.slice(0, Math.min(sections.length, reached + 1)).flat();
  if (cancelled) lines.push('##[error]The operation was canceled.');
  // GitHub puts a timestamp on every line, a little after the run started.
  return lines
    .map(
      (line, index) => `${new Date(run.startedAt + 2_000 + index * 180).toISOString().replace('Z', '0000Z')} ${line}`,
    )
    .join('\n');
}

/** Ana's projects' runs. */
export const DEMO_BUILDS = {
  loja: (): DemoBuild[] =>
    demoBuilds('anasouza/loja-aurora', 'loja-aurora', [
      {
        minutesAgo: 1,
        title: 'Rodapé novo com os links das redes sociais (#41)',
        outcome: 'running',
        runningMs: 50_000,
      },
      { minutesAgo: 2 * 24 * 60, title: 'Página de trocas e devoluções (#38)', outcome: 'success' },
      {
        minutesAgo: 2 * 24 * 60 + 40,
        title: 'Ajusta o texto da página de trocas',
        branch: 'homologacao',
        outcome: 'success',
      },
      { minutesAgo: 5 * 24 * 60, title: 'Carrossel de produtos em destaque (#35)', outcome: 'failure' },
      {
        minutesAgo: 5 * 24 * 60 + 15,
        title: 'Carrossel de produtos em destaque',
        branch: 'homologacao',
        outcome: 'cancelled',
      },
      { minutesAgo: 12 * 24 * 60, title: 'Formulário de newsletter na página inicial (#31)', outcome: 'success' },
    ]),
  portfolio: (): DemoBuild[] =>
    demoBuilds('anasouza/portfolio', 'portfolio-ana', [
      { minutesAgo: 30 * 24 * 60, title: 'Atualiza a lista de trabalhos', branch: 'master', outcome: 'success' },
      { minutesAgo: 90 * 24 * 60, title: 'Novo layout da página inicial', branch: 'master', outcome: 'success' },
    ]),
};
