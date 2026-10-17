import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type AgentEvent, type AgentJob, agentEventBatchSchema, agentEventSchema } from '@bohr/shared';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { AgentBackend } from '../src/agent';
import { EventLog } from '../src/events';
import { DENY } from '../src/guards';
import { t } from '../src/i18n';
import {
  BranchNotFoundError,
  JobRunner,
  type JobRunnerOptions,
  RunnerBusyError,
  UnknownRepositoryError,
} from '../src/job';
import { NOTES } from '../src/prompt';
import {
  assistant,
  createRemote,
  errorResult,
  eventsOfType,
  fakeAgent,
  git,
  gitAvailable,
  isolatedGitEnv,
  makeJob,
  removeDir,
  successResult,
  type TestRemote,
  tempDir,
  textBlock,
  toolUse,
  untilAborted,
  waitFor,
} from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe.skipIf(!gitAvailable)('job flow with a real repository', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let remote: TestRemote;
  let workspace: string;
  let all: AgentEvent[];
  let events: EventLog;
  let preview: { refresh: Mock<() => Promise<void>>; waitForInstall: Mock<(signal?: AbortSignal) => Promise<void>> };

  beforeEach(() => {
    root = tempDir();
    env = isolatedGitEnv(root);
    remote = createRemote(root, env, { '.github/workflows/ci.yml': 'name: CI\n' });
    workspace = path.join(root, 'workspace', 'repo');
    all = [];
    events = new EventLog();
    events.subscribe((event) => all.push(event));
    preview = { refresh: vi.fn(async () => {}), waitForInstall: vi.fn(async () => {}) };
  });

  afterEach(() => removeDir(root));

  function makeRunner(agent: AgentBackend, options: Partial<JobRunnerOptions> = {}): JobRunner {
    return new JobRunner({
      workspace,
      remoteBase: remote.remoteBase,
      events,
      agent,
      preview,
      gitEnv: env,
      ...options,
    });
  }

  async function run(runner: JobRunner, job: AgentJob) {
    expect(runner.start(job)).toBe(true);
    await runner.idle();
    const finished = eventsOfType(all, 'job.finished').filter((event) => event.jobId === job.jobId);
    expect(finished).toHaveLength(1);
    return finished[0] as NonNullable<(typeof finished)[0]>;
  }

  const file = (...parts: string[]) => path.join(workspace, ...parts);
  const local = (args: string[]) => git(args, workspace, env);
  const timeline = (jobId: string) =>
    all
      .filter((event) => 'jobId' in event && event.jobId === jobId)
      .map((event) =>
        event.type === 'job.progress' || event.type === 'job.message' ? `${event.type}: ${event.text}` : event.type,
      );

  it('creates the work branch from production, then commits and pushes what the agent changed', async () => {
    const agent = fakeAgent(async function* (request) {
      writeFileSync(path.join(request.cwd, 'hello.txt'), 'hello\n');
      yield assistant([textBlock('I will add a greeting.')]);
      yield assistant([toolUse('Write', { file_path: path.join(request.cwd, 'hello.txt'), content: 'hello\n' })]);
      yield assistant([textBlock('Greeting page\n- Added hello.txt')]);
      yield successResult('Greeting page\n- Added hello.txt', {
        costUsd: 0.25,
        numTurns: 3,
        sessionId: request.sessionId,
      });
    });
    const job = makeJob();
    const finished = await run(makeRunner(agent), job);

    const homolog = remote.read(['rev-parse', 'refs/heads/homolog']);
    expect(finished).toMatchObject({
      outcome: 'succeeded',
      summary: 'Greeting page\n- Added hello.txt',
      costUsd: 0.25,
      numTurns: 3,
      headSha: homolog,
      commits: [{ sha: homolog, title: 'Greeting page' }],
    });
    expect(remote.read(['show', 'homolog:hello.txt'])).toBe('hello');
    expect(remote.read(['log', '-1', '--format=%an <%ae>|%P|%B', 'homolog'])).toBe(
      `Ada (via bohr) <noreply@bohr.io>|${remote.mainSha}|Greeting page\n\n- Added hello.txt`,
    );
    expect(remote.read(['rev-parse', 'refs/heads/main'])).toBe(remote.mainSha);

    expect(timeline(job.jobId)).toEqual([
      'job.started',
      'job.progress: Preparing the repository',
      'job.message: I will add a greeting.',
      'job.progress: Editing hello.txt',
      'job.progress: Publishing the changes to the preview',
      'job.finished',
    ]);
    for (const event of all) agentEventSchema.parse(event);
    expect(agentEventBatchSchema.safeParse({ events: all }).success).toBe(true);

    const request = agent.requests[0];
    expect(request?.sessionId).toMatch(UUID);
    expect(eventsOfType(all, 'job.started')[0]?.sessionId).toBe(request?.sessionId);
    expect(finished.sessionId).toBe(request?.sessionId);
    expect(request).toMatchObject({ cwd: workspace, resume: false, prompt: job.prompt });
    expect(request?.systemPrompt).toContain('on branch homolog');
    expect(request?.guard('Bash', { command: 'git push' }, workspace)).toBe(DENY.push);
    expect(request?.guard('Write', { file_path: file('.github', 'workflows', 'x.yml') }, workspace)).toBe(
      DENY.workflows,
    );
    expect(request?.guard('Write', { file_path: file('ok.txt') }, workspace)).toBeUndefined();

    expect(local(['status', '--porcelain'])).toBe('');
    expect(local(['config', 'user.email'])).toBe('noreply@bohr.io');
    expect(preview.waitForInstall).toHaveBeenCalled();
    expect(preview.refresh).toHaveBeenCalled();
  });

  it('continues from the work branch on GitHub in the next job', async () => {
    let sawFirstChange = false;
    const agent = fakeAgent(async function* (request) {
      const hello = path.join(request.cwd, 'hello.txt');
      if (request.job.prompt === 'first') {
        writeFileSync(hello, 'hello\n');
        yield successResult('First change');
      } else {
        sawFirstChange = existsSync(hello);
        appendFileSync(hello, 'again\n');
        yield successResult('Second change');
      }
    });
    const runner = makeRunner(agent);
    const first = await run(runner, makeJob({ prompt: 'first' }));
    const second = await run(runner, makeJob({ prompt: 'second' }));

    expect(sawFirstChange).toBe(true);
    expect(second.outcome).toBe('succeeded');
    expect(second.commits.map((commit) => commit.title)).toEqual(['Second change']);
    expect(remote.read(['log', '-1', '--format=%P', 'homolog'])).toBe(first.headSha);
    expect(remote.read(['show', 'homolog:hello.txt'])).toBe('hello\nagain');
  });

  it('throws the work away when the agent fails, leaving the work branch where it was', async () => {
    const agent = fakeAgent(async function* (request) {
      if (request.job.prompt === 'first') {
        writeFileSync(path.join(request.cwd, 'hello.txt'), 'hello\n');
        yield successResult('First change');
        return;
      }
      writeFileSync(path.join(request.cwd, 'hello.txt'), 'broken\n');
      writeFileSync(path.join(request.cwd, 'junk.txt'), 'junk\n');
      if (request.job.prompt === 'crash') throw new Error('The agent process crashed');
      yield errorResult('error_max_budget_usd', { costUsd: 1.5 });
    });
    const runner = makeRunner(agent);
    const first = await run(runner, makeJob({ prompt: 'first' }));

    const overBudget = await run(runner, makeJob({ prompt: 'expensive' }));
    expect(overBudget).toMatchObject({
      outcome: 'failed',
      summary: t('en', 'failedBudget'),
      error: 'Budget exhausted (limit US$ 5).',
      failure: 'budget',
      costUsd: 1.5,
      numTurns: 7,
      commits: [],
    });
    expect(overBudget.headSha).toBeUndefined();
    // The same limit on a Claude subscription, without amounts or prices
    const capped = await run(runner, makeJob({ prompt: 'expensive', auth: 'oauth' }));
    expect(capped).toMatchObject({ outcome: 'failed', failure: 'budget', summary: t('en', 'failedBudget') });
    expect(capped.summary).not.toMatch(/price|subscription|spending|US\$/);
    expect(readFileSync(file('hello.txt'), 'utf8')).toBe('hello\n');
    expect(existsSync(file('junk.txt'))).toBe(false);
    expect(local(['status', '--porcelain'])).toBe('');

    const crashed = await run(runner, makeJob({ prompt: 'crash' }));
    expect(crashed).toMatchObject({ outcome: 'failed', summary: t('en', 'failedError') });
    expect(crashed.error).toContain('The agent process crashed');
    expect(existsSync(file('junk.txt'))).toBe(false);
    expect(remote.read(['rev-parse', 'refs/heads/homolog'])).toBe(first.headSha);
  });

  it('cancels a running job and discards its changes', async () => {
    const agent = fakeAgent(async function* (request) {
      writeFileSync(path.join(request.cwd, 'draft.txt'), 'draft\n');
      yield assistant([toolUse('Write', { file_path: path.join(request.cwd, 'draft.txt'), content: 'draft\n' })]);
      await untilAborted(request.abortController.signal);
    });
    const runner = makeRunner(agent);
    const job = makeJob({ locale: 'pt-BR' });
    expect(runner.start(job)).toBe(true);
    expect(runner.start(makeJob())).toBe(false);
    expect(runner.currentJobId).toBe(job.jobId);
    await waitFor(() => timeline(job.jobId).includes('job.progress: Editando draft.txt'), 20_000, 'the edit');
    expect(runner.cancel('req_someone_else')).toBe(false);
    expect(runner.cancel(job.jobId)).toBe(true);
    await runner.idle();

    expect(eventsOfType(all, 'job.finished')).toEqual([
      expect.objectContaining({ outcome: 'cancelled', summary: t('pt-BR', 'cancelled'), commits: [] }),
    ]);
    expect(runner.busy).toBe(false);
    expect(existsSync(file('draft.txt'))).toBe(false);
    expect(remote.read(['rev-parse', '--verify', '--quiet', 'refs/heads/homolog'])).toBeUndefined();
  });

  it('stops to ask the user, then resumes the session with the working tree as it was', async () => {
    const question = 'Which blue do you prefer for the header?';
    const agent = fakeAgent(async function* (request) {
      if (request.job.prompt === 'Make the header blue') {
        writeFileSync(path.join(request.cwd, 'draft.txt'), 'draft\n');
        request.onAskUser({ text: question, options: ['Navy', 'Sky'] });
        yield assistant([toolUse('mcp__bohr__ask_user', { question, options: ['Navy', 'Sky'] })]);
        yield assistant([textBlock(question)]);
        yield successResult(question, { costUsd: 0.1, sessionId: request.sessionId });
        return;
      }
      expect(existsSync(path.join(request.cwd, 'draft.txt'))).toBe(true);
      writeFileSync(path.join(request.cwd, 'final.txt'), 'navy\n');
      yield successResult('Navy header', { costUsd: 0.35, sessionId: request.sessionId });
    });
    const runner = makeRunner(agent);
    const asking = makeJob({ prompt: 'Make the header blue' });
    const asked = await run(runner, asking);

    expect(asked).toMatchObject({
      outcome: 'needs_input',
      summary: question,
      question: { text: question, options: ['Navy', 'Sky'] },
      costUsd: 0.1,
      commits: [],
    });
    expect(asked.headSha).toBeUndefined();
    expect(timeline(asking.jobId).some((line) => line.startsWith('job.message'))).toBe(false);
    expect(existsSync(file('draft.txt'))).toBe(true);
    expect(remote.read(['rev-parse', '--verify', '--quiet', 'refs/heads/homolog'])).toBeUndefined();

    const answer = makeJob({ prompt: 'Navy', resumeSessionId: asked.sessionId });
    const answered = await run(runner, answer);
    expect(agent.requests[1]).toMatchObject({ resume: true, sessionId: asked.sessionId, prompt: 'Navy' });
    expect(answered.outcome).toBe('succeeded');
    // The SDK reports a resumed session's cost including the earlier run.
    expect(answered.costUsd).toBeCloseTo(0.25);
    expect(answered.commits.map((commit) => commit.title)).toEqual(['Navy header']);
    expect(remote.read(['show', 'homolog:draft.txt'])).toBe('draft');
    expect(remote.read(['show', 'homolog:final.txt'])).toBe('navy');
  });

  it('tells a resumed session when its uncommitted work was reset meanwhile', async () => {
    const agent = fakeAgent(async function* (request) {
      if (request.job.prompt === 'ask') {
        writeFileSync(path.join(request.cwd, 'draft.txt'), 'draft\n');
        request.onAskUser({ text: 'Which?', options: ['A', 'B'] });
        yield successResult('Which?', { sessionId: request.sessionId });
        return;
      }
      yield successResult('Nothing to do');
    });
    const runner = makeRunner(agent);
    const asked = await run(runner, makeJob({ prompt: 'ask' }));
    await runner.sync('main');
    const answer = makeJob({ prompt: 'A', resumeSessionId: asked.sessionId });
    const answered = await run(runner, answer);

    expect(agent.requests[1]?.prompt).toBe(`[bohr] ${NOTES.changesDiscarded}\n\nA`);
    expect(answered).toMatchObject({ outcome: 'succeeded', commits: [] });
    expect(existsSync(file('draft.txt'))).toBe(false);
  });

  it('starts a new session when the one to resume is gone, and pushes nothing when nothing changed', async () => {
    const agent = fakeAgent(async function* (request) {
      yield successResult('Nothing needed changing.', { sessionId: request.sessionId });
    });
    const job = makeJob({ prompt: 'Make it darker', resumeSessionId: 'session-from-before-a-restart' });
    const finished = await run(makeRunner(agent), job);

    const request = agent.requests[0];
    expect(request?.resume).toBe(false);
    expect(request?.sessionId).toMatch(UUID);
    expect(request?.prompt).toBe(`[bohr] ${NOTES.conversationLost(job)}\n\nMake it darker`);
    expect(finished).toMatchObject({ outcome: 'succeeded', summary: 'Nothing needed changing.', commits: [] });
    expect(finished.headSha).toBeUndefined();
    expect(remote.read(['rev-parse', '--verify', '--quiet', 'refs/heads/homolog'])).toBeUndefined();
  });

  it('leaves workflow changes out unless the job allows them, even when the agent committed them', async () => {
    const agent = fakeAgent(async function* (request) {
      const at = (...parts: string[]) => path.join(request.cwd, ...parts);
      if (request.job.allowWorkflowEdits) {
        writeFileSync(at('.github', 'workflows', 'bohr-deploy.yml'), 'name: Deploy\n');
        yield successResult('Deploy workflow');
        return;
      }
      writeFileSync(at('site.txt'), 'site\n');
      writeFileSync(at('.github', 'workflows', 'evil.yml'), 'name: Evil\n');
      git(['add', '--all'], request.cwd, env);
      git(['commit', '--quiet', '-m', 'Agent commit'], request.cwd, env);
      writeFileSync(at('.github', 'workflows', 'ci.yml'), 'name: Changed\n');
      writeFileSync(at('more.txt'), 'more\n');
      yield successResult('Site update');
    });
    const runner = makeRunner(agent);
    const finished = await run(runner, makeJob());

    expect(finished.outcome).toBe('succeeded');
    expect(finished.summary).toBe(`Site update\n\n${t('en', 'workflowsLeftOut')}`);
    expect(finished.commits.map((commit) => commit.title)).toEqual(['Site update']);
    expect(remote.read(['show', 'homolog:site.txt'])).toBe('site');
    expect(remote.read(['show', 'homolog:more.txt'])).toBe('more');
    expect(remote.read(['show', 'homolog:.github/workflows/ci.yml'])).toBe('name: CI');
    expect(remote.read(['cat-file', '-e', 'homolog:.github/workflows/evil.yml'])).toBeUndefined();
    expect(remote.read(['log', '--format=%H', 'main..homolog', '--', '.github/workflows'])).toBe('');
    expect(existsSync(file('.github', 'workflows', 'evil.yml'))).toBe(false);
    expect(readFileSync(file('.github', 'workflows', 'ci.yml'), 'utf8')).toBe('name: CI\n');

    const allowed = await run(runner, makeJob({ kind: 'import', allowWorkflowEdits: true }));
    expect(allowed.outcome).toBe('succeeded');
    expect(remote.read(['show', 'homolog:.github/workflows/bohr-deploy.yml'])).toBe('name: Deploy');
  });

  it('fails clearly when the production branch does not exist', async () => {
    const agent = fakeAgent(async function* () {
      yield successResult('unreachable');
    });
    const job = makeJob({ repo: { owner: 'acme', name: 'site', baseBranch: 'develop' } });
    const finished = await run(makeRunner(agent), job);
    expect(finished).toMatchObject({ outcome: 'failed', summary: t('en', 'failedError') });
    expect(finished.error).toContain('develop');
    expect(agent.requests).toHaveLength(0);
    expect(timeline(job.jobId)[0]).toBe('job.started');
  });

  describe('sync', () => {
    it('clones a fresh workspace and makes it match the remote branch', async () => {
      const runner = makeRunner(
        fakeAgent(async function* () {}),
        { defaultRepo: { owner: 'acme', name: 'site' } },
      );
      expect(await runner.sync('main')).toEqual({ headSha: remote.mainSha });
      expect(readFileSync(file('README.md'), 'utf8')).toBe('# Site\n');
      expect(preview.refresh).toHaveBeenCalledTimes(1);

      writeFileSync(file('README.md'), 'changed\n');
      writeFileSync(file('junk.txt'), 'junk\n');
      mkdirSync(file('node_modules', 'pkg'), { recursive: true });
      writeFileSync(file('node_modules', 'pkg', 'index.js'), '');
      const seed = path.join(root, 'seed');
      writeFileSync(path.join(seed, 'news.txt'), 'news\n');
      git(['add', '--all'], seed, env);
      git(['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '--quiet', '-m', 'News'], seed, env);
      git(['push', '--quiet', remote.bare, 'HEAD:refs/heads/main'], seed, env);

      const { headSha } = await runner.sync('main');
      expect(headSha).toBe(remote.read(['rev-parse', 'refs/heads/main']));
      expect(readFileSync(file('README.md'), 'utf8')).toBe('# Site\n');
      expect(existsSync(file('news.txt'))).toBe(true);
      expect(existsSync(file('junk.txt'))).toBe(false);
      expect(existsSync(file('node_modules', 'pkg', 'index.js'))).toBe(true);
      expect(local(['symbolic-ref', '--short', 'HEAD'])).toBe('main');

      await expect(runner.sync('homolog')).rejects.toBeInstanceOf(BranchNotFoundError);
    });

    it('needs to know the repository to clone', async () => {
      const runner = makeRunner(fakeAgent(async function* () {}));
      await expect(runner.sync('main')).rejects.toBeInstanceOf(UnknownRepositoryError);
    });

    it('clones again over a broken checkout, never touching an enclosing repository', async () => {
      const outer = path.join(root, 'outer');
      mkdirSync(outer);
      git(['init', '--quiet', outer], root, env);
      writeFileSync(path.join(outer, 'keep.txt'), 'keep\n');
      workspace = path.join(outer, 'nested', 'repo');
      mkdirSync(path.join(workspace, '.git'), { recursive: true });

      const runner = makeRunner(
        fakeAgent(async function* () {}),
        { defaultRepo: { owner: 'acme', name: 'site' } },
      );
      expect(await runner.sync('main')).toEqual({ headSha: remote.mainSha });
      expect(readFileSync(file('README.md'), 'utf8')).toBe('# Site\n');
      expect(readFileSync(path.join(outer, 'keep.txt'), 'utf8')).toBe('keep\n');
      expect(git(['remote'], outer, env)).toBe('');
    });

    it('refuses to sync while a job runs, and syncs the work branch afterwards', async () => {
      const agent = fakeAgent(async function* (request) {
        if (request.job.prompt === 'wait') {
          yield assistant([toolUse('Read', { file_path: path.join(request.cwd, 'README.md') })]);
          await untilAborted(request.abortController.signal);
        }
        writeFileSync(path.join(request.cwd, 'page.txt'), 'page\n');
        yield successResult('New page');
      });
      const runner = makeRunner(agent);
      const waiting = makeJob({ prompt: 'wait' });
      runner.start(waiting);
      await waitFor(() => timeline(waiting.jobId).includes('job.progress: Reading README.md'), 20_000, 'the read');
      await expect(runner.sync('main')).rejects.toBeInstanceOf(RunnerBusyError);
      runner.cancel(waiting.jobId);
      await runner.idle();

      const published = await run(runner, makeJob({ prompt: 'publish' }));
      expect(await runner.sync('homolog')).toEqual({ headSha: published.headSha });
      expect(existsSync(file('page.txt'))).toBe(true);
    });
  });
});
