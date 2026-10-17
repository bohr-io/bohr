import { z } from 'zod';
import { MAX_BUDGET_USD, MIN_BUDGET_USD } from './defaults';
import { localeSchema } from './locales';
import { HOMOLOG_STATUSES, RELEASE_STATUSES, REQUEST_STATUSES } from './requests';

// API the project Worker offers to the instance's web interface. The instance signs each call with a
// short-lived ES256 JWT (see RuntimeTokenClaims); the project Worker verifies it with the instance's
// public key, which it received at provisioning.

export const RUNTIME_API_PREFIX = '/__bohr/api/v1';
export const RUNTIME_TOKEN_TTL_SECONDS = 300;

export type RuntimeTokenClaims = {
  /** The instance URL. */
  iss: string;
  /** `project:<projectId>`. */
  aud: string;
  /** Member key of the caller (see memberKey). */
  sub: string;
  /** Other keys of the same person (their instance user key when sub is a Telegram key). */
  aliases?: string[];
  /** Display name. */
  name: string;
  /** Preferred language of the caller. */
  locale?: string;
  iat: number;
  exp: number;
};

export const runtimeAudience = (projectId: string) => `project:${projectId}`;

export const ROLES = ['owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const memberViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  joinedAt: z.string(),
});
export type MemberView = z.infer<typeof memberViewSchema>;

export const requestViewSchema = z.object({
  id: z.string(),
  status: z.enum(REQUEST_STATUSES),
  text: z.string(),
  author: z.object({ key: z.string(), name: z.string() }),
  source: z.enum(['telegram', 'web']),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  summary: z.string().nullable(),
  costUsd: z.number().nullable(),
  /** Latest status line while it runs. */
  progress: z.string().nullable(),
});
export type RequestView = z.infer<typeof requestViewSchema>;

/**
 * Whether the agent prepared the repository for bohr (the import: preview and deploy configuration).
 * never: no import ran yet. running: one is queued, running or waiting for an answer. done: it finished.
 * failed: the last one failed or was cancelled.
 */
export const IMPORT_STATUSES = ['never', 'running', 'done', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * The preview as the project last saw it. unknown: nothing reported yet (or the workspace is asleep).
 * not_configured: the work branch has no .bohr/preview.json, so there is nothing to start.
 */
export const PREVIEW_STATES = ['unknown', 'not_configured', 'starting', 'running', 'failed', 'stopped'] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export const projectStateSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    repository: z.string(),
    productionBranch: z.string(),
    productionUrl: z.string().nullable(),
    previewUrl: z.string().nullable(),
    agentEnabled: z.boolean(),
    /** Absent from older project Workers. */
    importStatus: z.enum(IMPORT_STATUSES).optional(),
    /** Absent from older project Workers. */
    previewState: z.enum(PREVIEW_STATES).optional(),
  }),
  you: z.object({ key: z.string(), role: z.enum(ROLES) }),
  homolog: z.object({
    status: z.enum(HOMOLOG_STATUSES),
    /** Increases with every change to the preview; decisions must name the version they saw. */
    version: z.number().int().nonnegative(),
    headSha: z.string().nullable(),
    changes: z.array(z.object({ requestId: z.string(), summary: z.string() })),
  }),
  current: requestViewSchema.nullable(),
  queue: z.array(requestViewSchema),
  releases: z.array(
    z.object({
      id: z.string(),
      status: z.enum(RELEASE_STATUSES),
      pullRequest: z.number().int().nullable(),
      commitSha: z.string().nullable(),
      createdAt: z.string(),
      summary: z.string(),
    }),
  ),
  settings: z.object({
    model: z.string(),
    maxBudgetUsd: z.number(),
    maxTurns: z.number().int(),
    locale: localeSchema,
  }),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

/** One entry of the conversation, as both the bot and the web chat show it. */
export const chatEntrySchema = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  kind: z.enum(['user', 'agent', 'progress', 'system']),
  requestId: z.string().nullable(),
  author: z.object({ key: z.string(), name: z.string() }).nullable(),
  text: z.string(),
  /** Decisions the reader can take from this entry. */
  actions: z.array(z.enum(['approve', 'discard', 'cancel', 'answer'])).default([]),
  /** Options of a question the agent asked (action "answer"). */
  options: z.array(z.string()).default([]),
});
export type ChatEntry = z.infer<typeof chatEntrySchema>;

export const postMessageSchema = z.object({ text: z.string().trim().min(1).max(20_000) });
export const decisionSchema = z.object({
  action: z.enum(['approve', 'discard']),
  /** The preview version the member reviewed. */
  version: z.number().int().nonnegative(),
});
export const answerSchema = z.object({
  requestId: z.string().min(1),
  option: z.number().int().nonnegative().optional(),
  text: z.string().trim().min(1).max(20_000).optional(),
});
export const joinSchema = z.object({ code: z.string().trim().min(4).max(40) });
export const settingsPatchSchema = z
  .object({
    model: z.string().min(1).max(100),
    maxBudgetUsd: z.number().min(MIN_BUDGET_USD).max(MAX_BUDGET_USD),
    maxTurns: z.number().int().positive().max(1000),
    locale: localeSchema,
  })
  .partial();

/** Member keys: Telegram identity when the person has one, so access follows the Telegram user everywhere. */
export function memberKey(identity: { telegramUserId?: number | null; instanceUserId?: string | null }): string {
  if (identity.telegramUserId != null) return `tg:${identity.telegramUserId}`;
  if (identity.instanceUserId) return `u:${identity.instanceUserId}`;
  throw new Error('A member needs a Telegram user id or an instance user id.');
}
