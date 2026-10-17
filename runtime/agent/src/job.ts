import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentJob, JobFinishedEvent } from '@bohr/shared';
import {
  type AgentBackend,
  type AgentFailure,
  type AgentQuestion,
  type AgentRunRequest,
  MessageMapper,
  readResult,
} from './agent';
import { type RepoRef, remoteUrl } from './config';
import type { EventInput } from './events';
import { Checkout, type CommitInfo } from './git';
import { checkToolUse, isWorkflowPath } from './guards';
import { type MessageKey, t } from './i18n';
import { type Logger, silentLogger } from './log';
import { buildSystemPrompt, buildUserPrompt, NOTES } from './prompt';
import { errorMessage, oneLine, truncate } from './text';

export class RunnerBusyError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} is running.`);
    this.name = 'RunnerBusyError';
  }
}

export class BranchNotFoundError extends Error {
  constructor(readonly branch: string) {
    super(`The branch ${branch} does not exist on origin.`);
    this.name = 'BranchNotFoundError';
  }
}

export class UnknownRepositoryError extends Error {
  constructor() {
    super('There is no checkout yet and the repository is unknown; start the container with BOHR_REPO=<owner>/<name>.');
    this.name = 'UnknownRepositoryError';
  }
}

/** What the job runner needs from the preview. */
export interface PreviewHooks {
  /** Waits while dependencies are being installed, so the agent never races the install. */
  waitForInstall(signal?: AbortSignal): Promise<void>;
  /** Restarts the preview when the checkout changed in a way hot reload cannot pick up. */
  refresh(): Promise<void>;
}

export interface JobRunnerOptions {
  workspace: string;
  /** Remote URLs are `<remoteBase>/<owner>/<name>.git`. */
  remoteBase: string;
  events: { emit(event: EventInput): unknown };
  agent: AgentBackend;
  preview?: PreviewHooks;
  /** Repository to clone for /git/sync before any job has named one. */
  defaultRepo?: RepoRef;
  /** Directories outside the workspace the agent may write to; /tmp and the OS temp directory by default. */
  writableRoots?: string[];
  gitEnv?: NodeJS.ProcessEnv;
  log?: Logger;
}

type Finished = Omit<JobFinishedEvent, 'type' | 'jobId' | 'seq' | 'at'>;

interface RunningJob {
  job: AgentJob;
  abort: AbortController;
  /** Cancelling stops the job up to the end of the agent run; publishing is never interrupted. */
  phase: 'queued' | 'checkout' | 'agent' | 'finalize';
  done: Promise<void>;
}

/** A run that stopped to ask the user; the next job resuming that session keeps its working tree. */
interface PendingQuestion {
  sessionId: string;
  workBranch: string;
  startSha: string;
  /** False once the checkout was reset (by /git/sync) after the question. */
  keep: boolean;
}

interface AgentRun {
  result?: SDKResultMessage;
  question?: AgentQuestion;
  error?: unknown;
}

const FAILURE_MESSAGES: Record<AgentFailure, MessageKey> = {
  budget: 'failedBudget',
  turns: 'failedTurns',
  error: 'failedError',
};

/** Runs one job at a time: checkout, agent, commit and push, with events for every step. */
export class JobRunner {
  private current: RunningJob | undefined;
  private pendingQuestion: PendingQuestion | undefined;
  private repo: RepoRef | undefined;
  private readonly lock = new Mutex();
  private readonly checkout: Checkout;
  private readonly writableRoots: string[];
  /** Last total cost per session: the SDK reports a resumed session's cost including earlier runs. */
  private readonly sessionCosts = new Map<string, number>();
  private readonly log: Logger;

  constructor(private readonly options: JobRunnerOptions) {
    this.checkout = new Checkout(options.workspace, options.gitEnv);
    this.writableRoots = options.writableRoots ?? [...new Set(['/tmp', os.tmpdir()])];
    this.repo = options.defaultRepo;
    this.log = options.log ?? silentLogger;
  }

  get busy(): boolean {
    return this.current !== undefined;
  }

  get currentJobId(): string | undefined {
    return this.current?.job.jobId;
  }

  /** Starts the job in the background; false when another job is running. */
  start(job: AgentJob): boolean {
    if (this.current) return false;
    const running: RunningJob = { job, abort: new AbortController(), phase: 'queued', done: Promise.resolve() };
    this.current = running;
    running.done = this.lock
      .run(() => this.execute(running))
      .catch((error: unknown) => this.log.error('job crashed', { jobId: job.jobId, error: errorMessage(error) }))
      .finally(() => {
        if (this.current === running) this.current = undefined;
      });
    return true;
  }

  /** Cancels the running job with this id; false when it is not the one running. */
  cancel(jobId: string): boolean {
    const running = this.current;
    if (!running || running.job.jobId !== jobId) return false;
    if (running.phase !== 'finalize') running.abort.abort(new Error('The job was cancelled.'));
    return true;
  }

  /** Resolves once the current job, if any, has finished. */
  async idle(): Promise<void> {
    await this.current?.done;
  }

  /** Makes the checkout match origin/<branch>, cloning it first when there is none. */
  async sync(branch: string): Promise<{ headSha: string }> {
    if (this.current) throw new RunnerBusyError(this.current.job.jobId);
    return this.lock.run(async () => {
      const repo = this.repo;
      if (!repo && !(await this.checkout.exists())) throw new UnknownRepositoryError();
      await this.checkout.ensure(repo && remoteUrl(this.options.remoteBase, repo));
      if (!(await this.checkout.resolve(`refs/remotes/origin/${branch}`))) throw new BranchNotFoundError(branch);
      await this.checkout.switchTo(branch, `origin/${branch}`, { track: true });
      if (this.pendingQuestion) this.pendingQuestion.keep = false;
      const headSha = await this.checkout.head();
      await this.refreshPreview();
      return { headSha };
    });
  }

  private async execute(running: RunningJob): Promise<void> {
    const { job, abort } = running;
    const mapper = new MessageMapper(job.locale, this.options.workspace);
    const pending = this.pendingQuestion;
    this.pendingQuestion = undefined;
    this.repo = { owner: job.repo.owner, name: job.repo.name };
    let startSha: string | undefined;
    let finished: Finished = this.failed(job, 'failedError', 'The job did not start.');
    try {
      running.phase = 'checkout';
      const resume =
        job.resumeSessionId !== undefined &&
        (await this.options.agent.hasSession(job.resumeSessionId, this.options.workspace).catch(() => false));
      const sessionId = resume && job.resumeSessionId ? job.resumeSessionId : randomUUID();
      finished.sessionId = sessionId;
      this.emit({ type: 'job.started', jobId: job.jobId, sessionId });
      abort.signal.throwIfAborted();
      this.progress(job, t(job.locale, 'preparing'));
      const prepared = await this.prepareCheckout(job, abort.signal, resume ? pending : undefined);
      startSha = prepared.startSha;
      const notes: string[] = [];
      if (job.resumeSessionId !== undefined && !resume) notes.push(NOTES.conversationLost(job));
      else if (resume && pending?.sessionId === sessionId && !prepared.keptWorkingTree) {
        notes.push(NOTES.changesDiscarded);
      }
      await this.options.preview?.waitForInstall(abort.signal);
      abort.signal.throwIfAborted();
      running.phase = 'agent';
      const run = await this.runAgent(job, { sessionId, resume, notes, abort, mapper });
      running.phase = 'finalize';
      finished = await this.conclude(job, run, { sessionId, resume, startSha, cancelled: abort.signal.aborted });
    } catch (error) {
      if (abort.signal.aborted) finished = this.cancelled(job, finished);
      else {
        this.log.error('job failed', { jobId: job.jobId, error: errorMessage(error) });
        finished = { ...this.failed(job, 'failedError', errorMessage(error)), sessionId: finished.sessionId };
      }
    } finally {
      for (const event of mapper.finish(finished.summary)) this.emit({ ...event, jobId: job.jobId });
      if ((finished.outcome === 'failed' || finished.outcome === 'cancelled') && startSha !== undefined) {
        await this.checkout
          .switchTo(job.repo.workBranch, startSha, { track: false })
          .catch((error: unknown) => this.log.error('could not reset the checkout', { error: errorMessage(error) }));
      }
      if (this.current === running) this.current = undefined;
      this.emit({ type: 'job.finished', jobId: job.jobId, ...finished, summary: truncate(finished.summary, 8000) });
      await this.refreshPreview();
    }
  }

  private async prepareCheckout(
    job: AgentJob,
    signal: AbortSignal,
    pending: PendingQuestion | undefined,
  ): Promise<{ startSha: string; keptWorkingTree: boolean }> {
    const { owner, name, baseBranch, workBranch } = job.repo;
    await this.checkout.ensure(remoteUrl(this.options.remoteBase, { owner, name }), signal);
    await this.checkout.setIdentity(job.author.name, job.author.email);
    const workSha = await this.checkout.resolve(`refs/remotes/origin/${workBranch}`);
    const startSha = workSha ?? (await this.checkout.resolve(`refs/remotes/origin/${baseBranch}`));
    if (!startSha) throw new Error(`The branch ${baseBranch} does not exist in ${owner}/${name}.`);
    if (
      pending?.keep &&
      pending.workBranch === workBranch &&
      pending.startSha === startSha &&
      (await this.checkout.currentBranch()) === workBranch
    ) {
      return { startSha, keptWorkingTree: true };
    }
    const startPoint = `origin/${workSha ? workBranch : baseBranch}`;
    await this.checkout.switchTo(workBranch, startPoint, { track: workSha !== undefined });
    return { startSha, keptWorkingTree: false };
  }

  private async runAgent(
    job: AgentJob,
    run: { sessionId: string; resume: boolean; notes: string[]; abort: AbortController; mapper: MessageMapper },
  ): Promise<AgentRun> {
    const { workspace } = this.options;
    const outcome: AgentRun = {};
    const guardContext = { workspace, writableRoots: this.writableRoots, allowWorkflowEdits: job.allowWorkflowEdits };
    const request: AgentRunRequest = {
      job,
      cwd: workspace,
      prompt: buildUserPrompt(job, run.notes),
      systemPrompt: buildSystemPrompt(job, workspace),
      sessionId: run.sessionId,
      resume: run.resume,
      abortController: run.abort,
      guard: (toolName, input, cwd) => checkToolUse(toolName, input, { ...guardContext, cwd }),
      onAskUser: (question) => {
        outcome.question = question;
      },
      onStderr: (data) => this.log.warn('agent stderr', { jobId: job.jobId, data: truncate(data.trim(), 2000) }),
    };
    try {
      for await (const message of abortable(this.options.agent.run(request), run.abort.signal)) {
        for (const event of run.mapper.map(message)) this.emit({ ...event, jobId: job.jobId });
        if (message.type === 'result') outcome.result = message;
      }
    } catch (error) {
      outcome.error = error;
    }
    return outcome;
  }

  private async conclude(
    job: AgentJob,
    run: AgentRun,
    context: { sessionId: string; resume: boolean; startSha: string; cancelled: boolean },
  ): Promise<Finished> {
    const result = run.result ? readResult(run.result, job) : undefined;
    const sessionId = result?.sessionId || context.sessionId;
    const base = {
      costUsd: this.costOf(sessionId, result?.totalCostUsd, context.resume),
      numTurns: result?.numTurns ?? 0,
      sessionId,
      commits: [],
    };
    if (context.cancelled) return { ...base, outcome: 'cancelled', summary: t(job.locale, 'cancelled') };
    if (run.question) {
      // Nothing is committed: the next job resumes this session with the answer and keeps the working tree.
      this.pendingQuestion = { sessionId, workBranch: job.repo.workBranch, startSha: context.startSha, keep: true };
      return {
        ...base,
        outcome: 'needs_input',
        summary: result?.text || run.question.text,
        question: {
          text: truncate(run.question.text, 2000),
          options: run.question.options.slice(0, 8).map((option) => truncate(option, 100)),
        },
      };
    }
    if (!result) {
      const error = run.error === undefined ? 'The agent ended without a result.' : errorMessage(run.error);
      return { ...this.failed(job, 'failedError', error), ...base };
    }
    if (run.error !== undefined) {
      this.log.warn('agent ended with an error after its result', { jobId: job.jobId, error: errorMessage(run.error) });
    }
    if (!result.ok) {
      const failure = result.failure ?? 'error';
      // The chat never talks about cost: a spending cap reads as a limit, on an API key and on a subscription
      return { ...this.failed(job, FAILURE_MESSAGES[failure], result.error ?? ''), ...base, failure };
    }
    try {
      const published = await this.publish(job, context.startSha, result.text);
      const summary = [result.text || t(job.locale, 'done')];
      if (published.workflowsLeftOut) summary.push(t(job.locale, 'workflowsLeftOut'));
      return {
        ...base,
        outcome: 'succeeded',
        summary: summary.join('\n\n'),
        headSha: published.headSha,
        commits: published.commits,
      };
    } catch (error) {
      this.log.error('could not publish the changes', { jobId: job.jobId, error: errorMessage(error) });
      return { ...this.failed(job, 'failedError', `Could not publish the changes: ${errorMessage(error)}`), ...base };
    }
  }

  /** Commits what the agent left in the working tree and pushes HEAD to the work branch. */
  private async publish(
    job: AgentJob,
    startSha: string,
    summary: string,
  ): Promise<{ headSha?: string; commits: CommitInfo[]; workflowsLeftOut: boolean }> {
    const checkout = this.checkout;
    await checkout.stageAll();
    let workflowsLeftOut = false;
    if (!job.allowWorkflowEdits) {
      const blocked = (await checkout.stagedChangesSince(startSha)).filter(isWorkflowPath);
      if (blocked.length > 0) {
        // Whatever route the change took, it must not reach GitHub, where workflows run with the repository's
        // secrets. Commits the agent made are folded into one so none of them carries it.
        if ((await checkout.head()) !== startSha) await checkout.run(['reset', '--quiet', '--soft', startSha]);
        await checkout.restorePaths(startSha, blocked);
        workflowsLeftOut = true;
      }
    }
    if ((await checkout.stagedChangesSince('HEAD')).length > 0) {
      const message = commitMessage(summary);
      await checkout.commit(message.title, message.body);
    }
    const headSha = await checkout.head();
    if (headSha === startSha) return { commits: [], workflowsLeftOut };
    // Everything is read before the push, so a job that pushed is never reported as failed.
    const commits = (await checkout.commitsSince(startSha)).map((commit) => ({
      sha: commit.sha,
      title: truncate(commit.title, 300),
    }));
    this.progress(job, t(job.locale, 'publishing'));
    await checkout.push(job.repo.workBranch);
    return { headSha, commits, workflowsLeftOut };
  }

  /** This run's cost: a resumed session's total includes what its earlier runs spent. */
  private costOf(sessionId: string, totalCostUsd: number | undefined, resumed: boolean): number {
    if (totalCostUsd === undefined) return 0;
    const before = resumed ? (this.sessionCosts.get(sessionId) ?? 0) : 0;
    this.sessionCosts.set(sessionId, totalCostUsd);
    return Math.max(0, totalCostUsd - before);
  }

  private failed(job: AgentJob, message: MessageKey, error: string): Finished {
    return {
      outcome: 'failed',
      summary: t(job.locale, message),
      costUsd: 0,
      numTurns: 0,
      commits: [],
      error: truncate(error || 'Unknown error.', 2000),
    };
  }

  private cancelled(job: AgentJob, finished: Finished): Finished {
    return {
      outcome: 'cancelled',
      summary: t(job.locale, 'cancelled'),
      costUsd: finished.costUsd,
      numTurns: finished.numTurns,
      sessionId: finished.sessionId,
      commits: [],
    };
  }

  private async refreshPreview(): Promise<void> {
    await this.options.preview
      ?.refresh()
      .catch((error: unknown) => this.log.error('could not refresh the preview', { error: errorMessage(error) }));
  }

  private progress(job: AgentJob, text: string): void {
    this.emit({ type: 'job.progress', jobId: job.jobId, text: truncate(text, 500) });
  }

  private emit(event: EventInput): void {
    this.options.events.emit(event);
  }
}

/** Commit title from the first line of the summary (markdown removed, at most 72 characters); the rest is the body. */
export function commitMessage(summary: string): { title: string; body?: string } {
  const lines = summary.split(/\r?\n/);
  const index = lines.findIndex((line) => cleanTitle(line) !== '');
  if (index === -1) return { title: 'bohr: update' };
  const title = truncate(cleanTitle(lines[index] ?? ''), 72);
  const body = lines
    .slice(index + 1)
    .join('\n')
    .trim();
  return body ? { title, body } : { title };
}

function cleanTitle(line: string): string {
  return oneLine(line.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)/, '').replace(/\*\*|__|`/g, ''));
}

/** Iterates `source` until it ends or `signal` aborts, whichever comes first. */
async function* abortable<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
  });
  aborted.catch(() => {});
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const next = iterator.next();
      next.catch(() => {});
      const step = await Promise.race([next, aborted]);
      if (step.done) return;
      yield step.value;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Not awaited: an agent process that does not stop must not hold up the cancellation.
    Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

/** Runs tasks one after another, in the order they were queued. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
