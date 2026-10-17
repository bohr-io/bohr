import { deployConfigSchema, renderDeployWorkflow } from '@bohr/shared';
import { describe, expect, it } from 'vitest';
import { eventually, finished, GUEST, OWNER, restarts, setup, sha } from './helpers';

describe('project bot', () => {
  it('rejects webhooks without the secret', async () => {
    const { webhook } = setup();
    const response = await webhook({ message: undefined }, 'wrong-secret');
    expect(response.status).toBe(401);
  });

  it('tells people without access how to join, and sets the command menu once', async () => {
    const { say, network } = setup();
    expect((await say(GUEST, 'oi')).status).toBe(200);
    expect(network.sent().at(-1)?.body.text).toContain('Peça um convite ao dono e mande /entrar');
    expect(network.sent('setMyCommands')).toHaveLength(3);
    await say(GUEST, 'oi de novo');
    expect(network.sent('setMyCommands')).toHaveLength(3);
  });

  it('runs a request: queue, agent job, progress, preview and decision buttons', async () => {
    const { say, alarm, container, network, stub, inside } = setup();
    await say(OWNER, 'Troca a cor do botão Comprar para verde');
    expect(network.sent().at(-1)?.body.text).toBe('⏳ Trabalhando no seu pedido…');

    await alarm();
    expect(container.starts).toBe(1);
    const job = container.jobs[0];
    expect(job).toMatchObject({
      kind: 'change',
      prompt: 'Troca a cor do botão Comprar para verde',
      repo: { owner: 'acme', name: 'store', baseBranch: 'main', workBranch: 'homolog' },
      author: { name: 'Ana (via bohr)', email: 'noreply@bohr.io' },
      model: 'claude-opus-5-5',
      maxBudgetUsd: 5,
      locale: 'pt-BR',
      allowWorkflowEdits: false,
      auth: 'api_key',
      context: { projectName: 'Loja Aurora', requesterName: 'Ana' },
    });
    expect(job?.resumeSessionId).toBeUndefined();
    const jobId = job?.jobId ?? '';
    const at = new Date().toISOString();

    await stub.agentEvents([
      { type: 'job.started', jobId, seq: 1, at, sessionId: 'session-1' },
      { type: 'job.progress', jobId, seq: 2, at, text: 'Editando src/Checkout.vue' },
    ]);
    expect(network.sent('editMessageText').at(-1)?.body.text).toBe('⏳ Editando src/Checkout.vue');

    await stub.agentEvents([finished(jobId, 3)]);
    const edit = network.sent('editMessageText').at(-1)?.body;
    expect(edit?.text).toContain('✅ Pronto!');
    expect(edit?.text).toContain('A mudança já está na homologação.');
    // Neither the cost nor the preview's address in the chat: a button opens the preview
    expect(edit?.text).not.toContain('US$');
    expect(edit?.text).not.toContain('workers.dev');
    expect(JSON.stringify(edit?.reply_markup)).toContain('approve:1');
    expect(JSON.stringify(edit?.reply_markup)).toContain(
      '{"text":"🔎 Ver a homologação","url":"https://bohr-preview-x7k2.acme.workers.dev"}',
    );

    await inside((project) => {
      expect(project.homolog()).toMatchObject({ status: 'pending', version: 1, headSha: sha('b') });
      expect(project.store.get('last_session_id')).toBe('session-1');
    });
  });

  it("runs the agent on the owner's Claude subscription when that is the provider", async () => {
    const { say, alarm, container, inside } = setup();
    await inside((project) => {
      // The instance writes AGENT_PROVIDER as a secret; this Durable Object gets it here instead
      const env = (project as unknown as { env: Record<string, unknown> }).env;
      Object.defineProperty(project, 'env', {
        value: { ...env, AGENT_PROVIDER: 'subscription', AGENT_BASE_URL: 'https://llm.example.com/anthropic' },
      });
    });
    await say(OWNER, 'Troca a cor do botão');
    await alarm();
    expect(container.jobs[0]).toMatchObject({ auth: 'oauth', model: 'claude-opus-5-5' });
    // The subscription only works with Anthropic: no compatible endpoint
    expect(container.jobs[0]?.baseUrl).toBeUndefined();
  });

  it('continues the agent session for the next request in the same preview cycle', async () => {
    const { say, alarm, container, stub } = setup();
    await say(OWNER, 'Botão verde');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };

    await say(OWNER, 'Agora maior');
    await alarm();
    expect(container.jobs[1]?.resumeSessionId).toBe('session-1');
  });

  it('queues requests and starts the next one when the current finishes', async () => {
    const { say, alarm, container, stub, network } = setup();
    await say(OWNER, 'Primeiro pedido');
    await alarm();
    await say(OWNER, 'Segundo pedido');
    expect(network.sent().at(-1)?.body.text).toBe('Anotado. Seu pedido é o 2º da fila.');
    await alarm();
    expect(container.jobs).toHaveLength(1);

    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1, { headSha: undefined, commits: [] })]);
    expect(network.texts().at(-1)).toContain('Nada mudou na homologação');
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await alarm();
    expect(container.jobs.map((job) => job.prompt)).toEqual(['Primeiro pedido', 'Segundo pedido']);
  });

  it('retries later when the runner is still busy with an untracked job', async () => {
    const { say, alarm, container, inside } = setup();
    container.busyOnce = true;
    container.health = { ok: true, version: 'test', busy: true, jobId: 'req_stale_job_000', lastSeq: 0 };
    await say(OWNER, 'Pedido');
    await alarm();
    expect(container.cancelled).toEqual(['req_stale_job_000']);
    await inside((project) => expect(project.store.queued()).toHaveLength(1));
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 0 };
    await alarm();
    expect(container.jobs).toHaveLength(1);
  });

  it('fails a request whose agent stops answering', async () => {
    const { say, alarm, container, network, inside } = setup();
    await say(OWNER, 'Pedido');
    await alarm();
    container.health = null;
    await alarm();
    await alarm();
    await inside((project) => expect(project.store.running()).not.toBeNull());
    await alarm();
    await inside((project) => expect(project.store.running()).toBeNull());
    expect(network.texts().at(-1)).toContain('o agente parou de responder');
  });

  it('recovers events the runner could not push', async () => {
    const { say, alarm, container, inside } = setup();
    await say(OWNER, 'Pedido');
    await alarm();
    const jobId = container.jobs[0]?.jobId ?? '';
    container.pendingEvents = [finished(jobId, 4)];
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 4 };
    await alarm();
    await inside((project) => expect(project.store.request(jobId)?.status).toBe('succeeded'));
  });

  it('asks the question the agent raised and resumes the session with the chosen option', async () => {
    const { say, tap, alarm, container, stub, network } = setup();
    await say(OWNER, 'Adiciona um meio de pagamento');
    await alarm();
    const jobId = container.jobs[0]?.jobId ?? '';
    await stub.agentEvents([
      finished(jobId, 1, {
        outcome: 'needs_input',
        headSha: undefined,
        commits: [],
        sessionId: 'session-q',
        question: { text: 'Qual meio de pagamento?', options: ['Pix', 'Boleto'] },
      }),
    ]);
    const asked = network.sent('editMessageText').at(-1)?.body;
    expect(asked?.text).toContain('Qual meio de pagamento?');
    expect(JSON.stringify(asked?.reply_markup)).toContain(`answer:${jobId}:0`);

    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await tap(OWNER, `answer:${jobId}:0`);
    await alarm();
    expect(container.jobs[1]).toMatchObject({ prompt: 'Pix', resumeSessionId: 'session-q' });
  });

  it('cancels a queued request', async () => {
    const { say, alarm, inside, network } = setup();
    await say(OWNER, 'Primeiro');
    await alarm();
    await say(OWNER, 'Segundo');
    await say(OWNER, '/cancelar');
    expect(network.texts().at(-1)).toBe('Pedido cancelado.');
    await inside((project) => {
      expect(project.store.queued()).toHaveLength(0);
      expect(project.store.running()).not.toBeNull();
    });
  });
});

describe('limits', () => {
  it('limits how many requests one member can leave in the queue', async () => {
    const { say, alarm, network, inside } = setup();
    await say(OWNER, 'Pedido 0');
    await alarm();
    for (let index = 1; index <= 5; index++) await say(OWNER, `Pedido ${index}`);
    await say(OWNER, 'Pedido 6');
    expect(network.sent().at(-1)?.body.text).toBe(
      'Você já tem 5 pedidos na fila. Espere um deles terminar ou cancele com /cancelar.',
    );
    expect(await inside((project) => project.store.queued().length)).toBe(5);
  });
});

describe('decisions', () => {
  async function pendingPreview() {
    const context = setup();
    await context.say(OWNER, 'Botão verde');
    await context.alarm();
    await context.stub.agentEvents([finished(context.container.jobs[0]?.jobId ?? '', 1)]);
    context.container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    return context;
  }

  it('writes the deploy workflow from .bohr/deploy.json and pins the decision to the head GitHub has', async () => {
    const { say, alarm, container, stub, repo, network, inside, tap } = setup();
    repo.files.set('.bohr/deploy.json', JSON.stringify({ install: 'npm ci', build: 'npm run build' }));
    await say(OWNER, 'Prepara o deploy');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);

    const write = repo.calls.find((call) => call.method === 'writeFile')?.args[0] as {
      path: string;
      branch: string;
      content: string;
    };
    expect(write).toMatchObject({ path: '.github/workflows/bohr-deploy.yml', branch: 'homolog' });
    expect(write.content).toContain('branches: ["main"]');
    expect(write.content).toContain('run: "npm run build"');
    // The Worker's commit is on top of the agent's: the decision pins the branch head GitHub reports
    await inside((project) => expect(project.homolog()).toMatchObject({ status: 'pending', headSha: sha('f') }));
    const markup = JSON.stringify(network.sent('editMessageText').at(-1)?.body.reply_markup);
    expect(markup).toContain(`https://github.com/acme/store/compare/main...${sha('f')}`);

    // The same configuration again: nothing to write
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await say(OWNER, 'Outro ajuste');
    await alarm();
    repo.branches.set('homolog', sha('c'));
    const second = container.jobs[1]?.jobId ?? '';
    await stub.agentEvents([finished(second, 2, { headSha: sha('c'), commits: [{ sha: sha('c'), title: 'Ajuste' }] })]);
    expect(repo.calls.filter((call) => call.method === 'writeFile')).toHaveLength(1);

    await tap(OWNER, 'approve:2');
    await eventually(() => inside((project) => project.homolog().status === 'clean'));
    expect(repo.calls.find((call) => call.method === 'mergePullRequest')?.args[1]).toMatchObject({ sha: sha('c') });
  });

  it('rewrites a workflow an older bohr wrote, so production asks bohr for the Cloudflare credentials', async () => {
    const { say, alarm, container, stub, repo } = setup();
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'npm run build' }));
    const older = renderDeployWorkflow(deployConfigSchema.parse({ build: 'npm run build' }), {
      productionBranch: 'main',
      target: 'wrangler',
    })
      .replace(/^ {6}- name: bohr credentials\n(?: {8}.*\n)+/m, '')
      .replaceAll('steps.bohr-credentials.outputs.cloudflare-api-token', 'secrets.CLOUDFLARE_API_TOKEN')
      .replaceAll('steps.bohr-credentials.outputs.cloudflare-account-id', 'secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(older).not.toContain('bohr credentials');
    repo.files.set('.github/workflows/bohr-deploy.yml', older);
    await say(OWNER, 'Ajuste');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    const write = repo.calls.find((call) => call.method === 'writeFile')?.args[0] as { content: string };
    expect(write.content).toContain('credentials: "true"');
    expect(write.content).toContain('id-token: write');
    expect(write.content).not.toContain('secrets.CLOUDFLARE');
  });

  it('applies the D1 migrations before the deploy only when the wrangler config declares some', async () => {
    const { say, alarm, container, stub, repo } = setup();
    repo.files.set('.bohr/deploy.json', JSON.stringify({ directory: 'site', build: 'npm run build' }));
    repo.files.set(
      'site/wrangler.jsonc',
      '// The site\n{ "name": "loja", "d1_databases": [{ "binding": "DB", "database_name": "loja-db", "migrations_dir": "migrations" }] }',
    );
    await say(OWNER, 'Ajuste');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    const write = repo.calls.find((call) => call.method === 'writeFile')?.args[0] as { content: string };
    expect(write.content).toContain('- name: D1 migrations');
    expect(write.content.indexOf('D1 migrations')).toBeLessThan(write.content.indexOf('- name: Deploy'));

    // A database without migrations (or none at all) leaves the workflow as other projects have it
    const plain = setup();
    plain.repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'npm run build' }));
    plain.repo.files.set('wrangler.jsonc', '{ "name": "loja", "d1_databases": [{ "binding": "DB" }] }');
    await plain.say(OWNER, 'Ajuste');
    await plain.alarm();
    await plain.stub.agentEvents([finished(plain.container.jobs[0]?.jobId ?? '', 1)]);
    const written = plain.repo.calls.find((call) => call.method === 'writeFile')?.args[0] as { content: string };
    expect(written.content).toBe(
      renderDeployWorkflow(deployConfigSchema.parse({ build: 'npm run build' }), {
        productionBranch: 'main',
        target: 'wrangler',
        instanceUrl: written.content.match(/instance-url: "([^"]+)"/)?.[1],
      }),
    );
  });

  it('leaves a deploy workflow that bohr did not write as it is', async () => {
    const { say, alarm, container, stub, repo } = setup();
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'npm run build' }));
    repo.files.set('.github/workflows/bohr-deploy.yml', '# Generated by the bohr v2 migration.\nname: Deploy\n');
    await say(OWNER, 'Ajuste');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    expect(repo.calls.some((call) => call.method === 'writeFile')).toBe(false);
  });

  it('tells the user when .bohr/deploy.json is invalid and leaves the workflow alone', async () => {
    const { say, alarm, container, stub, repo, network } = setup();
    const expression = ['echo $', '{{ secrets.CLOUDFLARE_API_TOKEN }}'].join('');
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: expression }));
    await say(OWNER, 'Prepara o deploy');
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    expect(repo.calls.some((call) => call.method === 'writeFile')).toBe(false);
    const text = String(network.sent('editMessageText').at(-1)?.body.text);
    expect(text).toContain('O arquivo .bohr/deploy.json tem um problema (build: GitHub expressions are not allowed.)');
  });

  it('waits for a rollback before deciding on the preview', async () => {
    const { tap, inside, network } = await pendingPreview();
    await inside((project) => project.store.set('rollback_in_progress', 1));
    await tap(OWNER, 'approve:1');
    expect(network.sent('answerCallbackQuery').at(-1)?.body.text).toBe('Já estou publicando a homologação.');
    expect(await inside((project) => project.homolog().status)).toBe('pending');
  });

  it('publishes the reviewed version: pull request, merge at that commit, preview reset, release tracked', async () => {
    const { tap, repo, inside, alarm, network } = await pendingPreview();
    await tap(OWNER, 'approve:1');
    expect(network.sent('answerCallbackQuery').at(-1)?.body.text).toContain('Ana aprovou');

    await eventually(() => inside((project) => project.homolog().status === 'clean'));
    const merge = repo.calls.find((call) => call.method === 'mergePullRequest');
    expect(repo.calls.find((call) => call.method === 'openPullRequest')?.args[0]).toMatchObject({
      head: 'homolog',
      base: 'main',
      title: 'O botão Comprar agora é verde',
    });
    expect(merge?.args).toEqual([42, { sha: sha('b'), title: 'O botão Comprar agora é verde (#42)' }]);
    expect(repo.calls.find((call) => call.method === 'resetBranch')?.args).toEqual(['homolog', sha('2')]);
    expect(network.texts()).toContain('🚀 PR #42 mesclado. O GitHub Actions está publicando…');
    await inside((project) => {
      expect(project.homolog()).toMatchObject({ version: 2, cycle: 2, headSha: sha('2') });
      expect(project.store.get('last_session_id')).toBeNull();
      expect(project.store.releases()[0]).toMatchObject({ status: 'deploying', pull_request: 42 });
    });

    repo.run = { status: 'completed', conclusion: 'success', url: 'https://github.com/acme/store/actions/runs/1' };
    await alarm();
    await inside((project) => expect(project.store.releases()[0]?.status).toBe('live'));
    expect(network.texts().at(-1)).toBe('✅ Produção atualizada: https://store.example.com.');
  });

  it('offers a pending preview to whoever opens the bot after it finished', async () => {
    const { say, network } = await pendingPreview();
    await say(OWNER, '/start', 777);
    const offer = network.sent().at(-1)?.body;
    expect(offer?.chat_id).toBe(777);
    expect(offer?.text).toContain('Há mudanças na homologação esperando a sua decisão');
    expect(offer?.text).toContain('O botão Comprar agora é verde');
    expect(offer?.text).not.toContain('workers.dev');
    expect(JSON.stringify(offer?.reply_markup)).toContain('approve:1');
    // The older decision message loses its buttons
    expect(network.sent('editMessageReplyMarkup')).toHaveLength(1);
  });

  it('refuses stale versions and keeps the preview when the merge fails', async () => {
    const { tap, repo, inside, network } = await pendingPreview();
    await tap(OWNER, 'approve:0');
    expect(network.sent('answerCallbackQuery').at(-1)?.body.text).toContain('A homologação mudou');

    repo.mergeError = new Error('the pull request cannot be merged (conflict or checks)');
    await tap(OWNER, 'approve:1');
    await eventually(() => inside((project) => project.homolog().status === 'pending'));
    expect(network.texts().at(-1)).toContain('Não consegui mesclar o PR');
    await inside((project) => expect(project.homolog().version).toBe(1));
  });

  it('answers a typed decision with the buttons, then discards the preview back to production', async () => {
    const { say, tap, repo, inside, network } = await pendingPreview();
    await say(OWNER, '/descartar');
    // Typing does not say which version was reviewed: the bot shows the current one and waits for a button
    const offer = network.sent().at(-1);
    expect(JSON.stringify(offer?.body.reply_markup)).toContain('discard:1');
    expect(await inside((project) => project.homolog().status)).toBe('pending');
    expect(repo.calls.some((call) => call.method === 'resetBranch')).toBe(false);

    await tap(OWNER, 'discard:1');
    await eventually(() => inside((project) => project.homolog().status === 'clean'));
    expect(repo.calls.find((call) => call.method === 'resetBranch')?.args).toEqual(['homolog', sha('a')]);
    expect(network.texts().some((text) => text.includes('descartou as mudanças'))).toBe(true);
  });

  it('forgets the preparation a discard took away, so the next request prepares the repository again', async () => {
    const unprepared = await pendingPreview();
    await unprepared.inside((project) => project.store.set('imported', 1));
    await unprepared.tap(OWNER, 'discard:1');
    await eventually(() => unprepared.inside((project) => project.homolog().status === 'clean'));
    // Production has neither .bohr/preview.json nor .bohr/deploy.json: the preparation was only on the preview
    expect(await unprepared.inside((project) => project.store.get('imported'))).toBeNull();

    const prepared = await pendingPreview();
    prepared.repo.files.set('.bohr/preview.json', '{}');
    prepared.repo.files.set('.bohr/deploy.json', '{}');
    await prepared.inside((project) => project.store.set('imported', 1));
    await prepared.tap(OWNER, 'discard:1');
    await eventually(() => prepared.inside((project) => project.homolog().status === 'clean'));
    expect(await prepared.inside((project) => project.store.get('imported'))).toBe('1');
  });

  it('rolls back the last release with a revert pull request', async () => {
    const { tap, say, repo, inside, network } = await pendingPreview();
    await tap(OWNER, 'approve:1');
    await eventually(() => inside((project) => project.homolog().status === 'clean'));

    await say(OWNER, '/rollback');
    await eventually(() => inside((project) => project.store.releases()[0]?.pull_request === 43));
    expect(repo.calls.find((call) => call.method === 'revertPullRequest')?.args[0]).toBe('PR_42');
    await inside((project) => {
      expect(project.store.releases().map((release) => release.status)).toEqual(['deploying', 'rolled_back']);
    });
    expect(network.texts().some((text) => text.includes('Revertido pelo PR #43'))).toBe(true);
  });
});

describe('members', () => {
  it('invites with a single-use code, lists and revokes members', async () => {
    const { say, network, inside } = setup();
    await say(OWNER, '/convidar');
    const invite = network.texts().at(-1) ?? '';
    const code = /Convite: ([0-9A-Z]{4}-[0-9A-Z]{4})/.exec(invite)?.[1] ?? '';
    expect(invite).toContain('@loja_aurora_bot');

    await say(GUEST, `/entrar ${code.toLowerCase()}`);
    expect(network.texts().at(-1)).toContain('Bem-vindo(a), Bruno');
    const reported = await eventually(() =>
      network.other.find((request) => request.url === 'https://bohr.example.com/api/runtime/v1/members'),
    );
    expect(JSON.parse(reported.body)).toEqual({ action: 'joined', memberKey: 'tg:2002', name: 'Bruno' });
    expect(reported.headers.get('Bohr-Project')).toBe('p3k9x0a7qd2m');
    await say({ ...GUEST, id: 3003, first_name: 'Carla' }, `/entrar ${code}`);
    expect(network.texts().at(-1)).toBe('Código inválido, já usado ou expirado.');

    await say(GUEST, '/convidar');
    expect(network.texts().at(-1)).toBe('Só o dono do projeto pode fazer isso.');
    await say(OWNER, '/membros');
    expect(network.texts().at(-1)).toBe('Membros do projeto Loja Aurora:\n1. Ana (dono)\n2. Bruno (membro)');
    await say(OWNER, '/revogar 1');
    expect(network.texts().at(-1)).toBe('O dono não pode ser removido.');
    await say(OWNER, '/revogar 2');
    expect(network.texts().at(-1)).toBe('Acesso de Bruno revogado.');
    await inside((project) => expect(project.store.member('tg:2002')).toBeNull());
  });

  it('cancels what a revoked member left in the queue', async () => {
    const { say, alarm, network, inside } = setup();
    await say(OWNER, '/convidar');
    const code = /Convite: ([0-9A-Z]{4}-[0-9A-Z]{4})/.exec(network.texts().at(-1) ?? '')?.[1] ?? '';
    await say(GUEST, `/entrar ${code}`);
    await say(OWNER, 'Pedido da Ana');
    await alarm();
    await say(GUEST, 'Pedido do Bruno');
    await say(GUEST, 'Outro pedido do Bruno');
    await say(OWNER, '/revogar 2');
    await eventually(() => inside((project) => project.store.queued().length === 0));
    expect(await inside((project) => project.store.running()?.author_key)).toBe('tg:1001');
  });

  it('recognizes a member who first joined on the web and now writes from Telegram', async () => {
    const { say, network, inside } = setup();
    await inside((project) => project.store.addMember({ key: 'u:web-dora', name: 'Dora', role: 'member' }, new Date()));

    await say({ id: 4004, first_name: 'Dora', language_code: 'pt-br' }, '/status');
    expect(network.texts().at(-1)).toContain('Projeto Loja Aurora');
    await inside((project) => {
      expect(project.store.member('tg:4004')).toMatchObject({ name: 'Dora', role: 'member' });
      expect(project.store.member('u:web-dora')).toBeNull();
    });

    // Strangers are looked up once, then remembered for a while
    await say({ id: 5005, first_name: 'Eve', language_code: 'pt-br' }, 'oi');
    await say({ id: 5005, first_name: 'Eve', language_code: 'pt-br' }, 'oi de novo');
    const lookups = network.other.filter((request) => request.url.endsWith('/api/runtime/v1/identity'));
    expect(lookups.map((request) => JSON.parse(request.body).memberKey)).toEqual(['tg:4004', 'tg:5005']);
  });

  it('lets the owner change the model and budget', async () => {
    const { say, network, inside } = setup();
    await say(OWNER, '/orcamento 2,5');
    expect(network.texts().at(-1)).toBe('Orçamento por pedido: US$ 2,50');
    await say(OWNER, '/modelo claude-sonnet-5-5');
    await inside((project) => {
      expect(project.store.get('model')).toBe('claude-sonnet-5-5');
      expect(project.store.get('max_budget_usd')).toBe('2.5');
    });
    // The panel's range: up to US$ 1000
    await say(OWNER, '/orcamento 1000');
    expect(network.texts().at(-1)).toBe('Orçamento por pedido: US$ 1.000,00');
    await say(OWNER, '/orcamento 1001');
    expect(network.texts().at(-1)).toContain('entre US$ 0,10 e US$ 1.000,00');
    await say(OWNER, '/orcamento 0,05');
    expect(network.texts().at(-1)).toContain('entre US$ 0,10 e US$ 1.000,00');
    await inside((project) => expect(project.store.get('max_budget_usd')).toBe('1000'));
  });
});

describe('preview', () => {
  it('explains when there is no preview yet and proxies to the dev server when it runs', async () => {
    const { stub, container, inside } = setup({ imported: false });
    const empty = await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/');
    expect(empty.headers.get('x-robots-tag')).toBe('noindex');
    // Until the import writes .bohr/preview.json there is nothing to start; the page checks again slowly
    expect(empty.headers.get('retry-after')).toBe('30');
    expect(await empty.text()).toContain(
      'A homologação ainda não está configurada: o agente prepara isso ao importar o repositório.',
    );

    container.running = true;
    await stub.agentEvents([
      { type: 'preview.status', seq: 1, at: new Date().toISOString(), status: 'running', port: 8080 },
    ]);
    const page = await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/produtos');
    expect(await page.text()).toBe('preview /produtos');
    expect(page.headers.get('x-robots-tag')).toBe('noindex');
    // Through the runner's proxy, which reaches dev servers listening on localhost only
    expect(container.previewRequests).toEqual(['4841/produtos']);
    await inside((project) => expect(project.store.get('preview_port')).toBe('8080'));

    // A runner without the proxy: the dev server's port directly
    container.refusedPorts.add(4841);
    expect(await (await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/a')).text()).toBe('preview /a');
    // Nothing answers: says so (and keeps checking) instead of "starting" forever
    container.refusedPorts.add(8080);
    const silent = await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/b');
    expect(silent.status).toBe(503);
    expect(await silent.text()).toContain('o servidor dela não respondeu');
  });

  it('never serves the runner control port as the preview', async () => {
    const { stub, container, inside } = setup();
    container.running = true;
    await stub.agentEvents([
      { type: 'preview.status', seq: 1, at: new Date().toISOString(), status: 'running', port: 4840 },
    ]);
    await inside((project) => project.store.set('preview_port', 4840));
    const page = await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/v1/jobs');
    expect(await page.text()).not.toContain('preview /v1/jobs');
    expect(container.previewRequests).toEqual([]);
  });

  it('wakes the container and checks the work branch out again after a cold start', async () => {
    const { stub, container, inside } = setup();
    await inside((project) => {
      project.store.set('homolog_head_sha', sha('b'));
      project.store.set('preview_port', 8080);
    });
    const pages = await Promise.all([
      stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/'),
      stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/style.css'),
    ]);
    expect(pages.map((page) => page.status)).toEqual([503, 503]);
    expect(pages[0]?.headers.get('retry-after')).toBe('5');
    await eventually(() => container.synced.length > 0);
    // One boot serves both requests
    expect(container.starts).toBe(1);
    expect(container.synced).toEqual(['homolog']);
  });
});

const ANA = { key: 'tg:1001', name: 'Ana', role: 'owner' as const };
const WEB = { source: 'web' as const, locale: 'pt-BR' as const };
const V1_WORKFLOW = [
  'name: bohr',
  'on: [push]',
  'jobs:',
  '  deploy:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: bohr-io/action@main',
  '',
].join('\n');

describe('interrupted jobs', () => {
  it('fails a running request whose container went away, with a clear reason', async () => {
    const { say, alarm, container, network, inside } = setup();
    await say(OWNER, 'Troca o título');
    await alarm();
    expect(container.jobs).toHaveLength(1);

    // A runtime update re-uploads the Worker: the Durable Object and the container start over
    container.running = false;
    await alarm();
    await inside((project) => {
      expect(project.store.running()).toBeNull();
      expect(project.store.request(container.jobs[0]?.jobId ?? '')?.status).toBe('failed');
    });
    expect(network.texts().at(-1)).toContain('o ambiente do agente reiniciou no meio do pedido');
    // Not an import: nothing is queued again
    expect(await inside((project) => project.store.queued().length)).toBe(0);
  });

  it('fails a running request the restarted runner does not know', async () => {
    const { say, alarm, container, inside } = setup();
    await say(OWNER, 'Troca o título');
    await alarm();
    await inside((project) => project.store.set('runner_last_seq', 12));
    container.health = { ok: true, version: 'test', busy: true, jobId: 'req_someone_else_000', lastSeq: 1 };
    await alarm();
    await inside((project) => expect(project.store.request(container.jobs[0]?.jobId ?? '')?.status).toBe('failed'));
  });

  it('queues an interrupted import again, once', async () => {
    const { alarm, container, network, inside } = setup({ imported: false });
    await inside((project) => project.startImport(ANA, WEB));
    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['import']);

    container.running = false;
    await alarm();
    await inside((project) => {
      expect(project.store.request(container.jobs[0]?.jobId ?? '')?.error).toContain('o ambiente do agente reiniciou');
      expect(project.store.queued().map((row) => row.kind)).toEqual(['import']);
      // bohr queued it again by itself: it shows as bohr's, not as the owner's
      expect(project.store.queued().map((row) => row.author_name)).toEqual(['bohr']);
      expect(project.importStatus()).toBe('running');
      expect(project.store.chat(0, 100).map((row) => row.text)).toContain(
        '🔁 A preparação do repositório foi interrompida. Vou começá-la de novo automaticamente.',
      );
    });

    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['import', 'import']);
    container.running = false;
    await alarm();
    await inside((project) => {
      expect(project.store.queued()).toHaveLength(0);
      expect(project.importStatus()).toBe('failed');
    });
    expect(network.texts().filter((text) => text.includes('Vou começá-la de novo'))).toHaveLength(0);
  });
});

describe('import', () => {
  it('prepares a repository bohr never prepared before the first change, then runs the change', async () => {
    const { say, alarm, container, stub, network, inside } = setup({ imported: false });
    await say(OWNER, 'Muda o título para Ana e Lucas');
    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['import']);
    expect(network.texts()).toContain(
      '🧰 Antes do seu pedido, vou preparar o repositório para a bohr, porque a preparação inicial não terminou. Depois sigo com o que você pediu.',
    );

    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await alarm();
    expect(container.jobs.map((job) => [job.kind, job.prompt])).toEqual([
      ['import', expect.stringContaining('Prepare este repositório para a bohr')],
      ['change', 'Muda o título para Ana e Lucas'],
    ]);
    await inside((project) => expect(project.importStatus()).toBe('done'));
  });

  it('runs the change anyway when that import fails, without trying again for it', async () => {
    const { say, alarm, container, stub, inside } = setup({ imported: false });
    await say(OWNER, 'Muda o título');
    await alarm();
    await stub.agentEvents([
      finished(container.jobs[0]?.jobId ?? '', 1, { outcome: 'failed', headSha: undefined, commits: [], error: 'x' }),
    ]);
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['import', 'change']);
    await inside((project) => expect(project.importStatus()).toBe('failed'));
  });

  /** A change to a repository never prepared, whose import stops to ask a question. */
  async function importAsks(question = { text: 'O site usa um banco de dados?', options: ['Postgres', 'Nenhum'] }) {
    const context = setup({ imported: false });
    await context.say(OWNER, 'Tente novamente');
    await context.alarm();
    const importId = context.container.jobs[0]?.jobId ?? '';
    await context.stub.agentEvents([
      finished(importId, 1, {
        outcome: 'needs_input',
        headSha: undefined,
        commits: [],
        sessionId: 'session-import',
        question,
      }),
    ]);
    context.container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    return { ...context, importId };
  }

  it("holds the queue while the import's question waits, runs the answer first, then the change", async () => {
    const { tap, alarm, container, stub, network, inside, importId } = await importAsks();
    // The change behind the import would analyze the same repository and ask the same question: it waits
    await alarm();
    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['import']);
    await inside((project) => {
      expect(project.store.queued().map((row) => row.text)).toEqual(['Tente novamente']);
      expect(project.importStatus()).toBe('running');
    });

    await tap(OWNER, `answer:${importId}:0`);
    await alarm();
    // The answer goes on preparing the repository, in the import's session
    expect(container.jobs[1]).toMatchObject({ kind: 'import', prompt: 'Postgres', resumeSessionId: 'session-import' });
    await inside((project) => expect(project.store.queued().map((row) => row.text)).toEqual(['Tente novamente']));

    await stub.agentEvents([finished(container.jobs[1]?.jobId ?? '', 2)]);
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 2 };
    await alarm();
    expect(container.jobs.map((job) => [job.kind, job.prompt])).toEqual([
      ['import', expect.stringContaining('Prepare este repositório para a bohr')],
      ['import', 'Postgres'],
      ['change', 'Tente novamente'],
    ]);
    await inside((project) => expect(project.importStatus()).toBe('done'));
    // One notice, one question
    expect(network.texts().filter((text) => text.includes('Antes do seu pedido'))).toHaveLength(1);
    expect(network.texts().filter((text) => text.includes('O site usa um banco de dados?'))).toHaveLength(1);
  });

  it("takes a typed message as the import's answer, in front of the queue and outside the member's limit", async () => {
    const { say, alarm, container, network, inside } = await importAsks();
    for (let index = 1; index <= 4; index++) await say(OWNER, `Pedido ${index}`, 555);
    await alarm();
    expect(container.jobs).toHaveLength(1);

    await say(OWNER, 'Não usa banco');
    expect(network.sent().at(-1)?.body.text).toBe('⏳ Trabalhando no seu pedido…');
    await alarm();
    expect(container.jobs[1]).toMatchObject({
      kind: 'import',
      prompt: 'Não usa banco',
      resumeSessionId: 'session-import',
    });
    await inside((project) =>
      expect(project.store.queued().map((row) => row.text)).toEqual([
        'Tente novamente',
        'Pedido 1',
        'Pedido 2',
        'Pedido 3',
        'Pedido 4',
      ]),
    );
  });

  it("runs the held change when the import's answer fails, or its question is cancelled", async () => {
    const failing = await importAsks();
    await failing.tap(OWNER, `answer:${failing.importId}:1`);
    await failing.alarm();
    await failing.stub.agentEvents([
      finished(failing.container.jobs[1]?.jobId ?? '', 2, {
        outcome: 'failed',
        headSha: undefined,
        commits: [],
        error: 'x',
      }),
    ]);
    failing.container.health = { ok: true, version: 'test', busy: false, lastSeq: 2 };
    await failing.alarm();
    expect(failing.container.jobs.map((job) => job.kind)).toEqual(['import', 'import', 'change']);
    await failing.inside((project) => expect(project.importStatus()).toBe('failed'));

    const dropped = await importAsks();
    await dropped.tap(OWNER, `cancel:${dropped.importId}`);
    expect(dropped.network.sent('answerCallbackQuery').at(-1)?.body.text).toBe('Pedido cancelado.');
    await dropped.alarm();
    expect(dropped.container.jobs.map((job) => [job.kind, job.prompt])).toEqual([
      ['import', expect.stringContaining('Prepare este repositório')],
      ['change', 'Tente novamente'],
    ]);
    // The question's buttons are gone, and a late tap on one is refused
    await dropped.tap(OWNER, `answer:${dropped.importId}:0`);
    expect(dropped.container.jobs).toHaveLength(2);
    expect(dropped.network.texts().filter((text) => text.includes('Antes do seu pedido'))).toHaveLength(1);
  });

  it('keeps the queue moving when a change, not an import, asks a question', async () => {
    const { say, alarm, container, stub } = setup();
    await say(OWNER, 'Adiciona um meio de pagamento');
    await alarm();
    await say(OWNER, 'Troca o rodapé', 555);
    await stub.agentEvents([
      finished(container.jobs[0]?.jobId ?? '', 1, {
        outcome: 'needs_input',
        headSha: undefined,
        commits: [],
        question: { text: 'Qual meio de pagamento?', options: ['Pix', 'Boleto'] },
      }),
    ]);
    container.health = { ok: true, version: 'test', busy: false, lastSeq: 1 };
    await alarm();
    expect(container.jobs.map((job) => job.prompt)).toEqual(['Adiciona um meio de pagamento', 'Troca o rodapé']);
  });

  it('does not import a repository whose production branch is already prepared', async () => {
    const { say, alarm, container, repo, inside } = setup({ imported: false });
    repo.files.set('.bohr/preview.json', JSON.stringify({ command: 'npx serve -l 8080', port: 8080 }));
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'true' }));
    await say(OWNER, 'Muda o título');
    await alarm();
    expect(container.jobs.map((job) => job.kind)).toEqual(['change']);
    await inside((project) => expect(project.importStatus()).toBe('done'));
  });

  it('removes the bohr v1 workflow from the work branch when the import finishes', async () => {
    const { alarm, container, stub, repo, inside } = setup({ imported: false });
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'npm run build' }));
    repo.files.set('.github/workflows/bohr.yml', V1_WORKFLOW);
    repo.files.set('.github/workflows/ci.yml', 'name: CI\non: [push]\n');
    await inside((project) => project.startImport(ANA, WEB));
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);

    const deletes = repo.calls.filter((call) => call.method === 'deleteFile').map((call) => call.args[0]);
    expect(deletes).toEqual([
      {
        path: '.github/workflows/bohr.yml',
        branch: 'homolog',
        message: 'bohr: remove the bohr v1 workflow .github/workflows/bohr.yml',
        sha: 'blob-.github/workflows/bohr.yml',
      },
    ]);
    // The v2 workflow is written too, and the decision pins the head GitHub has after both commits
    expect(repo.files.has('.github/workflows/bohr-deploy.yml')).toBe(true);
    expect(repo.files.has('.github/workflows/ci.yml')).toBe(true);
    await inside((project) => {
      expect(project.homolog()).toMatchObject({ status: 'pending', headSha: sha('d') });
      // The import's summary says so
      expect(project.store.chat(0, 100).at(-1)?.text).toContain(
        'Removi o workflow da bohr v1 (.github/workflows/bohr.yml), que falhava a cada push.',
      );
    });
  });

  it('keeps bohr.yml, and adds no second deploy workflow, for a project bohr hosts', async () => {
    const context = setup({ imported: false });
    const { alarm, container, stub, repo, inside } = context;
    await inside((project) => {
      const env = (project as unknown as { env: Record<string, unknown> }).env;
      Object.defineProperty(project, 'env', { value: { ...env, DEPLOY_TARGET: 'bohr-cloud' } });
    });
    repo.files.set('.bohr/deploy.json', JSON.stringify({ build: 'npm run build' }));
    repo.files.set('.github/workflows/bohr.yml', V1_WORKFLOW);
    await inside((project) => project.startImport(ANA, WEB));
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    expect(repo.calls.filter((call) => call.method === 'deleteFile')).toEqual([]);
    expect(repo.files.has('.github/workflows/bohr.yml')).toBe(true);
    expect(repo.files.has('.github/workflows/bohr-deploy.yml')).toBe(false);
  });

  it('removes the v1 workflow even when the import changed nothing else', async () => {
    const { alarm, container, stub, repo, inside } = setup({ imported: false });
    repo.files.set('.github/workflows/bohr.yml', V1_WORKFLOW);
    await inside((project) => project.startImport(ANA, WEB));
    await alarm();
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1, { headSha: undefined, commits: [] })]);

    // No work branch yet: it starts from production, then loses the v1 workflow
    expect(repo.calls.find((call) => call.method === 'resetBranch')?.args).toEqual(['homolog', sha('a')]);
    expect(repo.files.has('.github/workflows/bohr.yml')).toBe(false);
    await inside((project) => {
      expect(project.homolog()).toMatchObject({ status: 'pending', headSha: sha('d') });
      expect(project.importStatus()).toBe('done');
    });
  });
});

describe('cost', () => {
  async function subscriptionProject(context: ReturnType<typeof setup>) {
    await context.inside((project) => {
      const env = (project as unknown as { env: Record<string, unknown> }).env;
      Object.defineProperty(project, 'env', { value: { ...env, AGENT_PROVIDER: 'subscription' } });
    });
  }

  it("never shows a request's cost in the chat, but keeps it", async () => {
    for (const subscription of [false, true]) {
      const context = setup();
      if (subscription) await subscriptionProject(context);
      await context.say(OWNER, 'Troca a cor do botão');
      await context.alarm();
      const jobId = context.container.jobs[0]?.jobId ?? '';
      await context.stub.agentEvents([finished(jobId, 1)]);
      const text = String(context.network.sent('editMessageText').at(-1)?.body.text);
      expect(text).toContain('✅ Pronto!');
      expect(text).not.toMatch(/US\$|[Cc]usto|assinatura/);
      await context.inside((project) => expect(project.store.request(jobId)?.cost_usd).toBe(0.42));
    }
  });

  it('explains a spending cap as a limit, without amounts or prices', async () => {
    for (const subscription of [false, true]) {
      const context = setup();
      if (subscription) await subscriptionProject(context);
      await context.say(OWNER, 'Refaz o site inteiro');
      await context.alarm();
      await context.stub.agentEvents([
        finished(context.container.jobs[0]?.jobId ?? '', 1, {
          outcome: 'failed',
          headSha: undefined,
          commits: [],
          ...(subscription ? { failure: 'budget' as const } : {}),
          error: 'Budget exhausted (limit US$ 5).',
        }),
      ]);
      const text = String(context.network.texts().at(-1));
      expect(text).toContain('o pedido chegou ao limite por pedido antes de o trabalho terminar');
      expect(text).not.toMatch(/US\$|orçamento|assinatura/);
    }
  });

  it("explains the turn limit in the project's language, not the runner's English", async () => {
    for (const failure of ['turns' as const, undefined]) {
      const context = setup();
      await context.say(OWNER, 'Refaz o site inteiro');
      await context.alarm();
      await context.stub.agentEvents([
        finished(context.container.jobs[0]?.jobId ?? '', 1, {
          outcome: 'failed',
          headSha: undefined,
          commits: [],
          ...(failure ? { failure } : {}),
          error: 'Too many turns (limit 200).',
        }),
      ]);
      const text = String(context.network.texts().at(-1));
      expect(text).toContain('o pedido precisou de mais passos do que o permitido');
      expect(text).not.toContain('Too many turns');
    }
  });
});

describe('preview without configuration', () => {
  it('says the preview is not set up instead of starting forever', async () => {
    const { stub, container, inside } = setup({ imported: false });
    await inside((project) => project.store.set('homolog_head_sha', sha('b')));
    container.running = true;
    await stub.agentEvents([
      {
        type: 'preview.status',
        seq: 1,
        at: new Date().toISOString(),
        status: 'stopped',
        // A runner from before the reason field: the log says it
        log: '.bohr/preview.json was not found, so there is no preview yet.',
      },
    ]);
    const page = await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/');
    const html = await page.text();
    expect(html).toContain('A homologação ainda não está configurada');
    expect(html).not.toContain('iniciando');
    await inside((project) => expect(project.previewState()).toBe('not_configured'));

    // Once the agent writes it, the preview runs
    await stub.agentEvents([
      { type: 'preview.status', seq: 2, at: new Date().toISOString(), status: 'running', port: 8080 },
    ]);
    expect(await (await stub.fetch('https://bohr-preview-x7k2.acme.workers.dev/')).text()).toBe('preview /');
  });
});

describe('runtime update', () => {
  it('stops the container and restarts on the new code, after the running request', async () => {
    const { say, alarm, container, stub, inside } = setup();
    container.running = true;
    await say(OWNER, 'Troca a cor do botão');
    await alarm();
    // A request runs: the restart waits for it
    expect(await inside((project) => project.restartForUpdate())).toBe('deferred');
    expect(container.stops).toBe(0);
    await stub.agentEvents([finished(container.jobs[0]?.jobId ?? '', 1)]);
    await alarm();
    expect(container.stops).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(restarts).toHaveLength(1);
    // Nothing running: right away
    container.running = true;
    expect(await inside((project) => project.restartForUpdate())).toBe('restarting');
    expect(container.stops).toBe(2);
  });
});
