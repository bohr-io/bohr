import { z } from 'zod';
import { MAX_BUDGET_USD, WORK_BRANCH } from './defaults';
import { localeSchema } from './locales';

// Contract between the project Worker (a Durable Object that owns the container) and the agent
// runner inside the container.
//
// Project Worker -> runner: HTTP on AGENT_PORT through `ctx.container.getTcpPort(AGENT_PORT)`.
// Runner -> project Worker: HTTP to INTERNAL_HOST, which the Durable Object intercepts with
// `ctx.container.interceptOutboundHttp(INTERNAL_HOST, ...)`, so it never leaves Cloudflare.

/** Port of the runner's control server inside the container. */
export const AGENT_PORT = 4840;
/**
 * Port of the runner's preview proxy: it listens on every interface and relays to the dev server on the
 * loopback, so the project Worker reaches dev servers that only listen on localhost.
 */
export const PREVIEW_PROXY_PORT = 4841;
/** Host the runner posts events to; intercepted by the project Worker. */
export const INTERNAL_HOST = 'bohr.internal';
/** Path on INTERNAL_HOST that receives `{ events: AgentEvent[] }`. */
export const AGENT_EVENTS_PATH = '/v1/agent/events';
/** Where the runner keeps the repository checkout. */
export const WORKSPACE_DIR = '/workspace/repo';
/** Preview settings in the repository, written by the agent during the import. */
export const PREVIEW_CONFIG_PATH = '.bohr/preview.json';
/** Placeholder the container sees instead of the Anthropic key; the project Worker swaps in the real one. */
export const ANTHROPIC_KEY_PLACEHOLDER = 'sk-ant-bohr-placeholder';
/**
 * Placeholder the container sees instead of the owner's Claude subscription token (CLAUDE_CODE_OAUTH_TOKEN);
 * the project Worker swaps in the real one.
 */
export const OAUTH_TOKEN_PLACEHOLDER = 'sk-ant-oat01-bohr-placeholder';
/** Placeholder password in the git remote URL; the project Worker swaps in a repository token. */
export const GIT_TOKEN_PLACEHOLDER = 'bohr-placeholder';

const branchName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/);
const githubName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);

export const previewConfigSchema = z.object({
  /** Runs once after each checkout change, e.g. "npm ci". */
  install: z.string().min(1).max(1000).optional(),
  /** Long-running dev server, e.g. "npm run dev -- --host 0.0.0.0 --port 8080". */
  command: z.string().min(1).max(1000),
  /** Port the dev server listens on, inside the container. */
  port: z
    .number()
    .int()
    .min(1024)
    .max(65535)
    .refine((port) => port !== AGENT_PORT, `Port ${AGENT_PORT} is reserved for the bohr agent.`),
  /** Extra environment variables for install and command (not secrets). */
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096)).optional(),
});
export type PreviewConfig = z.infer<typeof previewConfigSchema>;

/** Effort levels the Agent SDK accepts; the model's default when unset. */
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export const agentJobSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** "import" prepares a repository for bohr the first time; "change" applies a user request. */
  kind: z.enum(['import', 'change']),
  /** The user's request, in their own words. */
  prompt: z.string().min(1).max(20_000),
  repo: z.object({
    owner: githubName,
    name: githubName,
    /** Production branch. */
    baseBranch: branchName,
    /** Branch the agent commits to; the preview runs from it. */
    workBranch: branchName.default(WORK_BRANCH),
  }),
  /** Commit author: the member who made the request. */
  author: z.object({
    name: z.string().min(1).max(200),
    email: z.string().min(3).max(320),
  }),
  model: z.string().min(1).max(100),
  effort: z.enum(AGENT_EFFORTS).optional(),
  /** An endpoint compatible with the Anthropic API (its base URL), instead of Anthropic's. */
  baseUrl: z.string().url().startsWith('https://').optional(),
  /**
   * How the agent authenticates: "api_key" (ANTHROPIC_API_KEY) or "oauth", the owner's Claude subscription
   * through the official CLI (CLAUDE_CODE_OAUTH_TOKEN). Either way the container only holds a placeholder.
   */
  auth: z.enum(['api_key', 'oauth']).default('api_key'),
  maxBudgetUsd: z.number().positive().max(MAX_BUDGET_USD),
  maxTurns: z.number().int().positive().max(1000),
  /** Agent session to continue, so an adjustment keeps the earlier conversation. */
  resumeSessionId: z.string().min(1).max(200).optional(),
  locale: localeSchema,
  /** Changes under .github/workflows are refused unless the request allows them. */
  allowWorkflowEdits: z.boolean().default(false),
  /** Shown to the agent so it can talk about the project. */
  context: z
    .object({
      projectName: z.string().max(200).optional(),
      productionUrl: z.string().url().optional(),
      previewUrl: z.string().url().optional(),
      requesterName: z.string().max(200).optional(),
      /**
       * How production deploys: "wrangler" from GitHub Actions with the CLOUDFLARE_API_TOKEN and
       * CLOUDFLARE_ACCOUNT_ID repository secrets (the owner's account), or "bohr-cloud" with
       * bohr-io/deploy-action (managed hosting, GitHub OIDC, no secrets).
       */
      deployTarget: z.enum(['wrangler', 'bohr-cloud']).optional(),
    })
    .default({}),
});
export type AgentJob = z.infer<typeof agentJobSchema>;
export type AgentJobInput = z.input<typeof agentJobSchema>;

export const JOB_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'needs_input'] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

export const JOB_FAILURES = ['budget', 'turns', 'error'] as const;
export type JobFailure = (typeof JOB_FAILURES)[number];

/** not_configured: there is no PREVIEW_CONFIG_PATH. invalid: it cannot be read. no_checkout: nothing cloned yet. */
export const PREVIEW_STOP_REASONS = ['not_configured', 'invalid', 'no_checkout'] as const;
export type PreviewStopReason = (typeof PREVIEW_STOP_REASONS)[number];

const eventBase = { at: z.string().datetime(), seq: z.number().int().nonnegative() };
const jobEventBase = { ...eventBase, jobId: z.string().min(1).max(64) };

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job.started'), ...jobEventBase, sessionId: z.string().max(200).optional() }),
  /** A short status line ("Editing src/App.vue", "Running npm run build"). */
  z.object({ type: z.literal('job.progress'), ...jobEventBase, text: z.string().max(500) }),
  /** Text the agent addressed to the user during the run. */
  z.object({ type: z.literal('job.message'), ...jobEventBase, text: z.string().max(8000) }),
  z.object({
    type: z.literal('job.finished'),
    ...jobEventBase,
    outcome: z.enum(JOB_OUTCOMES),
    /** What changed, for the user, in their language. */
    summary: z.string().max(8000),
    costUsd: z.number().nonnegative(),
    numTurns: z.number().int().nonnegative(),
    sessionId: z.string().max(200).optional(),
    /** Head of the work branch after the push; absent when nothing was pushed. */
    headSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    commits: z
      .array(z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), title: z.string().max(300) }))
      .max(200)
      .default([]),
    /** Set when outcome is "needs_input": the choice the agent wants the user to make. */
    question: z.object({ text: z.string().max(2000), options: z.array(z.string().max(100)).max(8) }).optional(),
    error: z.string().max(2000).optional(),
    /** Why a failed run stopped: its spending cap ("budget"), its turn limit, or an error. */
    failure: z.enum(JOB_FAILURES).optional(),
  }),
  z.object({
    type: z.literal('preview.status'),
    ...eventBase,
    status: z.enum(['starting', 'running', 'failed', 'stopped']),
    port: z.number().int().optional(),
    /** Last lines of the dev server output when it failed. */
    log: z.string().max(4000).optional(),
    /** Why the preview is stopped: "not_configured" when the checkout has no PREVIEW_CONFIG_PATH. */
    reason: z.enum(PREVIEW_STOP_REASONS).optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type JobFinishedEvent = Extract<AgentEvent, { type: 'job.finished' }>;

export const agentEventBatchSchema = z.object({ events: z.array(agentEventSchema).min(1).max(100) });

/** Runner state, from `GET /health`. */
export const runnerHealthSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  busy: z.boolean(),
  jobId: z.string().optional(),
  /** Highest event seq the runner has produced, so the project Worker can tell whether it missed events. */
  lastSeq: z.number().int().nonnegative(),
});
export type RunnerHealth = z.infer<typeof runnerHealthSchema>;

/** Body of `POST /git/sync`: make the checkout match the remote branch. */
export const gitSyncSchema = z.object({ branch: branchName });
export const gitSyncResultSchema = z.object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) });

// Connecting the owner's Claude subscription. The official Claude Code CLI runs `claude setup-token` inside
// the container: bohr relays the authorization URL it prints and the code the user pastes back, and gets the
// long-lived token the CLI creates. bohr itself never talks OAuth.

export const claudeLoginIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
/** What claude.ai shows after the authorization; the user pastes it back. */
export const claudeLoginCodeSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\s\p{Cc}]+$/u, 'The code has no spaces or control characters.');
/** Shape of the long-lived token `claude setup-token` creates. */
export const CLAUDE_OAUTH_TOKEN_PATTERN = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/;

/** Answer of `POST /claude-login/start`. */
export const claudeLoginStartResultSchema = z.object({ loginId: claudeLoginIdSchema, url: z.string().url() });
/** Body of `POST /claude-login/finish`. */
export const claudeLoginFinishSchema = z.object({ loginId: claudeLoginIdSchema, code: claudeLoginCodeSchema });
export const claudeLoginFinishResultSchema = z.object({ token: z.string().regex(CLAUDE_OAUTH_TOKEN_PATTERN) });
/** Body of `POST /claude-login/cancel`. */
export const claudeLoginCancelSchema = z.object({ loginId: claudeLoginIdSchema });

/** Runner control endpoints, relative to the runner's base URL. */
export const RUNNER_PATHS = {
  /** POST, no body: starts `claude setup-token`, answers { loginId, url }. */
  claudeLoginStart: '/claude-login/start',
  /** POST { loginId, code }: answers { token }. */
  claudeLoginFinish: '/claude-login/finish',
  /** POST { loginId }. */
  claudeLoginCancel: '/claude-login/cancel',
  health: '/health',
  jobs: '/jobs',
  cancel: (jobId: string) => `/jobs/${encodeURIComponent(jobId)}/cancel`,
  events: '/events',
  gitSync: '/git/sync',
  previewRestart: '/preview/restart',
  previewStatus: '/preview/status',
} as const;
