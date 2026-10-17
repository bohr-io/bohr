import path from 'node:path';
import {
  createSdkMcpServer,
  getSessionInfo,
  type HookCallback,
  type Options,
  query,
  type SDKMessage,
  type SDKResultMessage,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { type AgentJob, ANTHROPIC_KEY_PLACEHOLDER, type Locale, OAUTH_TOKEN_PLACEHOLDER } from '@bohr/shared';
import { z } from 'zod';
import { version } from '../package.json';
import { t } from './i18n';
import { oneLine, truncate } from './text';

export interface AgentQuestion {
  text: string;
  options: string[];
}

/** Everything one run of the agent needs; the backend turns it into an SDK query. */
export interface AgentRunRequest {
  job: AgentJob;
  cwd: string;
  prompt: string;
  /** bohr's instructions, appended to the default system prompt. */
  systemPrompt: string;
  sessionId: string;
  /** Continue the session `sessionId` instead of starting a new one with that id. */
  resume: boolean;
  abortController: AbortController;
  /** Why a tool call must not run, or undefined to let it run. */
  guard: (toolName: string, input: unknown, cwd: string) => string | undefined;
  onAskUser: (question: AgentQuestion) => void;
  onStderr?: (data: string) => void;
}

export interface AgentBackend {
  run(request: AgentRunRequest): AsyncIterable<SDKMessage>;
  /** Whether the session transcript exists in this container, so the session can be resumed. */
  hasSession(sessionId: string, cwd: string): Promise<boolean>;
}

export const ASK_USER_TOOL = 'mcp__bohr__ask_user';

/** Built-in tools that need a person at a terminal, or that would move the work out of the checkout. */
const DISALLOWED_TOOLS = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree'];

export function createAskUserTool(onAsk: (question: AgentQuestion) => void) {
  return tool(
    'ask_user',
    'Asks the user to decide something that really belongs to them, such as a choice between alternatives you cannot infer. bohr shows the question in the chat with the options as buttons; the user may also answer in their own words. After calling it, stop working and end your turn by restating the question; the answer arrives as the next message.',
    {
      question: z.string().min(1).max(2000).describe("The question, in the user's language."),
      options: z.array(z.string().min(1).max(100)).min(1).max(8).describe('Short answers the user can pick from.'),
    },
    async ({ question, options }) => {
      onAsk({ text: question, options });
      return {
        content: [
          {
            type: 'text',
            text: 'Question recorded; bohr will show it to the user. Stop now: make no further changes and end your turn by restating the question briefly.',
          },
        ],
      };
    },
  );
}

/** A PreToolUse hook that refuses the calls `guard` objects to, telling the model why. */
export function createGuardHook(guard: AgentRunRequest['guard'], fallbackCwd: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const reason = guard(input.tool_name, input.tool_input, input.cwd || fallbackCwd);
    if (reason === undefined) return {};
    return {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    };
  };
}

/**
 * Variables that would make the agent authenticate some other way than with the placeholder key, or that
 * describe an agent session the runner itself was started from (when started from a terminal session of the
 * same CLI, an inherited CLAUDE_CODE_ENTRYPOINT makes the agent wait for an API key approval nobody can give).
 */
const INHERITED_ENV_DROPPED = [
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
];

/**
 * The agent's environment: the runner's, with a placeholder credential and unattended-run settings. With the
 * owner's Claude subscription ("oauth") the official CLI authenticates with CLAUDE_CODE_OAUTH_TOKEN, and no API
 * key may be set: the CLI would prefer it over the OAuth token.
 */
export function agentEnvironment(
  inherited: NodeJS.ProcessEnv,
  job?: Pick<AgentJob, 'model' | 'baseUrl' | 'auth'>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...inherited };
  for (const name of INHERITED_ENV_DROPPED) delete env[name];
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
  const oauth = job?.auth === 'oauth';
  return {
    ...env,
    // A compatible endpoint serves only the owner's model: background tasks and subagents use it too
    ...(job?.baseUrl && !oauth
      ? {
          ANTHROPIC_BASE_URL: job.baseUrl,
          ANTHROPIC_DEFAULT_OPUS_MODEL: job.model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: job.model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: job.model,
          CLAUDE_CODE_SUBAGENT_MODEL: job.model,
        }
      : {}),
    ...(oauth
      ? { CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN_PLACEHOLDER }
      : { ANTHROPIC_API_KEY: ANTHROPIC_KEY_PLACEHOLDER }),
    IS_SANDBOX: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: `bohr-agent/${version}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function buildQueryOptions(request: AgentRunRequest): Options {
  const { job } = request;
  return {
    cwd: request.cwd,
    model: job.model,
    ...(job.effort ? { effort: job.effort } : {}),
    maxTurns: job.maxTurns,
    maxBudgetUsd: job.maxBudgetUsd,
    // The container is the sandbox, and nobody is there to approve prompts.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // The repository's CLAUDE.md and .claude/settings.json; MCP servers come only from bohr.
    settingSources: ['project'],
    strictMcpConfig: true,
    ...(request.resume ? { resume: request.sessionId } : { sessionId: request.sessionId }),
    abortController: request.abortController,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: request.systemPrompt },
    env: agentEnvironment(process.env, job),
    hooks: { PreToolUse: [{ hooks: [createGuardHook(request.guard, request.cwd)] }] },
    mcpServers: {
      bohr: createSdkMcpServer({
        name: 'bohr',
        version,
        tools: [createAskUserTool(request.onAskUser)],
        alwaysLoad: true,
      }),
    },
    disallowedTools: DISALLOWED_TOOLS,
    stderr: request.onStderr,
  };
}

/** Runs the agent with the Claude Agent SDK. */
export const sdkBackend: AgentBackend = {
  run: (request) => query({ prompt: request.prompt, options: buildQueryOptions(request) }),
  async hasSession(sessionId, cwd) {
    try {
      return (await getSessionInfo(sessionId, { dir: cwd })) !== undefined;
    } catch {
      return false;
    }
  },
};

export type MappedEvent = { type: 'job.progress'; text: string } | { type: 'job.message'; text: string };

/**
 * Turns SDK messages into progress lines and messages for the user. The latest top-level text is held back
 * until something follows it, so the final summary (which job.finished carries) is not also sent as a message.
 */
export class MessageMapper {
  private held: string | undefined;

  constructor(
    private readonly locale: Locale,
    private readonly workspace: string,
  ) {}

  map(message: SDKMessage): MappedEvent[] {
    if (message.type !== 'assistant') return [];
    const events: MappedEvent[] = [];
    const content = Array.isArray(message.message?.content) ? message.message.content : [];
    for (const block of content) {
      if (block.type === 'text') {
        const text = block.text.trim();
        if (message.parent_tool_use_id !== null || text === '') continue;
        this.release(events);
        this.held = text;
      } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        const line = progressLine(block.name, block.input, this.locale, this.workspace);
        if (line === undefined) continue;
        this.release(events);
        events.push({ type: 'job.progress', text: line });
      }
    }
    return events;
  }

  /** Releases the held text unless it is `summary`. */
  finish(summary?: string): MappedEvent[] {
    if (this.held !== undefined && summary !== undefined && oneLine(this.held) === oneLine(summary)) {
      this.held = undefined;
    }
    const events: MappedEvent[] = [];
    this.release(events);
    return events;
  }

  private release(events: MappedEvent[]): void {
    if (this.held === undefined) return;
    events.push({ type: 'job.message', text: truncate(this.held, 8000) });
    this.held = undefined;
  }
}

const SILENT_TOOLS = new Set([ASK_USER_TOOL, 'ToolSearch', 'BashOutput', 'TaskOutput', 'TaskStop', 'KillShell']);

/** A short status line for a tool call, in the user's language; undefined for calls not worth showing. */
export function progressLine(name: string, input: unknown, locale: Locale, workspace: string): string | undefined {
  const fields = isRecord(input) ? input : {};
  const text = (key: string): string | undefined => {
    const value = fields[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const file = text('file_path') ?? text('notebook_path');
  let line: string | undefined;
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      if (file) line = t(locale, 'editing', { path: displayPath(file, workspace) });
      break;
    case 'Read':
      if (file) line = t(locale, 'reading', { path: displayPath(file, workspace) });
      break;
    case 'Bash': {
      const command = text('description') ?? truncate(oneLine(text('command') ?? ''), 80);
      if (command) line = t(locale, 'running', { command });
      break;
    }
    case 'Grep':
    case 'Glob': {
      const pattern = text('pattern');
      if (pattern) line = t(locale, 'searching', { pattern: truncate(oneLine(pattern), 100) });
      break;
    }
    case 'WebSearch':
    case 'web_search': {
      const search = text('query');
      if (search) line = t(locale, 'webSearch', { query: truncate(oneLine(search), 100) });
      break;
    }
    case 'WebFetch':
    case 'web_fetch': {
      const url = text('url');
      if (url) line = t(locale, 'webFetch', { url: truncate(url, 200) });
      break;
    }
    case 'Agent':
    case 'Task': {
      const task = text('description');
      if (task) line = t(locale, 'delegating', { task: truncate(oneLine(task), 100) });
      break;
    }
    case 'TodoWrite':
      return activeTodo(fields.todos);
  }
  if (line === undefined) {
    if (SILENT_TOOLS.has(name)) return undefined;
    line = t(locale, 'using', { tool: name.replace(/^mcp__.+?__/, '') });
  }
  return truncate(line, 500);
}

function activeTodo(todos: unknown): string | undefined {
  if (!Array.isArray(todos)) return undefined;
  for (const todo of todos) {
    if (isRecord(todo) && todo.status === 'in_progress' && typeof todo.activeForm === 'string' && todo.activeForm) {
      return truncate(oneLine(todo.activeForm), 500);
    }
  }
  return undefined;
}

/** A path relative to the repository, with forward slashes; absolute when it is outside. */
function displayPath(file: string, workspace: string): string {
  const relative = path.relative(workspace, path.resolve(workspace, file));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return file;
  return relative.split(path.sep).join('/');
}

export type AgentFailure = 'budget' | 'turns' | 'error';

export interface AgentResult {
  ok: boolean;
  /** The agent's final text: its summary, or the question it asked. */
  text: string;
  failure?: AgentFailure;
  /** A short technical reason, for logs and the project Worker. */
  error?: string;
  /** Cumulative for a resumed session, as the SDK reports it. */
  totalCostUsd: number;
  numTurns: number;
  sessionId: string;
}

export function readResult(result: SDKResultMessage, job: AgentJob): AgentResult {
  const base = {
    totalCostUsd: Number.isFinite(result.total_cost_usd) ? Math.max(0, result.total_cost_usd) : 0,
    numTurns: Number.isInteger(result.num_turns) ? Math.max(0, result.num_turns) : 0,
    sessionId: result.session_id,
  };
  if (result.subtype === 'success' && !result.is_error) {
    return { ...base, ok: true, text: (result.result ?? '').trim() };
  }
  let failure: AgentFailure = 'error';
  let error: string;
  if (result.subtype === 'success') {
    error = (result.result ?? '').trim() || 'The agent stopped with an error.';
  } else if (result.subtype === 'error_max_budget_usd' || result.terminal_reason === 'budget_exhausted') {
    failure = 'budget';
    error = `Budget exhausted (limit US$ ${job.maxBudgetUsd}).`;
  } else if (result.subtype === 'error_max_turns' || result.terminal_reason === 'max_turns') {
    failure = 'turns';
    error = `Too many turns (limit ${job.maxTurns}).`;
  } else {
    error = (result.errors ?? []).join('; ').trim() || `The agent stopped (${result.subtype}).`;
  }
  return { ...base, ok: false, text: '', failure, error: truncate(error, 2000) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
