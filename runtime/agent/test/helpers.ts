import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type AgentEvent, type AgentJobInput, agentJobSchema } from '@bohr/shared';
import type { AgentBackend, AgentRunRequest } from '../src/agent';

export const gitAvailable = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;

export function tempDir(prefix = 'bohr-agent-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Keeps the developer's git configuration (signing, autocrlf, hooks) out of the tests. */
export function isolatedGitEnv(dir: string): NodeJS.ProcessEnv {
  const config = path.join(dir, 'gitconfig');
  writeFileSync(config, '[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
  return { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
}

export function git(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export interface TestRemote {
  /** Value for the runner's remote base; the repository is acme/site. */
  remoteBase: string;
  bare: string;
  /** Head of main. */
  mainSha: string;
  /** Reads a git value from the bare repository, or undefined when the command fails. */
  read(args: string[]): string | undefined;
}

/** A bare repository acme/site.git whose main branch has a README and a package.json. */
export function createRemote(root: string, env: NodeJS.ProcessEnv, files: Record<string, string> = {}): TestRemote {
  const remotes = path.join(root, 'remotes');
  const bare = path.join(remotes, 'acme', 'site.git');
  mkdirSync(bare, { recursive: true });
  git(['init', '--bare', '--quiet', bare], root, env);
  const seed = path.join(root, 'seed');
  mkdirSync(seed);
  git(['init', '--quiet', '--initial-branch=main', seed], root, env);
  const content = { 'README.md': '# Site\n', 'package.json': '{ "name": "site" }\n', ...files };
  for (const [file, text] of Object.entries(content)) {
    mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    writeFileSync(path.join(seed, file), text);
  }
  git(['add', '--all'], seed, env);
  git(
    ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '--quiet', '-m', 'Initial commit'],
    seed,
    env,
  );
  git(['push', '--quiet', bare, 'HEAD:refs/heads/main'], seed, env);
  return {
    remoteBase: pathToFileURL(remotes).href,
    bare,
    mainSha: git(['rev-parse', 'HEAD'], seed, env),
    read(args) {
      try {
        return git(['--git-dir', bare, ...args], root, env);
      } catch {
        return undefined;
      }
    },
  };
}

export function makeJob(overrides: Partial<AgentJobInput> = {}): ReturnType<typeof agentJobSchema.parse> {
  return agentJobSchema.parse({
    jobId: `req_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    kind: 'change',
    prompt: 'Add a greeting',
    repo: { owner: 'acme', name: 'site', baseBranch: 'main' },
    author: { name: 'Ada (via bohr)', email: 'noreply@bohr.io' },
    model: 'claude-opus-5-5',
    maxBudgetUsd: 5,
    maxTurns: 50,
    locale: 'en',
    ...overrides,
  });
}

// SDK message fixtures. Only the fields the runner reads are realistic; the rest is filler.

export function textBlock(text: string) {
  return { type: 'text', text, citations: null };
}

export function toolUse(name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name, input };
}

export function assistant(content: unknown[], parentToolUseId: string | null = null): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    parent_tool_use_id: parentToolUseId,
    uuid: randomUUID(),
    session_id: 'session',
  } as unknown as SDKMessage;
}

export function successResult(
  result: string,
  extra: { costUsd?: number; numTurns?: number; sessionId?: string; isError?: boolean } = {},
): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 10,
    duration_api_ms: 10,
    is_error: extra.isError ?? false,
    num_turns: extra.numTurns ?? 3,
    result,
    stop_reason: 'end_turn',
    total_cost_usd: extra.costUsd ?? 0.25,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    session_id: extra.sessionId ?? 'session',
  } as unknown as SDKMessage;
}

export function errorResult(
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd',
  extra: { errors?: string[]; costUsd?: number; sessionId?: string } = {},
): SDKMessage {
  return {
    type: 'result',
    subtype,
    duration_ms: 10,
    duration_api_ms: 10,
    is_error: true,
    num_turns: 7,
    stop_reason: null,
    total_cost_usd: extra.costUsd ?? 1.5,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
    errors: extra.errors ?? [],
    uuid: randomUUID(),
    session_id: extra.sessionId ?? 'session',
  } as unknown as SDKMessage;
}

type Script = (request: AgentRunRequest) => AsyncIterable<SDKMessage>;

/** An agent backend that runs `script` instead of the SDK and records what it was asked to do. */
export function fakeAgent(script: Script, sessions: Iterable<string> = []) {
  const known = new Set(sessions);
  const requests: AgentRunRequest[] = [];
  const backend: AgentBackend & { requests: AgentRunRequest[]; sessions: Set<string> } = {
    requests,
    sessions: known,
    run(request) {
      requests.push(request);
      known.add(request.sessionId);
      return script(request);
    },
    async hasSession(sessionId) {
      return known.has(sessionId);
    },
  };
  return backend;
}

/** Rejects when `signal` aborts; stands in for an agent that keeps working until it is stopped. */
export function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function eventsOfType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}
