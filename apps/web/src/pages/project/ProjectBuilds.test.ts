import { useToast } from '@bohr/ui';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Build, BuildJob, CliDeploy } from '../../api';
import { loadSession } from '../../session';
import { type FakeRoute, fakeApi, ME, mountAt, projectState, projectSummary } from '../../test-utils';

const P = '/api/projects/p1';

function build(overrides: Partial<Build> = {}): Build {
  return {
    id: 101,
    number: 7,
    workflow: 'Deploy',
    title: 'Botão verde no carrinho',
    branch: 'main',
    commit: 'abc1234def5678',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    url: 'https://github.com/acme/loja/actions/runs/101',
    ...overrides,
  };
}

const JOB: BuildJob = {
  id: 9001,
  name: 'deploy',
  status: 'completed',
  conclusion: 'failure',
  startedAt: '2026-10-11T12:00:00Z',
  completedAt: '2026-10-11T12:01:05Z',
  url: 'https://github.com/acme/loja/actions/runs/102/job/9001',
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
    { number: 2, name: 'Build', status: 'completed', conclusion: 'failure' },
  ],
  log: [
    '2026-10-11T12:00:01.0000000Z ##[group]Run pnpm build',
    '2026-10-11T12:00:02.0000000Z pnpm build',
    '2026-10-11T12:00:03.0000000Z ##[endgroup]',
    '2026-10-11T12:00:04.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n'),
};

async function mountBuilds(routes: Record<string, FakeRoute | FakeRoute[]>, path = '/projects/p1/builds') {
  const api = fakeApi({
    'GET /api/me': { body: ME },
    'GET /api/projects': { body: { projects: [projectSummary()] } },
    [`GET ${P}/agent/state`]: { body: projectState() },
    [`GET ${P}/agent/messages`]: { body: { messages: [], last: 0 } },
    [`GET ${P}/cli-deploys`]: { body: { deploys: [] } },
    ...routes,
  });
  await loadSession(true);
  const mounted = await mountAt(path);
  return { ...mounted, api };
}

describe('project builds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToast().clear();
    document.body.innerHTML = '';
  });

  it('lists the runs and opens one with its jobs, steps and log', async () => {
    const { wrapper, api, router, missing } = await mountBuilds({
      [`GET ${P}/builds`]: {
        body: {
          builds: [build({ id: 102, number: 8, title: 'Filtro por tamanho', conclusion: 'failure' }), build()],
        },
      },
      [`GET ${P}/builds/102`]: { body: { jobs: [JOB] } },
    });

    expect(wrapper.get('.project-nav [aria-current="page"]').text()).toBe('Builds');
    const runs = wrapper.findAll('[data-run]');
    expect(runs).toHaveLength(2);
    expect(runs[0]?.text()).toContain('#8 Filtro por tamanho');
    expect(runs[0]?.text()).toContain('Falhou');
    expect(runs[0]?.text()).toContain('abc1234');
    expect(runs[0]?.text()).not.toContain('abc1234d');
    expect(runs[0]?.text()).toContain('main');
    expect(runs[0]?.text()).toContain('há 5 minutos');
    expect(runs[1]?.text()).toContain('Sucesso');
    expect(runs[1]?.get('a[href="https://github.com/acme/loja/actions/runs/101"]').attributes('target')).toBe('_blank');

    await runs[0]?.get('.run__title').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ run: '102' }), { timeout: 10_000 });
    await flushPromises();

    expect(api.callsTo(`GET ${P}/builds/102`)).toHaveLength(1);
    const job = wrapper.get('[data-job="9001"]');
    // A failed job opens by itself.
    expect(job.attributes('open')).toBeDefined();
    expect(job.text()).toContain('1m 5s');
    expect(job.findAll('.job__step').map((step) => step.text())).toEqual(['Set up job', 'Build']);
    const log = job.get('pre.build-log');
    expect(log.text()).toContain('Run pnpm build');
    expect(log.text()).not.toContain('2026-10-11T12:00');
    expect(log.get('.is-error').text()).toBe('Process completed with exit code 1.');

    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Atualizar')
      ?.trigger('click');
    await flushPromises();
    expect(api.callsTo(`GET ${P}/builds/102`)).toHaveLength(2);
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('refreshes a run by itself while it is in progress', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = build({ id: 103, status: 'in_progress', conclusion: null });
      const { wrapper, api } = await mountBuilds(
        {
          [`GET ${P}/builds`]: [{ body: { builds: [running] } }, { body: { builds: [build({ id: 103 })] } }],
          [`GET ${P}/builds/103`]: { body: { jobs: [{ ...JOB, status: 'in_progress', conclusion: null }] } },
        },
        '/projects/p1/builds?run=103',
      );
      await flushPromises();
      expect(wrapper.text()).toContain('Em andamento: esta página se atualiza sozinha.');
      expect(api.callsTo(`GET ${P}/builds/103`)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await flushPromises();

      expect(api.callsTo(`GET ${P}/builds/103`)).toHaveLength(2);
      // Completed now: no more refreshes.
      expect(wrapper.text()).not.toContain('Em andamento');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(api.callsTo(`GET ${P}/builds/103`)).toHaveLength(2);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists what the CLI deployed in the owner's account, apart from the GitHub runs", async () => {
    const deploy = (overrides: Partial<CliDeploy>): CliDeploy => ({
      id: 'cd_1',
      branch: 'feature/frete',
      production: false,
      workerName: 'loja',
      versionId: '5f0c1a2e-7b1d-4c3e-9f20-1a2b3c4d5e6f',
      url: 'https://feature-frete-loja.acme.workers.dev',
      commitSha: 'def5678abc1234def5678abc1234def5678abc12',
      userId: 'u1',
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      ...overrides,
    });
    const { wrapper, api, missing } = await mountBuilds({
      [`GET ${P}/builds`]: { body: { builds: [build()] } },
      [`GET ${P}/cli-deploys`]: {
        body: {
          deploys: [
            deploy({}),
            deploy({ id: 'cd_2', branch: 'main', production: true, url: 'https://loja.example.com', commitSha: null }),
          ],
        },
      },
    });
    await flushPromises();

    expect(wrapper.findAll('[data-run]')).toHaveLength(1);
    const card = wrapper.get('[data-view="cli"]');
    expect(card.text()).toContain('Deploys pela CLI');
    const rows = card.findAll('[data-cli-deploy]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain('CLI');
    expect(rows[0]?.text()).toContain('feature/frete');
    expect(rows[0]?.get('[data-target]').text()).toBe('Homologação');
    expect(rows[0]?.text()).toContain('def5678');
    expect(rows[0]?.text()).not.toContain('def5678a');
    expect(rows[0]?.text()).toContain('há 10 minutos');
    const link = rows[0]?.get('a[href="https://feature-frete-loja.acme.workers.dev"]');
    expect(link?.text()).toBe('feature-frete-loja.acme.workers.dev');
    expect(link?.attributes('target')).toBe('_blank');
    expect(rows[1]?.get('[data-target]').text()).toBe('Produção');
    expect(rows[1]?.text()).toContain('Alterações sem commit');

    // Refresh reads both lists again
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Atualizar')
      ?.trigger('click');
    await flushPromises();
    expect(api.callsTo(`GET ${P}/cli-deploys`)).toHaveLength(2);
    expect(missing).toEqual([]);
    wrapper.unmount();
  });

  it('does not ask for CLI deploys of a project bohr hosts, and hides the section without any', async () => {
    const hosted = await mountBuilds({
      'GET /api/projects': { body: { projects: [projectSummary({ mode: 'managed' })] } },
      [`GET ${P}/builds`]: { body: { builds: [build()] } },
    });
    await flushPromises();
    expect(hosted.api.callsTo(`GET ${P}/cli-deploys`)).toHaveLength(0);
    expect(hosted.wrapper.find('[data-view="cli"]').exists()).toBe(false);
    hosted.wrapper.unmount();

    const none = await mountBuilds({ [`GET ${P}/builds`]: { body: { builds: [build()] } } });
    await flushPromises();
    expect(none.api.callsTo(`GET ${P}/cli-deploys`)).toHaveLength(1);
    expect(none.wrapper.find('[data-view="cli"]').exists()).toBe(false);
    none.wrapper.unmount();
  });

  it('says when there are no builds yet, and what went wrong reading them', async () => {
    const empty = await mountBuilds({ [`GET ${P}/builds`]: { body: { builds: [] } } });
    expect(empty.wrapper.get('[data-empty]').text()).toContain('Nenhum build ainda');
    empty.wrapper.unmount();

    const failing = await mountBuilds({
      [`GET ${P}/builds`]: { status: 502, body: { error: 'GitHub did not answer.' } },
    });
    expect(failing.wrapper.text()).toContain('GitHub did not answer.');
    failing.wrapper.unmount();
  });
});
