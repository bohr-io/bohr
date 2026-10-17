import os from 'node:os';
import path from 'node:path';
import type { HookCallback, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { type AgentJob, ANTHROPIC_KEY_PLACEHOLDER, OAUTH_TOKEN_PLACEHOLDER } from '@bohr/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  type AgentRunRequest,
  ASK_USER_TOOL,
  agentEnvironment,
  buildQueryOptions,
  createAskUserTool,
  createGuardHook,
  MessageMapper,
  progressLine,
  readResult,
} from '../src/agent';
import { DENY } from '../src/guards';
import { assistant, errorResult, makeJob, successResult, textBlock, toolUse } from './helpers';

const workspace = path.join(os.tmpdir(), 'bohr-agent-test', 'repo');
const inRepo = (...parts: string[]) => path.join(workspace, ...parts);

describe('progressLine', () => {
  const line = (name: string, input: unknown, locale: AgentJob['locale'] = 'en') =>
    progressLine(name, input, locale, workspace);

  it('names the file being edited, relative to the repository', () => {
    expect(line('Edit', { file_path: inRepo('src', 'App.vue') })).toBe('Editing src/App.vue');
    expect(line('Write', { file_path: inRepo('index.html') })).toBe('Editing index.html');
    expect(line('MultiEdit', { file_path: inRepo('a', 'b.ts') })).toBe('Editing a/b.ts');
    expect(line('NotebookEdit', { notebook_path: inRepo('nb.ipynb') })).toBe('Editing nb.ipynb');
    expect(line('Read', { file_path: inRepo('README.md') })).toBe('Reading README.md');
    const outside = path.join(os.tmpdir(), 'notes.txt');
    expect(line('Write', { file_path: outside })).toBe(`Editing ${outside}`);
  });

  it('describes commands, preferring their description', () => {
    expect(line('Bash', { command: 'npm run build', description: 'Build the site' })).toBe('Running: Build the site');
    expect(line('Bash', { command: 'npm ci\n  && npm test' })).toBe('Running: npm ci && npm test');
    const long = `echo ${'x'.repeat(200)}`;
    const running = line('Bash', { command: long });
    expect(running?.startsWith('Running: echo xxx')).toBe(true);
    expect(running?.length).toBe('Running: '.length + 80);
  });

  it('describes searches, web access, subagents and todos', () => {
    expect(line('Grep', { pattern: 'TODO' })).toBe('Searching TODO');
    expect(line('Glob', { pattern: '**/*.vue' })).toBe('Searching **/*.vue');
    expect(line('WebSearch', { query: 'vite allowedHosts' })).toBe('Searching the web: vite allowedHosts');
    expect(line('WebFetch', { url: 'https://vite.dev/config', prompt: 'x' })).toBe('Opening https://vite.dev/config');
    expect(line('Agent', { description: 'Check the build', prompt: 'x' })).toBe('Delegating: Check the build');
    const todos = [
      { content: 'Change header', status: 'completed', activeForm: 'Changing the header' },
      { content: 'Run build', status: 'in_progress', activeForm: 'Running the build' },
    ];
    expect(line('TodoWrite', { todos })).toBe('Running the build');
    expect(line('TodoWrite', { todos: [] })).toBeUndefined();
  });

  it('falls back to the tool name and stays quiet for bookkeeping tools', () => {
    expect(line('SomethingNew', {})).toBe('Using SomethingNew');
    expect(line('mcp__docs__search_pages', {})).toBe('Using search_pages');
    expect(line('Edit', {})).toBe('Using Edit');
    expect(line(ASK_USER_TOOL, { question: 'x', options: ['a'] })).toBeUndefined();
    expect(line('ToolSearch', { query: 'x' })).toBeUndefined();
  });

  it('speaks the job locale', () => {
    expect(line('Edit', { file_path: inRepo('src', 'App.vue') }, 'pt-BR')).toBe('Editando src/App.vue');
    expect(line('Bash', { command: 'npm test' }, 'pt-BR')).toBe('Executando: npm test');
    expect(line('Read', { file_path: inRepo('a.ts') }, 'es')).toBe('Leyendo a.ts');
    expect(line('Grep', { pattern: 'x' }, 'es')).toBe('Buscando x');
  });

  it('never exceeds 500 characters', () => {
    expect(line('Bash', { command: 'x', description: 'd'.repeat(900) })?.length).toBe(500);
  });
});

describe('MessageMapper', () => {
  it('turns tool calls into progress and top-level text into messages', () => {
    const mapper = new MessageMapper('en', workspace);
    expect(mapper.map(assistant([textBlock('I will change the header.')]))).toEqual([]);
    expect(mapper.map(assistant([toolUse('Edit', { file_path: inRepo('src', 'Header.vue') })]))).toEqual([
      { type: 'job.message', text: 'I will change the header.' },
      { type: 'job.progress', text: 'Editing src/Header.vue' },
    ]);
    expect(mapper.map(assistant([textBlock('Done:\n- Header is blue')]))).toEqual([]);
    expect(mapper.finish('Done:\n- Header is blue')).toEqual([]);
  });

  it('releases the held text when it is not the summary', () => {
    const mapper = new MessageMapper('en', workspace);
    mapper.map(assistant([textBlock('Working on it.')]));
    expect(mapper.finish('Something else')).toEqual([{ type: 'job.message', text: 'Working on it.' }]);
    expect(mapper.finish('Something else')).toEqual([]);
  });

  it('shows subagent tool calls but not subagent text', () => {
    const mapper = new MessageMapper('en', workspace);
    const fromSubagent = assistant(
      [textBlock('internal notes'), toolUse('Grep', { pattern: 'color' })],
      'toolu_parent',
    );
    expect(mapper.map(fromSubagent)).toEqual([{ type: 'job.progress', text: 'Searching color' }]);
    expect(mapper.finish(undefined)).toEqual([]);
  });

  it('ignores other messages and empty text, and caps message length', () => {
    const mapper = new MessageMapper('en', workspace);
    expect(mapper.map(successResult('x'))).toEqual([]);
    expect(mapper.map(assistant([textBlock('   ')]))).toEqual([]);
    expect(mapper.map({ type: 'assistant', message: {}, parent_tool_use_id: null } as unknown as SDKMessage)).toEqual(
      [],
    );
    mapper.map(assistant([textBlock('y'.repeat(9000))]));
    const [message] = mapper.finish();
    expect(message?.text.length).toBe(8000);
  });
});

describe('readResult', () => {
  const job = makeJob({ maxBudgetUsd: 2, maxTurns: 40 });
  const read = (message: unknown) => readResult(message as SDKResultMessage, job);

  it('reads a successful run', () => {
    expect(read(successResult('  Summary\n- a  ', { costUsd: 0.5, numTurns: 4, sessionId: 's1' }))).toEqual({
      ok: true,
      text: 'Summary\n- a',
      totalCostUsd: 0.5,
      numTurns: 4,
      sessionId: 's1',
    });
  });

  it('explains why a run failed', () => {
    expect(read(errorResult('error_max_budget_usd'))).toMatchObject({
      ok: false,
      failure: 'budget',
      error: 'Budget exhausted (limit US$ 2).',
      totalCostUsd: 1.5,
      numTurns: 7,
    });
    expect(read(errorResult('error_max_turns'))).toMatchObject({
      failure: 'turns',
      error: 'Too many turns (limit 40).',
    });
    expect(read(errorResult('error_during_execution', { errors: ['boom', 'bang'] }))).toMatchObject({
      failure: 'error',
      error: 'boom; bang',
    });
    expect(read(errorResult('error_during_execution'))).toMatchObject({
      error: 'The agent stopped (error_during_execution).',
    });
    expect(read(successResult('API Error: 401 invalid x-api-key', { isError: true }))).toMatchObject({
      ok: false,
      failure: 'error',
      error: 'API Error: 401 invalid x-api-key',
    });
  });

  it('never reports a negative or unknown cost', () => {
    const odd = { ...(successResult('x') as object), total_cost_usd: Number.NaN, num_turns: -2 };
    expect(read(odd)).toMatchObject({ totalCostUsd: 0, numTurns: 0 });
  });
});

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    job: makeJob({ model: 'claude-test', maxTurns: 12, maxBudgetUsd: 3 }),
    cwd: workspace,
    prompt: 'Make the header blue',
    systemPrompt: 'bohr instructions',
    sessionId: '7b2d3a52-56a5-4f53-9d4b-46c7cbbc1b4b',
    resume: false,
    abortController: new AbortController(),
    guard: () => undefined,
    onAskUser: () => {},
    ...overrides,
  };
}

describe('buildQueryOptions', () => {
  it('runs the agent unattended in the workspace with bohr instructions', () => {
    const options = buildQueryOptions(request());
    expect(options).toMatchObject({
      cwd: workspace,
      model: 'claude-test',
      maxTurns: 12,
      maxBudgetUsd: 3,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project'],
      strictMcpConfig: true,
      sessionId: '7b2d3a52-56a5-4f53-9d4b-46c7cbbc1b4b',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'bohr instructions' },
    });
    expect(options.resume).toBeUndefined();
    expect(options.disallowedTools).toContain('AskUserQuestion');
    expect(options.mcpServers?.bohr).toMatchObject({ type: 'sdk', name: 'bohr' });
  });

  it('resumes a session when asked to', () => {
    const options = buildQueryOptions(request({ resume: true }));
    expect(options.resume).toBe('7b2d3a52-56a5-4f53-9d4b-46c7cbbc1b4b');
    expect(options.sessionId).toBeUndefined();
  });

  it("passes the owner's effort, and a compatible endpoint serving their model everywhere", () => {
    expect(buildQueryOptions(request()).effort).toBeUndefined();
    expect(buildQueryOptions(request()).env?.ANTHROPIC_BASE_URL).toBeUndefined();
    const job = makeJob({ model: 'kimi-k2', effort: 'high', baseUrl: 'https://llm.example.com/anthropic' });
    const options = buildQueryOptions(request({ job }));
    expect(options.effort).toBe('high');
    expect(options.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://llm.example.com/anthropic',
      ANTHROPIC_API_KEY: ANTHROPIC_KEY_PLACEHOLDER,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2',
    });
  });

  it('gives the agent placeholders, never real credentials', () => {
    const env = buildQueryOptions(request()).env ?? {};
    expect(env.ANTHROPIC_API_KEY).toBe(ANTHROPIC_KEY_PLACEHOLDER);
    expect(env.IS_SANDBOX).toBe('1');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
  });

  it('drops real credentials and the variables of a session the runner was started from', () => {
    const env = agentEnvironment({
      PATH: '/usr/bin',
      HOME: '/root',
      ANTHROPIC_API_KEY: 'sk-ant-real',
      ANTHROPIC_AUTH_TOKEN: 'real-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'real-oauth',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/root',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
      ANTHROPIC_API_KEY: ANTHROPIC_KEY_PLACEHOLDER,
      IS_SANDBOX: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'bohr-agent/0.3.9',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it("authenticates with the owner's Claude subscription through the CLI's OAuth token placeholder", () => {
    const env = agentEnvironment(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-ant-real',
        ANTHROPIC_BASE_URL: 'https://elsewhere.example.com',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-real-token',
      },
      makeJob({ auth: 'oauth', baseUrl: 'https://llm.example.com/anthropic' }),
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH_TOKEN_PLACEHOLDER);
    // An API key would take precedence over the OAuth token, and the subscription only works with Anthropic
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_OPUS_MODEL');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    // API key jobs (the default) never see an inherited OAuth token
    const apiKey = agentEnvironment({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-real-token' }, makeJob());
    expect(apiKey).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(apiKey.ANTHROPIC_API_KEY).toBe(ANTHROPIC_KEY_PLACEHOLDER);
    expect(buildQueryOptions(request({ job: makeJob({ auth: 'oauth' }) })).env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(
      OAUTH_TOKEN_PLACEHOLDER,
    );
  });

  it('passes the cancel signal through', () => {
    const abortController = new AbortController();
    expect(buildQueryOptions(request({ abortController })).abortController).toBe(abortController);
  });
});

describe('createGuardHook', () => {
  const signal = new AbortController().signal;
  const input = (toolName: string, toolInput: unknown) => ({
    hook_event_name: 'PreToolUse' as const,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_1',
    session_id: 's',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/workspace/repo/src',
  });

  it('denies what the guard refuses, with its reason', async () => {
    const guard = vi.fn((tool: string) => (tool === 'Bash' ? DENY.push : undefined));
    const hook: HookCallback = createGuardHook(guard, workspace);
    expect(await hook(input('Bash', { command: 'git push' }), 'toolu_1', { signal })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: DENY.push,
      },
    });
    expect(await hook(input('Read', { file_path: 'x' }), 'toolu_2', { signal })).toEqual({});
    expect(guard).toHaveBeenCalledWith('Bash', { command: 'git push' }, '/workspace/repo/src');
  });

  it('is wired into the query options', async () => {
    const options = buildQueryOptions(request({ guard: (tool) => (tool === 'Bash' ? 'no' : undefined) }));
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    expect(await hook?.(input('Bash', { command: 'ls' }), 'toolu_1', { signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' },
    });
  });
});

describe('ask_user tool', () => {
  it('records the question and tells the agent to stop', async () => {
    const onAsk = vi.fn();
    const askUser = createAskUserTool(onAsk);
    expect(askUser.name).toBe('ask_user');
    const result = await askUser.handler({ question: 'Which blue?', options: ['Navy', 'Sky'] }, {});
    expect(onAsk).toHaveBeenCalledWith({ text: 'Which blue?', options: ['Navy', 'Sky'] });
    expect(JSON.stringify(result.content)).toMatch(/Stop now/);
  });

  it('limits questions and options to what the chat can show', () => {
    const { question, options } = createAskUserTool(() => {}).inputSchema;
    expect(question.safeParse('x'.repeat(2001)).success).toBe(false);
    expect(options.safeParse([]).success).toBe(false);
    expect(options.safeParse(Array.from({ length: 9 }, (_, i) => `o${i}`)).success).toBe(false);
    expect(options.safeParse(['y'.repeat(101)]).success).toBe(false);
    expect(options.safeParse(['Navy', 'Sky']).success).toBe(true);
  });
});
