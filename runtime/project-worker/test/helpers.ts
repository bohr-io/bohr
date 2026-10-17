import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { AgentEvent, AgentJob, RunnerHealth } from '@bohr/shared';
import type { TelegramUpdate } from '@bohr/telegram';
import { type ContainerHost, type RunnerApi, RunnerError } from '../src/container';
import { deps } from '../src/deps';
import worker from '../src/index';
import type { Project } from '../src/project';
import type { RepoApi } from '../src/repo';

export const OWNER = { id: 1001, first_name: 'Ana', language_code: 'pt-br' };
export const GUEST = { id: 2002, first_name: 'Bruno', language_code: 'pt-br' };
export const sha = (char: string) => char.repeat(40);
export const CLAUDE_TOKEN = `sk-ant-oat01-${'z'.repeat(40)}`;

export class FakeContainer implements ContainerHost {
  running = false;
  starts = 0;
  jobs: AgentJob[] = [];
  cancelled: string[] = [];
  synced: string[] = [];
  previewRequests: string[] = [];
  health: RunnerHealth | null = { ok: true, version: 'test', busy: false, lastSeq: 0 };
  pendingEvents: AgentEvent[] = [];
  busyOnce = false;
  /** Calls to the runner's Claude sign-in endpoints, and the error the next start answers with. */
  logins: string[] = [];
  loginError: RunnerError | null = null;

  async start() {
    this.running = true;
    this.starts++;
  }

  readonly runner: RunnerApi = {
    health: async () => this.health,
    startJob: async (job) => {
      if (this.busyOnce) {
        this.busyOnce = false;
        return 'busy';
      }
      this.jobs.push(job);
      this.health = { ok: true, version: 'test', busy: true, jobId: job.jobId, lastSeq: this.health?.lastSeq ?? 0 };
      return 'accepted';
    },
    cancel: async (jobId) => {
      this.cancelled.push(jobId);
    },
    events: async (after) => ({
      events: this.pendingEvents.filter((event) => event.seq > after),
      lastSeq: this.pendingEvents.at(-1)?.seq ?? after,
    }),
    gitSync: async (branch) => {
      this.synced.push(branch);
      return sha('9');
    },
    restartPreview: async () => {},
    previewStatus: async () => this.preview,
    claudeLoginStart: async () => {
      this.logins.push('start');
      if (this.loginError) throw this.loginError;
      return { loginId: 'login_0123456789', url: 'https://claude.com/cai/oauth/authorize?code=true&state=s' };
    },
    claudeLoginFinish: async (loginId, code) => {
      this.logins.push(`finish ${loginId}`);
      if (loginId !== 'login_0123456789') throw new RunnerError(404, 'unknown_login', 'This sign-in expired.');
      if (code !== 'good-code#state') throw new RunnerError(422, 'code_rejected', 'OAuth error: Invalid code');
      return { token: CLAUDE_TOKEN };
    },
    claudeLoginCancel: async (loginId) => {
      this.logins.push(`cancel ${loginId}`);
    },
  };

  /** What the runner reports about the preview (GET /preview). */
  preview: { status: string; port?: number; reason?: string; log: string } | null = null;
  /** Ports that refuse connections (a dev server that only listens on localhost, or an old runner). */
  refusedPorts = new Set<number>();

  stops = 0;

  async stop() {
    this.stops++;
    this.running = false;
  }

  async fetchPort(port: number, request: Request) {
    this.previewRequests.push(`${port}${new URL(request.url).pathname}`);
    // Like Cloudflare: containers take plain HTTP only
    if (new URL(request.url).protocol !== 'http:') {
      throw new Error('Connecting to a container using HTTPS is not currently supported; use HTTP instead.');
    }
    if (this.refusedPorts.has(port)) throw new Error(`connection refused on ${port}`);
    return new Response(`preview ${new URL(request.url).pathname}`, { headers: { 'content-type': 'text/plain' } });
  }
}

export type RepoCall = { method: keyof RepoApi; args: unknown[] };

export class FakeRepo implements RepoApi {
  calls: RepoCall[] = [];
  branches = new Map<string, string>([['main', sha('a')]]);
  mergeError: Error | null = null;
  run: { status: string | null; conclusion: string | null; url: string } | null = null;
  nextPull = 41;

  private record(method: keyof RepoApi, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async branchSha(branch: string) {
    this.record('branchSha', branch);
    return this.branches.get(branch) ?? null;
  }
  async resetBranch(branch: string, target: string) {
    this.record('resetBranch', branch, target);
    this.branches.set(branch, target);
  }
  async openPullRequest(input: { head: string; base: string; title: string; body: string }) {
    this.record('openPullRequest', input);
    this.nextPull++;
    return {
      number: this.nextPull,
      nodeId: `PR_${this.nextPull}`,
      url: `https://github.com/acme/store/pull/${this.nextPull}`,
    };
  }
  async mergePullRequest(number: number, input: { sha: string; title: string }) {
    this.record('mergePullRequest', number, input);
    if (this.mergeError) throw this.mergeError;
    const merged = sha(String(number % 10));
    this.branches.set('main', merged);
    return { sha: merged };
  }
  async revertPullRequest(nodeId: string, input: { title: string; body: string }) {
    this.record('revertPullRequest', nodeId, input);
    this.nextPull++;
    return {
      number: this.nextPull,
      nodeId: `PR_${this.nextPull}`,
      url: `https://github.com/acme/store/pull/${this.nextPull}`,
      headSha: sha('e'),
    };
  }
  async latestWorkflowRun(branch: string, commit: string) {
    this.record('latestWorkflowRun', branch, commit);
    return this.run;
  }
  /** Files by path, the same at every ref. */
  files = new Map<string, string>();
  async readFile(path: string, ref: string) {
    this.record('readFile', path, ref);
    const content = this.files.get(path);
    return content === undefined ? null : { content, sha: `blob-${path}` };
  }
  async writeFile(input: { path: string; branch: string; content: string; message: string; sha?: string }) {
    this.record('writeFile', input);
    this.files.set(input.path, input.content);
    this.branches.set(input.branch, sha('f'));
    return { commitSha: sha('f') };
  }
  async listFiles(directory: string, ref: string) {
    this.record('listFiles', directory, ref);
    return [...this.files.keys()]
      .filter((path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/'))
      .sort()
      .map((path) => ({ path, sha: `blob-${path}` }));
  }
  async deleteFile(input: { path: string; branch: string; message: string; sha: string }) {
    this.record('deleteFile', input);
    this.files.delete(input.path);
    this.branches.set(input.branch, sha('d'));
    return { commitSha: sha('d') };
  }
}

export type TelegramCall = { method: string; body: Record<string, unknown> };

/** Fakes Telegram (and anything else) behind deps.fetch; `aliases` answers the instance's identity lookups. */
export function fakeNetwork(aliases: Record<string, string[]> = {}) {
  const telegram: TelegramCall[] = [];
  // Read inside the Durable Object's context: its bodies cannot be read from the test later
  const other: { url: string; headers: Headers; body: string }[] = [];
  let messageId = 100;
  deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'api.telegram.org') {
      const method = url.pathname.split('/').pop() ?? '';
      const body = (await request.json()) as Record<string, unknown>;
      telegram.push({ method, body });
      if (method === 'getMe') {
        return Response.json({
          ok: true,
          result: { id: 777, is_bot: true, first_name: 'Loja', username: 'loja_aurora_bot' },
        });
      }
      if (method === 'sendMessage') {
        messageId++;
        return Response.json({
          ok: true,
          result: { message_id: messageId, date: 1, chat: { id: body.chat_id, type: 'private' }, text: body.text },
        });
      }
      return Response.json({ ok: true, result: true });
    }
    const body = await request.text();
    other.push({ url: request.url, headers: new Headers(request.headers), body });
    if (url.pathname === '/api/runtime/v1/identity') {
      const { memberKey } = JSON.parse(body) as { memberKey: string };
      return Response.json({ keys: [memberKey, ...(aliases[memberKey] ?? [])] });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  return {
    telegram,
    other,
    sent: (method = 'sendMessage') => telegram.filter((call) => call.method === method),
    texts: () =>
      telegram
        .filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText')
        .map((call) => String(call.body.text)),
  };
}

let counter = 0;

/**
 * A fresh project (its own Durable Object) with fakes wired in. It starts from a repository the agent already
 * prepared (an import succeeded) unless `imported` is false.
 */
/** Times the Durable Object asked to restart (deps.restartObject); real aborts would end the test's object. */
export const restarts: number[] = [];

export function setup(options: { imported?: boolean } = {}) {
  counter++;
  const projectId = `test-${Date.now()}-${counter}`;
  const container = new FakeContainer();
  const repo = new FakeRepo();
  deps.container = () => container;
  deps.repo = () => repo;
  deps.now = () => new Date();
  deps.alarmAt = (delayMs) => Date.now() + 3_600_000 + delayMs;
  restarts.length = 0;
  deps.restartObject = () => {
    restarts.push(Date.now());
  };
  const network = fakeNetwork({ 'tg:4004': ['u:web-dora'] });
  const testEnv = { ...env, PROJECT_ID: projectId };
  const stub = env.PROJECT.getByName(projectId);
  const prepared =
    options.imported === false
      ? Promise.resolve()
      : runInDurableObject(stub, (instance: Project) => instance.store.set('imported', 1));
  let updateId = 0;
  let messageId = 0;

  const webhook = async (update: Omit<TelegramUpdate, 'update_id'>, secret = env.TELEGRAM_WEBHOOK_SECRET ?? '') => {
    await prepared;
    return worker.fetch(
      new Request('https://bohr-project.acme.workers.dev/__bohr/telegram', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: ++updateId, ...update }),
      }),
      testEnv,
    );
  };

  const say = (from: typeof OWNER, text: string, chatId = from.id) =>
    webhook({
      message: {
        message_id: ++messageId,
        date: 1,
        chat: { id: chatId, type: 'private' },
        from: { ...from, is_bot: false },
        text,
      },
    });

  const tap = (from: typeof OWNER, data: string, chatId = from.id) =>
    webhook({
      callback_query: {
        id: `cb${++updateId}`,
        from: { ...from, is_bot: false },
        message: { message_id: 1, chat: { id: chatId, type: 'private' }, date: 1 },
        data,
      },
    });

  const inside = async <T>(fn: (project: Project) => T | Promise<T>) => {
    await prepared;
    return runInDurableObject(stub, (instance: Project) => fn(instance));
  };

  const alarm = async () => {
    await prepared;
    return runDurableObjectAlarm(stub);
  };

  return { projectId, testEnv, stub, container, repo, network, webhook, say, tap, inside, alarm, ready: prepared };
}

export function finished(
  jobId: string,
  seq: number,
  fields: Partial<Extract<AgentEvent, { type: 'job.finished' }>> = {},
) {
  return {
    type: 'job.finished' as const,
    jobId,
    seq,
    at: new Date().toISOString(),
    outcome: 'succeeded' as const,
    summary: '- O botão Comprar agora é verde',
    costUsd: 0.42,
    numTurns: 7,
    sessionId: 'session-1',
    headSha: sha('b'),
    commits: [{ sha: sha('b'), title: 'Botão verde' }],
    ...fields,
  };
}

export async function eventually<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Condition not met in time');
}
