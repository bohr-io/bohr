import { DurableObject } from 'cloudflare:workers';
import {
  AGENT_EFFORTS,
  AGENT_PORT,
  type AgentEvent,
  type AgentJob,
  DEFAULT_MAX_BUDGET_USD,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
  DEPLOY_CONFIG_PATH,
  DEPLOY_WORKFLOW_HEADER,
  DEPLOY_WORKFLOW_PATH,
  d1MigrationBindings,
  deployConfigSchema,
  type HomologEvent,
  type HomologStatus,
  hashInviteCode,
  type ImportStatus,
  INVITE_TTL_MS,
  type JobFailure,
  type JobOutcome,
  type Locale,
  newInviteCode,
  nextHomologStatus,
  normalizeInviteCode,
  normalizeLocale,
  PREVIEW_CONFIG_PATH,
  PREVIEW_PROXY_PORT,
  PREVIEW_STOP_REASONS,
  type PreviewState,
  type ProjectState,
  type RequestView,
  type Role,
  renderDeployWorkflow,
  stripJsonComments,
  usesBohrV1Action,
  WORK_BRANCH,
  WORKFLOWS_DIR,
} from '@bohr/shared';
import {
  callbackData,
  type InlineKeyboardMarkup,
  inlineKeyboard,
  TelegramBot,
  type TelegramUpdate,
  truncate,
} from '@bohr/telegram';
import { type ApiCall, handleApi } from './api';
import { memberAliases, reportMemberChange } from './broker';
import type { ContainerHost } from './container';
import { deps } from './deps';
import type { Env } from './env';
import { commandMenu, type MessageKey, t } from './messages';
import { previewPage } from './preview';
import type { RepoApi } from './repo';
import { type RequestRow, Store } from './store';
import { handleTelegramUpdate } from './telegram';

export type Actor = { key: string; name: string; role: Role };
export type Origin =
  | { source: 'telegram'; chatId: number; messageId?: number; locale: Locale }
  | { source: 'web'; locale: Locale };
export type Submitted = { text: string; posted: boolean; requestId?: string };

type FinishInput = {
  outcome: JobOutcome;
  summary: string;
  costUsd: number;
  sessionId?: string;
  headSha?: string;
  commits: { sha: string; title: string }[];
  question?: { text: string; options: string[] };
  error?: string;
  failure?: JobFailure;
  /** The job was lost with the agent's workspace (a restart or an update), not refused by the agent. */
  interrupted?: boolean;
};

type EnqueueOptions = {
  kind: 'import' | 'change';
  resumeSessionId: string | null;
  /** In front of every queued request (an import bohr queues, or the answer to an import's question). */
  ahead?: boolean;
};

const MAX_REQUEST_LENGTH = 20_000;
/** Imports bohr queues again by itself after an interruption. */
const MAX_IMPORT_RETRIES = 1;
/** Requests one member may have waiting; each one runs the agent (and spends the project's key). */
const MAX_QUEUED_PER_MEMBER = 5;
const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_STRIKES = 3;
const RELEASE_POLL_MS = 30_000;
const RELEASE_GIVE_UP_MS = 45 * 60_000;
const MAX_RUN_MS = 2 * 60 * 60_000;
const PROGRESS_EDIT_INTERVAL_MS = 4000;
const COMMIT_EMAIL = 'noreply@bohr.io';
/** Who the imports bohr starts by itself show as. */
const BOHR_NAME = 'bohr';

/** First non-empty line, without a leading list marker. */
const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim().replace(/^[-*•]\s+/, '');
/** An import that asked a question nobody answered yet: it holds the queue (Project.queueHeld). */
const awaitsImportAnswer = (row: RequestRow) =>
  row.kind === 'import' && row.status === 'needs_input' && row.question !== null;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Project extends DurableObject<Env> {
  readonly store: Store;
  #container: ContainerHost | null = null;
  readonly #lastProgressEdit = new Map<string, number>();
  #watchdogStrikes = 0;
  #booting: Promise<void> | null = null;
  /** Telegram users the instance did not know, so strangers do not trigger a lookup per message. */
  readonly #unknownUntil = new Map<string, number>();
  /** Requests whose pushed result is being settled with GitHub. */
  readonly #finishing = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    if (this.store.members().length === 0) {
      this.store.addMember({ key: env.OWNER_KEY, name: env.OWNER_NAME, role: 'owner' }, deps.now());
    }
    // A restart (a new version of the Worker, for one) may have taken the running job with it: check soon
    if (this.store.running() !== null) void ctx.blockConcurrencyWhile(() => this.wake());
  }

  // Accessors

  get locale(): Locale {
    return normalizeLocale(this.store.get('locale') ?? this.env.DEFAULT_LOCALE, 'pt-BR');
  }

  get projectName(): string {
    return this.env.PROJECT_NAME;
  }

  get agentEnabled(): boolean {
    return Boolean(this.env.ANTHROPIC_API_KEY);
  }

  /** The /model chosen in the chat, else the owner's model from the panel, else bohr's default. */
  private model(): string {
    return this.store.get('model') ?? this.env.AGENT_MODEL ?? DEFAULT_MODEL;
  }

  /** The owner's effort, compatible endpoint or Claude subscription, from the panel's settings. */
  private agentEndpoint(): Pick<AgentJob, 'effort' | 'baseUrl' | 'auth'> {
    const effort = AGENT_EFFORTS.find((level) => level === this.env.AGENT_EFFORT);
    const subscription = this.env.AGENT_PROVIDER === 'subscription';
    return {
      ...(effort ? { effort } : {}),
      ...(this.env.AGENT_BASE_URL && !subscription ? { baseUrl: this.env.AGENT_BASE_URL } : {}),
      // The official CLI authenticates with the subscription's OAuth token (a placeholder in the container)
      auth: subscription ? 'oauth' : 'api_key',
    };
  }

  /**
   * A runtime update: a Durable Object whose container runs keeps its code until the container stops, so the
   * instance asks for this after uploading a new version. The container stops and this object restarts on the
   * new code (the next request or alarm starts both again). A running request finishes first.
   */
  async restartForUpdate(): Promise<'restarting' | 'deferred'> {
    if (this.store.running() !== null) {
      this.store.set('restart_pending', 1);
      return 'deferred';
    }
    await this.restartNow();
    return 'restarting';
  }

  private async restartNow(): Promise<void> {
    this.store.unset('restart_pending');
    // The restarted object picks the queue up where this one left it
    await this.ctx.storage.setAlarm(deps.alarmAt(1000));
    try {
      await this.container().stop();
    } catch (error) {
      console.error('[project] Could not stop the container for the update:', errorText(error));
    }
    // After the answer goes out: aborting ends this instance and whatever it is still doing
    setTimeout(() => deps.restartObject(this.ctx), 50);
  }

  /** The Gateway lets the container use the Anthropic key only while a request runs. */
  agentActive(): boolean {
    return this.store.running() !== null;
  }

  bot(): TelegramBot | null {
    return this.env.TELEGRAM_BOT_TOKEN
      ? new TelegramBot({ token: this.env.TELEGRAM_BOT_TOKEN, fetch: deps.fetch })
      : null;
  }

  private container(): ContainerHost {
    this.#container ??= deps.container(this.ctx, this.env);
    return this.#container;
  }

  private repo(): RepoApi {
    return deps.repo(this.env);
  }

  actorFor(key: string, name?: string, aliases: string[] = [], grant?: Role): Actor | null {
    if (this.store.member(key) === null) {
      const alias = aliases.find((candidate) => this.store.member(candidate) !== null);
      if (alias !== undefined) this.store.rekeyMember(alias, key);
    }
    if (grant !== undefined) {
      // Access through an organization: the instance decides the role, so the member follows it
      if (this.store.member(key) === null) this.store.addMember({ key, name: name ?? key, role: grant }, deps.now());
      else this.store.setMemberRole(key, grant, this.env.OWNER_KEY);
    }
    const member = this.store.member(key);
    if (member === null) return null;
    if (name !== undefined && name !== member.name) this.store.renameMember(key, name);
    return { key, name: name ?? member.name, role: member.role };
  }

  homolog() {
    return {
      status: (this.store.get('homolog_status') ?? 'clean') as HomologStatus,
      version: this.store.number('homolog_version', 0),
      headSha: this.store.get('homolog_head_sha'),
      cycle: this.store.number('cycle', 1),
    };
  }

  /** Whether the agent prepared the repository (see IMPORT_STATUSES). */
  importStatus(): ImportStatus {
    if (this.store.get('imported') === '1') return 'done';
    if (this.store.activeImport() !== null) return 'running';
    const latest = this.store.latestImport();
    return latest === null ? 'never' : 'failed';
  }

  /** The preview as last reported by the runner, while the workspace is up. */
  previewState(): PreviewState {
    const status = this.store.get('preview_status');
    if (status === 'stopped' && this.store.get('preview_reason') === 'not_configured') return 'not_configured';
    if (!this.container().running || status === null) return 'unknown';
    return status === 'starting' || status === 'running' || status === 'failed' || status === 'stopped'
      ? status
      : 'unknown';
  }

  /** Applies a preview transition. The version changes only when the preview's content does. */
  private applyHomolog(event: HomologEvent, headSha?: string): boolean {
    const current = this.homolog();
    const next = nextHomologStatus(current.status, event);
    if (next === null) return false;
    this.store.set('homolog_status', next);
    if (event.type === 'changes_pushed' || event.type === 'merged' || event.type === 'discarded') {
      this.store.set('homolog_version', current.version + 1);
    }
    if (headSha !== undefined) this.store.set('homolog_head_sha', headSha);
    if (event.type === 'merged' || event.type === 'discarded') {
      this.store.set('cycle', current.cycle + 1);
      this.store.unset('last_session_id');
    }
    return true;
  }

  private async wake(delayMs = 0): Promise<void> {
    const at = deps.alarmAt(delayMs);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  // Telegram output

  private async send(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<number | null> {
    const bot = this.bot();
    if (bot === null) return null;
    try {
      const sent = await bot.sendMessage({
        chat_id: chatId,
        text: truncate(text, 4096),
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
      return sent.message_id;
    } catch (error) {
      console.error('[project] Telegram send failed:', errorText(error));
      return null;
    }
  }

  /** Edits the request's status message, or sends a new one when there is none. */
  private async editOrSend(
    chatId: number,
    messageId: number | null,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ): Promise<number | null> {
    const bot = this.bot();
    if (bot === null) return null;
    if (messageId !== null) {
      try {
        await bot.editMessageText({
          chat_id: chatId,
          message_id: messageId,
          text: truncate(text, 4096),
          link_preview_options: { is_disabled: true },
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
        return messageId;
      } catch (error) {
        console.error('[project] Telegram edit failed, sending instead:', errorText(error));
      }
    }
    return this.send(chatId, text, keyboard);
  }

  /** Telegram chats that hear about a project-wide event: where it started and the project's notice chat. */
  private noticeChats(origin?: Origin): number[] {
    const chats = new Set<number>();
    if (origin?.source === 'telegram') chats.add(origin.chatId);
    const notify = this.store.number('notify_chat_id', 0);
    if (notify !== 0) chats.add(notify);
    return [...chats];
  }

  /** Records a system notice in the timeline and sends it to the notice chats. */
  private async announce(key: MessageKey, params: Record<string, string | number>, origin?: Origin): Promise<string> {
    const text = t(this.locale, key, params);
    this.store.addChat({
      at: deps.now().toISOString(),
      kind: 'system',
      request_id: null,
      author_key: null,
      author_name: null,
      text,
    });
    await Promise.all(this.noticeChats(origin).map((chatId) => this.send(chatId, text)));
    return text;
  }

  private decisionKeyboard(version: number): InlineKeyboardMarkup {
    const rows: Parameters<typeof inlineKeyboard>[0] = [
      [{ text: t(this.locale, 'approveButton'), data: callbackData('approve', version) }],
      [
        { text: t(this.locale, 'discardButton'), data: callbackData('discard', version) },
        // The chat never prints the preview's address; the button opens it
        { text: t(this.locale, 'previewButton'), url: this.env.PREVIEW_URL },
      ],
    ];
    const diff = this.diffUrl();
    if (diff !== null) rows.push([{ text: t(this.locale, 'diffButton'), url: diff }]);
    return inlineKeyboard(rows);
  }

  /** GitHub's view of exactly what approving publishes: production against the pinned preview commit. */
  diffUrl(): string | null {
    const head = this.homolog().headSha;
    if (head === null) return null;
    return `https://github.com/${this.env.REPO_OWNER}/${this.env.REPO_NAME}/compare/${this.env.PRODUCTION_BRANCH}...${head}`;
  }

  /** Removes the buttons of the previous decision message, so only the latest one can be used. */
  private async retireDecisionMessage(): Promise<void> {
    const chatId = this.store.number('decision_chat_id', 0);
    const messageId = this.store.number('decision_message_id', 0);
    const bot = this.bot();
    if (chatId === 0 || messageId === 0 || bot === null) return;
    this.store.unset('decision_chat_id');
    this.store.unset('decision_message_id');
    try {
      await bot.editMessageReplyMarkup({ chat_id: chatId, message_id: messageId });
    } catch (error) {
      console.error('[project] Could not remove old buttons:', errorText(error));
    }
  }

  // Requests

  /**
   * A member's message: a new request, or the answer to the agent's open question in that chat.
   * `posted` is true when the reply already went to Telegram as the request's status message.
   */
  async submit(actor: Actor, rawText: string, origin: Origin): Promise<Submitted> {
    const text = rawText.trim();
    if (text.length === 0) return { text: t(origin.locale, 'help'), posted: false };
    if (text.length > MAX_REQUEST_LENGTH) return { text: t(origin.locale, 'tooLong'), posted: false };
    if (!this.agentEnabled) return { text: t(origin.locale, 'agentDisabled'), posted: false };

    const chatId = origin.source === 'telegram' ? origin.chatId : null;
    const awaiting = this.store.awaitingAnswer(chatId);
    if (awaiting !== null) this.store.updateRequest(awaiting.id, { question: null });
    // Within a preview cycle the agent keeps its conversation, so "make it bigger" has context.
    const resume = awaiting?.session_id ?? this.store.get('last_session_id');
    return this.enqueue(actor, text, origin, this.answerOptions(awaiting, resume));
  }

  /** The answer to a question, chosen from its options. */
  async answer(actor: Actor, requestId: string, option: number, origin: Origin): Promise<Submitted> {
    const request = this.store.request(requestId);
    const question = request?.question ? (JSON.parse(request.question) as { options: string[] }) : null;
    const choice = question?.options[option];
    if (request === null || request.status !== 'needs_input' || choice === undefined) {
      return { text: t(origin.locale, 'staleVersion'), posted: false };
    }
    this.store.updateRequest(request.id, { question: null });
    return this.enqueue(actor, choice, origin, this.answerOptions(request, request.session_id));
  }

  /**
   * How a message queues, as the answer to `asked` (or a new request, without one). An import's answer goes on
   * preparing the repository, in its session and in front of the requests the question held (queueHeld); any
   * other answer queues like a new change.
   */
  private answerOptions(asked: RequestRow | null, resumeSessionId: string | null): EnqueueOptions {
    return asked?.kind === 'import'
      ? { kind: 'import', resumeSessionId, ahead: true }
      : { kind: 'change', resumeSessionId };
  }

  /**
   * Whether the queue waits: an import asked a question, and what is queued behind it would analyze the same
   * unprepared repository and ask it again. Its answer (queued ahead) or cancelling the question lets it go on.
   * Without the agent nothing could answer, and the queued requests fail as usual.
   */
  private queueHeld(): boolean {
    return this.agentEnabled && this.store.importAwaitingAnswer() !== null;
  }

  /** Asks the agent to prepare the repository for bohr (first run after the repository is connected). */
  async startImport(actor: Actor, origin: Origin, automatic = false): Promise<Submitted> {
    if (!this.agentEnabled) return { text: t(origin.locale, 'agentDisabled'), posted: false };
    // One import at a time: asking again while one is under way answers with that one
    const active = this.store.activeImport();
    if (active !== null) return { text: t(origin.locale, 'importRunning'), posted: false, requestId: active.id };
    // Asked for by a person: it may be retried once again after an interruption
    this.store.unset('import_retries');
    return this.enqueue(automatic ? this.bohrActor() : actor, t(this.locale, 'importPrompt'), origin, {
      kind: 'import',
      resumeSessionId: null,
    });
  }

  /** bohr's own imports: they run for the owner (their queue and role) but show as bohr's, not as a person's. */
  private bohrActor(): Actor {
    return { key: this.env.OWNER_KEY, name: BOHR_NAME, role: 'owner' };
  }

  /** Where a request came from, so what bohr does about it is told there. */
  private originOf(request: RequestRow): Origin {
    return request.source === 'telegram' && request.chat_id !== null
      ? { source: 'telegram', chatId: request.chat_id, locale: this.locale }
      : { source: 'web', locale: this.locale };
  }

  /**
   * An import bohr queues by itself (after an interruption, or before a change to a repository that was never
   * prepared): in front of the queue, outside the member's queue limit, announced with `notice`.
   */
  private async queueImport(origin: Origin, notice: MessageKey): Promise<string> {
    const id = this.insertQueued(this.bohrActor(), t(this.locale, 'importPrompt'), origin, {
      kind: 'import',
      resumeSessionId: null,
      ahead: true,
    });
    await this.announce(notice, {}, origin);
    await this.wake();
    return id;
  }

  private insertQueued(actor: Actor, text: string, origin: Origin, options: EnqueueOptions): string {
    const id = `req_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    this.store.insertRequest(
      {
        id,
        kind: options.kind,
        status: 'queued',
        text,
        author_key: actor.key,
        author_name: actor.name,
        source: origin.source,
        chat_id: origin.source === 'telegram' ? origin.chatId : null,
        progress_message_id: null,
        created_at: deps.now().toISOString(),
        started_at: null,
        finished_at: null,
        summary: null,
        cost_usd: null,
        session_id: null,
        resume_session_id: options.resumeSessionId,
        head_sha: null,
        question: null,
        error: null,
        progress: null,
        cycle: this.homolog().cycle,
        // The sandbox's token cannot change workflows; the Worker writes the deploy workflow (syncDeployWorkflow)
        allow_workflow_edits: 0,
        auth: null,
      },
      { ahead: options.ahead ?? false },
    );
    return id;
  }

  private async enqueue(actor: Actor, text: string, origin: Origin, options: EnqueueOptions): Promise<Submitted> {
    const queued = this.store.queued();
    // What goes ahead continues an import (answerOptions): outside the member's limit, like the import itself
    const limited = options.ahead !== true;
    if (limited && queued.filter((row) => row.author_key === actor.key).length >= MAX_QUEUED_PER_MEMBER) {
      return { text: t(origin.locale, 'queueFull', { max: MAX_QUEUED_PER_MEMBER }), posted: false };
    }
    const now = deps.now().toISOString();
    const ahead = (options.ahead ? 0 : queued.length) + (this.store.running() ? 1 : 0);
    const startsNow = ahead === 0 && this.homolog().status !== 'publishing';
    const id = this.insertQueued(actor, text, origin, options);
    this.store.addChat({ at: now, kind: 'user', request_id: id, author_key: actor.key, author_name: actor.name, text });

    const reply = startsNow ? t(origin.locale, 'working') : t(origin.locale, 'queued', { position: ahead + 1 });
    let posted = false;
    if (origin.source === 'telegram') {
      const messageId = await this.send(origin.chatId, reply);
      if (messageId !== null) this.store.updateRequest(id, { progress_message_id: messageId });
      posted = messageId !== null;
    }
    await this.wake();
    return { text: reply, posted, requestId: id };
  }

  async cancel(actor: Actor, requestId: string | null, origin: Origin): Promise<string> {
    const candidates =
      requestId === null
        ? this.store.cancellable(actor.role === 'owner' ? null : actor.key)
        : [this.store.request(requestId)].filter((row): row is RequestRow => row !== null);
    const target = candidates.find(
      (row) => row.status === 'running' || row.status === 'queued' || awaitsImportAnswer(row),
    );
    if (target === undefined || (actor.role !== 'owner' && target.author_key !== actor.key)) {
      return t(origin.locale, 'nothingToCancel');
    }
    if (target.status === 'needs_input') {
      // Dropping an import's question releases the requests it held (queueHeld)
      this.store.updateRequest(target.id, { status: 'cancelled', question: null });
      const cancelled = this.store.request(target.id);
      if (cancelled !== null) await this.announceResult(cancelled, false);
      await this.wake();
      return t(origin.locale, 'cancelled');
    }
    if (target.status === 'running') {
      try {
        await this.container().runner.cancel(target.id);
        return t(origin.locale, 'cancelled');
      } catch {
        // The runner is gone; nothing will report back, so the request ends here.
      }
    }
    await this.finishRequest(target.id, { outcome: 'cancelled', summary: '', costUsd: 0, commits: [] });
    return t(origin.locale, 'cancelled');
  }

  private jobFor(request: RequestRow): AgentJob {
    return {
      jobId: request.id,
      kind: request.kind,
      prompt: request.text,
      repo: {
        owner: this.env.REPO_OWNER,
        name: this.env.REPO_NAME,
        baseBranch: this.env.PRODUCTION_BRANCH,
        workBranch: WORK_BRANCH,
      },
      author: {
        name: request.author_name === BOHR_NAME ? BOHR_NAME : `${request.author_name} (via bohr)`,
        email: COMMIT_EMAIL,
      },
      model: this.model(),
      ...this.agentEndpoint(),
      maxBudgetUsd: this.store.number('max_budget_usd', DEFAULT_MAX_BUDGET_USD),
      maxTurns: this.store.number('max_turns', DEFAULT_MAX_TURNS),
      ...(request.resume_session_id ? { resumeSessionId: request.resume_session_id } : {}),
      locale: this.locale,
      allowWorkflowEdits: request.allow_workflow_edits === 1,
      context: {
        projectName: this.env.PROJECT_NAME,
        previewUrl: this.env.PREVIEW_URL,
        ...(this.env.PRODUCTION_URL ? { productionUrl: this.env.PRODUCTION_URL } : {}),
        requesterName: request.author_name,
        deployTarget: this.env.DEPLOY_TARGET === 'bohr-cloud' ? 'bohr-cloud' : 'wrangler',
      },
    };
  }

  private async startNext(): Promise<void> {
    if (this.store.running() !== null || this.homolog().status === 'publishing' || this.queueHeld()) return;
    let next = this.store.queued()[0];
    if (next === undefined) return;
    if (next.kind === 'change' && this.agentEnabled && (await this.needsImport(next))) {
      // A change to a repository bohr never prepared would have no preview and no deploy: prepare it first
      this.store.set('import_first_request', next.id);
      await this.queueImport(this.originOf(next), 'importFirst');
    }
    // The checks above wait on GitHub; the queue may have changed meanwhile
    if (this.store.running() !== null || this.homolog().status === 'publishing' || this.queueHeld()) return;
    next = this.store.queued()[0];
    if (next === undefined) return;
    if (!this.agentEnabled) {
      await this.finishRequest(next.id, {
        outcome: 'failed',
        summary: '',
        costUsd: 0,
        commits: [],
        error: t(this.locale, 'agentDisabled'),
      });
      return;
    }
    this.store.updateRequest(next.id, {
      status: 'running',
      started_at: deps.now().toISOString(),
      auth: this.agentEndpoint().auth,
    });
    try {
      const container = this.container();
      const wasRunning = container.running;
      await container.start();
      if (!wasRunning) this.store.set('runner_last_seq', 0);
      if ((await container.runner.startJob(this.jobFor(next))) === 'busy') {
        // A job this object no longer tracks still runs; stop it and try again shortly.
        const health = await container.runner.health();
        if (health?.jobId !== undefined && health.jobId !== next.id) await container.runner.cancel(health.jobId);
        this.store.updateRequest(next.id, { status: 'queued', started_at: null });
        await this.wake(5000);
        return;
      }
      this.#watchdogStrikes = 0;
    } catch (error) {
      console.error('[project] Could not start the agent:', errorText(error));
      await this.finishRequest(next.id, {
        outcome: 'failed',
        summary: '',
        costUsd: 0,
        commits: [],
        error: errorText(error),
      });
    }
  }

  /**
   * Whether a change request must wait for the import: no import succeeded, none is under way, bohr did not
   * already put one in front of this request, and the production branch lacks the preview or deploy config.
   */
  private async needsImport(request: RequestRow): Promise<boolean> {
    if (this.store.get('imported') === '1' || this.store.activeImport() !== null) return false;
    if (this.store.get('import_first_request') === request.id) return false;
    try {
      const repo = this.repo();
      const branch = this.env.PRODUCTION_BRANCH;
      const [preview, deploy] = await Promise.all([
        repo.readFile(PREVIEW_CONFIG_PATH, branch),
        repo.readFile(DEPLOY_CONFIG_PATH, branch),
      ]);
      if (preview !== null && deploy !== null) {
        // Prepared some other way (by hand, or before bohr kept track): nothing to import
        this.store.set('imported', 1);
        return false;
      }
      return true;
    } catch (error) {
      // GitHub did not answer: the request runs as it is rather than wait on it
      console.error('[project] Could not check the repository configuration:', errorText(error));
      return false;
    }
  }

  /** The running request was lost with the runner (a restart or an update): it fails, and an import comes back. */
  private async interrupted(request: RequestRow): Promise<void> {
    await this.finishRequest(request.id, {
      outcome: 'failed',
      summary: '',
      costUsd: 0,
      commits: [],
      error: t(this.locale, 'jobInterrupted'),
      interrupted: true,
    });
  }

  /** Checks that the running request is still alive in the container, and recovers missed events. */
  private async watchdog(request: RequestRow): Promise<void> {
    const container = this.container();
    if (!container.running) {
      // The container stopped (or this object restarted without it): nothing runs the job any more
      await this.interrupted(request);
      return;
    }
    const startedAt = Date.parse(request.started_at ?? request.created_at);
    if (deps.now().getTime() - startedAt > MAX_RUN_MS) {
      await container.runner.cancel(request.id).catch(() => {});
      await this.finishRequest(request.id, {
        outcome: 'failed',
        summary: '',
        costUsd: 0,
        commits: [],
        error: t(this.locale, 'agentLost'),
      });
      return;
    }
    const health = await container.runner.health();
    if (health === null) {
      this.#watchdogStrikes++;
      if (this.#watchdogStrikes >= WATCHDOG_STRIKES) {
        await this.finishRequest(request.id, {
          outcome: 'failed',
          summary: '',
          costUsd: 0,
          commits: [],
          error: t(this.locale, 'agentLost'),
        });
      }
      return;
    }
    this.#watchdogStrikes = 0;
    let lastSeq = this.store.number('runner_last_seq', 0);
    if (health.lastSeq < lastSeq) {
      // The runner restarted and counts from zero again.
      lastSeq = 0;
      this.store.set('runner_last_seq', 0);
    }
    const runsThisJob = health.busy && (health.jobId === undefined || health.jobId === request.id);
    if (health.lastSeq > lastSeq || !runsThisJob) {
      const { events } = await container.runner.events(lastSeq);
      await this.agentEvents(events);
    }
    // Still running here, but not there: the runner restarted (or never got the job) and nothing will report it
    if (this.store.request(request.id)?.status === 'running' && !runsThisJob) await this.interrupted(request);
  }

  /** Events the agent runner pushes through the Gateway (or the watchdog fetches). */
  async agentEvents(events: AgentEvent[]): Promise<void> {
    const seen = this.store.number('runner_last_seq', 0);
    let lastSeq = seen;
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      lastSeq = Math.max(lastSeq, event.seq);
      if (event.type === 'preview.status') {
        this.store.set('preview_status', event.status);
        const reason = event.status === 'stopped' ? previewStopReason(event.reason, event.log) : undefined;
        if (reason === undefined) this.store.unset('preview_reason');
        else this.store.set('preview_reason', reason);
        // The preview URL is public: it must never lead to the runner's control port
        if (event.port !== undefined && event.port !== AGENT_PORT) this.store.set('preview_port', event.port);
        continue;
      }
      const request = this.store.request(event.jobId);
      if (request === null || request.status !== 'running') continue;
      switch (event.type) {
        case 'job.started':
          if (event.sessionId !== undefined) this.store.updateRequest(request.id, { session_id: event.sessionId });
          break;
        case 'job.progress':
          this.store.updateRequest(request.id, { progress: event.text });
          await this.showProgress(request, event.text);
          break;
        case 'job.message':
          if (event.seq > seen) {
            this.store.addChat({
              at: event.at,
              kind: 'agent',
              request_id: request.id,
              author_key: null,
              author_name: null,
              text: event.text,
            });
          }
          break;
        case 'job.finished':
          await this.finishRequest(request.id, event);
          break;
      }
    }
    this.store.set('runner_last_seq', lastSeq);
  }

  private async showProgress(request: RequestRow, status: string): Promise<void> {
    if (request.source !== 'telegram' || request.chat_id === null || request.progress_message_id === null) return;
    const now = deps.now().getTime();
    if (now - (this.#lastProgressEdit.get(request.id) ?? 0) < PROGRESS_EDIT_INTERVAL_MS) return;
    this.#lastProgressEdit.set(request.id, now);
    await this.editOrSend(
      request.chat_id,
      request.progress_message_id,
      t(this.locale, 'progress', { status: truncate(status, 300) }),
    );
  }

  private async finishRequest(id: string, result: FinishInput): Promise<void> {
    const request = this.store.request(id);
    if (request === null || (request.status !== 'running' && request.status !== 'queued')) return;
    const reported = result.headSha;
    let pushed = result.outcome === 'succeeded' && reported !== undefined && result.commits.length > 0;
    const imported = request.kind === 'import' && result.outcome === 'succeeded';
    let homologHead = reported;
    if (pushed || imported) {
      // The GitHub calls below let other events in (a late duplicate of this one): settle each request once
      if (this.#finishing.has(id)) return;
      this.#finishing.add(id);
      try {
        const notes: string[] = [];
        if (pushed && reported !== undefined) notes.push((await this.syncDeployWorkflow(reported)) ?? '');
        if (imported) {
          const removed = await this.removeLegacyWorkflows(pushed ? (reported ?? null) : null);
          if (removed.length > 0) {
            notes.push(t(this.locale, 'legacyWorkflowsRemoved', { files: removed.join(', ') }));
            // The removal is a change to the preview of its own, to approve like any other
            pushed = true;
          }
        }
        const note = notes.filter(Boolean).join('\n\n');
        if (note !== '') result = { ...result, summary: [result.summary, note].filter(Boolean).join('\n\n') };
        if (pushed) homologHead = await this.workBranchHead(reported);
      } finally {
        this.#finishing.delete(id);
      }
    }
    this.store.updateRequest(id, {
      status: result.outcome,
      finished_at: deps.now().toISOString(),
      summary: result.summary || null,
      cost_usd: result.costUsd,
      session_id: result.sessionId ?? request.session_id,
      head_sha: pushed ? (homologHead ?? null) : null,
      question: result.outcome === 'needs_input' && result.question ? JSON.stringify(result.question) : null,
      error: this.failureText(result) ?? null,
      progress: null,
    });
    if (pushed) this.applyHomolog({ type: 'changes_pushed' }, homologHead);
    if (imported) this.store.set('imported', 1);
    if (result.sessionId !== undefined && (result.outcome === 'succeeded' || result.outcome === 'needs_input')) {
      this.store.set('last_session_id', result.sessionId);
    }
    this.#lastProgressEdit.delete(id);
    const finished = this.store.request(id);
    if (finished !== null) await this.announceResult(finished, pushed);
    if (request.kind === 'import' && result.interrupted) await this.retryImport(request);
    await this.wake();
  }

  /**
   * Why a request failed, for the user: the chat never talks about cost, so a spending cap is just a limit. The
   * runner reports the limits in English (its log's language); the chat follows the project's language.
   */
  private failureText(result: FinishInput): string | undefined {
    if (result.outcome !== 'failed') return result.error;
    const error = result.error ?? '';
    if (result.failure === 'budget' || /^Budget exhausted/.test(error)) return t(this.locale, 'limitReached');
    if (result.failure === 'turns' || /^Too many turns/.test(error)) return t(this.locale, 'turnLimitReached');
    return result.error;
  }

  /** An import lost with the workspace runs again by itself, once (MAX_IMPORT_RETRIES). */
  private async retryImport(request: RequestRow): Promise<void> {
    const retries = this.store.number('import_retries', 0);
    if (retries >= MAX_IMPORT_RETRIES || this.store.activeImport() !== null || this.store.get('imported') === '1') {
      return;
    }
    this.store.set('import_retries', retries + 1);
    await this.queueImport(this.originOf(request), 'importRetrying');
  }

  /**
   * Deletes bohr v1's workflows (the ones running bohr-io/action, which fail on every push now) from the work
   * branch, one commit each, so they leave production with the next approval and pushes to the work branch no
   * longer run them. `ref` is what the import pushed; without it, the work branch (created from production
   * when missing). Returns the paths removed.
   */
  private async removeLegacyWorkflows(ref: string | null): Promise<string[]> {
    // Hosted by bohr (projects migrated from v1): their bohr.yml is the deploy path (bohr-io/action asks the
    // instance for the build plan), so it stays
    if (this.env.DEPLOY_TARGET === 'bohr-cloud') return [];
    try {
      const repo = this.repo();
      let base = ref ?? (await repo.branchSha(WORK_BRANCH));
      if (base === null) {
        const production = await repo.branchSha(this.env.PRODUCTION_BRANCH);
        if (production === null) return [];
        const workflows = await repo.listFiles(WORKFLOWS_DIR, production);
        if (workflows.length === 0) return [];
        await repo.resetBranch(WORK_BRANCH, production);
        base = production;
      }
      const legacy: { path: string; sha: string }[] = [];
      for (const file of await repo.listFiles(WORKFLOWS_DIR, base)) {
        if (!/\.ya?ml$/i.test(file.path)) continue;
        const workflow = await repo.readFile(file.path, base);
        if (workflow !== null && usesBohrV1Action(workflow.content)) {
          legacy.push({ path: file.path, sha: workflow.sha });
        }
      }
      for (const file of legacy) {
        await repo.deleteFile({
          path: file.path,
          branch: WORK_BRANCH,
          message: `bohr: remove the bohr v1 workflow ${file.path}`,
          sha: file.sha,
        });
      }
      return legacy.map((file) => file.path);
    } catch (error) {
      console.error('[project] Could not remove the bohr v1 workflows:', errorText(error));
      return [];
    }
  }

  /**
   * Writes the production deploy workflow from .bohr/deploy.json when it differs from what the work branch has.
   * The sandbox cannot change workflows (its token lacks the permission), so this template is the only way
   * one changes, and it only ever runs on pushes to the production branch. Returns a note for the user.
   */
  private async hasV1Workflow(ref: string): Promise<boolean> {
    const repo = this.repo();
    for (const file of await repo.listFiles(WORKFLOWS_DIR, ref)) {
      if (!/\.ya?ml$/i.test(file.path)) continue;
      const workflow = await repo.readFile(file.path, ref);
      if (workflow !== null && usesBohrV1Action(workflow.content)) return true;
    }
    return false;
  }

  private async syncDeployWorkflow(ref: string): Promise<string | null> {
    try {
      const repo = this.repo();
      const file = await repo.readFile(DEPLOY_CONFIG_PATH, ref);
      if (file === null) return null;
      let raw: unknown;
      try {
        raw = JSON.parse(file.content);
      } catch {
        return t(this.locale, 'deployConfigInvalid', { error: 'JSON' });
      }
      const parsed = deployConfigSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return t(this.locale, 'deployConfigInvalid', {
          error: truncate(`${issue?.path.join('.') || 'deploy.json'}: ${issue?.message ?? ''}`, 200),
        });
      }
      const target = this.env.DEPLOY_TARGET === 'bohr-cloud' ? 'bohr-cloud' : 'wrangler';
      const content = renderDeployWorkflow(parsed.data, {
        productionBranch: this.env.PRODUCTION_BRANCH,
        target,
        instanceUrl: this.env.INSTANCE_URL,
        d1Migrations: target === 'wrangler' && (await this.hasD1Migrations(ref, parsed.data.directory)),
      });
      // A project migrated from v1 deploys with its bohr.yml and the instance's build plan: a second deploy
      // workflow would publish every change twice
      if (this.env.DEPLOY_TARGET === 'bohr-cloud' && (await this.hasV1Workflow(ref))) return null;
      const current = await repo.readFile(DEPLOY_WORKFLOW_PATH, ref);
      if (current?.content === content) return null;
      // Someone else's workflow (a project moved from bohr v1, or the team's own): bohr leaves it as it is
      if (current !== null && !current.content.startsWith(DEPLOY_WORKFLOW_HEADER)) return null;
      await repo.writeFile({
        path: DEPLOY_WORKFLOW_PATH,
        branch: WORK_BRANCH,
        content,
        message: `bohr: deploy workflow from ${DEPLOY_CONFIG_PATH}`,
        ...(current !== null ? { sha: current.sha } : {}),
      });
      return null;
    } catch (error) {
      console.error('[project] Could not write the deploy workflow:', errorText(error));
      return t(this.locale, 'deployWorkflowFailed', { error: errorText(error) });
    }
  }

  /**
   * Whether the deploy folder's wrangler config has D1 databases with migrations: the workflow then applies them
   * before deploying. Without them the workflow stays as projects without a database have it.
   */
  private async hasD1Migrations(ref: string, directory: string): Promise<boolean> {
    const prefix = directory === '.' ? '' : `${directory.replace(/\/+$/, '')}/`;
    for (const name of ['wrangler.jsonc', 'wrangler.json']) {
      const file = await this.repo().readFile(`${prefix}${name}`, ref);
      if (file === null) continue;
      try {
        return d1MigrationBindings(JSON.parse(stripJsonComments(file.content))).length > 0;
      } catch {
        // A config wrangler cannot read either: the deploy reports it
        return false;
      }
    }
    return false;
  }

  /** The work branch's head as GitHub has it: that commit, and nothing else, is what approving publishes. */
  private async workBranchHead(reported?: string): Promise<string | undefined> {
    try {
      return (await this.repo().branchSha(WORK_BRANCH)) ?? reported;
    } catch (error) {
      console.error('[project] Could not read the work branch:', errorText(error));
      return reported;
    }
  }

  private async announceResult(request: RequestRow, pushed: boolean): Promise<void> {
    const locale = this.locale;
    // The chat never shows a request's cost (it stays in the store) nor the preview's address (a button opens it)
    const summary = request.summary ?? '';
    let text: string;
    let keyboard: InlineKeyboardMarkup | undefined;
    let actions: string[] = [];
    let options: string[] = [];

    if (request.status === 'succeeded' && pushed) {
      text = t(locale, 'done', { summary });
      actions = ['approve', 'discard'];
      keyboard = this.decisionKeyboard(this.homolog().version);
    } else if (request.status === 'succeeded') {
      text = t(locale, 'doneNoChanges', { summary });
    } else if (request.status === 'needs_input' && request.question !== null) {
      const question = JSON.parse(request.question) as { text: string; options: string[] };
      options = question.options;
      actions = ['answer'];
      text = `${t(locale, 'question', { question: question.text })}\n\n${t(locale, 'answerPrompt')}`;
      keyboard =
        options.length > 0
          ? inlineKeyboard(
              options.map((option, index) => [
                { text: truncate(option, 60), data: callbackData('answer', request.id, index) },
              ]),
            )
          : undefined;
    } else if (request.status === 'cancelled') {
      text = t(locale, 'cancelled');
    } else {
      text = t(locale, 'failed', { error: request.error ?? t(locale, 'error') });
    }

    if (pushed) this.store.clearChatActions();
    this.store.addChat({
      at: deps.now().toISOString(),
      kind: 'agent',
      request_id: request.id,
      author_key: null,
      author_name: null,
      text,
      actions,
      options,
    });

    const chatId = request.chat_id ?? (pushed ? this.store.number('notify_chat_id', 0) : 0);
    if (chatId === 0) return;
    if (pushed) await this.retireDecisionMessage();
    const messageId = await this.editOrSend(
      chatId,
      request.chat_id === null ? null : request.progress_message_id,
      text,
      keyboard,
    );
    if (pushed && messageId !== null) {
      this.store.set('decision_chat_id', chatId);
      this.store.set('decision_message_id', messageId);
    }
  }

  // Decisions

  /** Approve or discard the preview the member reviewed (identified by its version). */
  async decide(actor: Actor, action: 'approve' | 'discard', version: number, origin: Origin): Promise<string> {
    const homolog = this.homolog();
    if (homolog.status === 'publishing' || this.store.get('rollback_in_progress') === '1') {
      return t(origin.locale, 'publishing');
    }
    if (homolog.status !== 'pending') return t(origin.locale, 'nothingToApprove');
    if (version !== homolog.version) return t(origin.locale, 'staleVersion');
    if (this.store.running() !== null) return t(origin.locale, 'busy');

    if (action === 'discard') {
      this.store.set('homolog_status', 'publishing');
      this.ctx.waitUntil(this.discard(actor, origin));
      return t(origin.locale, 'discarded', { name: actor.name });
    }
    this.applyHomolog({ type: 'approved' });
    await this.retireDecisionMessage();
    this.store.clearChatActions();
    const text = await this.announce('approving', { name: actor.name }, origin);
    this.ctx.waitUntil(this.publish(actor, origin));
    return text;
  }

  private async publish(actor: Actor, origin: Origin): Promise<void> {
    const homolog = this.homolog();
    const requests = this.store.requestsInCycle(homolog.cycle);
    const summaries = requests.map((request) => firstLine(request.summary ?? request.text)).filter(Boolean);
    const title = truncate(
      summaries.length === 1 ? (summaries[0] ?? '') : `bohr: ${summaries.length || 1} changes`,
      120,
    );
    const body = [
      ...requests.map((request) => `- ${firstLine(request.summary ?? request.text)} (${request.author_name})`),
      '',
      `Approved by ${actor.name} in bohr. Preview: ${this.env.PREVIEW_URL}`,
    ].join('\n');
    try {
      if (homolog.headSha === null) throw new Error('the preview has no commit');
      const repo = this.repo();
      const pull = await repo.openPullRequest({
        head: WORK_BRANCH,
        base: this.env.PRODUCTION_BRANCH,
        title,
        body,
      });
      const merged = await repo.mergePullRequest(pull.number, {
        sha: homolog.headSha,
        title: `${title} (#${pull.number})`,
      });
      await repo.resetBranch(WORK_BRANCH, merged.sha);
      this.applyHomolog({ type: 'merged' }, merged.sha);
      this.store.addRelease({
        id: `rel_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        status: 'deploying',
        pull_request: pull.number,
        pull_request_node_id: pull.nodeId,
        commit_sha: merged.sha,
        summary: title,
        created_at: deps.now().toISOString(),
        approved_by: actor.name,
        chat_id: origin.source === 'telegram' ? origin.chatId : null,
        run_url: null,
        checked_at: null,
      });
      await this.announce('merged', { pr: pull.number }, origin);
      await this.syncCheckout(WORK_BRANCH);
      await this.wake(RELEASE_POLL_MS);
    } catch (error) {
      console.error('[project] Publishing failed:', errorText(error));
      this.applyHomolog({ type: 'merge_failed' });
      await this.announce('mergeFailed', { error: errorText(error) }, origin);
      await this.wake();
    }
  }

  private async discard(actor: Actor, origin: Origin): Promise<void> {
    try {
      const repo = this.repo();
      const production = await repo.branchSha(this.env.PRODUCTION_BRANCH);
      if (production === null) throw new Error(`branch ${this.env.PRODUCTION_BRANCH} not found`);
      await repo.resetBranch(WORK_BRANCH, production);
      this.store.set('homolog_status', 'pending');
      this.applyHomolog({ type: 'discarded' }, production);
      // The repository's preparation lived only on the preview (never approved): discarding took it too, so the
      // next request prepares the repository again first
      const [previewConfig, deployConfig] = await Promise.all([
        repo.readFile(PREVIEW_CONFIG_PATH, this.env.PRODUCTION_BRANCH),
        repo.readFile(DEPLOY_CONFIG_PATH, this.env.PRODUCTION_BRANCH),
      ]);
      if (previewConfig === null || deployConfig === null) this.store.unset('imported');
      await this.retireDecisionMessage();
      this.store.clearChatActions();
      await this.announce('discarded', { name: actor.name }, origin);
      await this.syncCheckout(WORK_BRANCH);
    } catch (error) {
      this.store.set('homolog_status', 'pending');
      await this.announce('mergeFailed', { error: errorText(error) }, origin);
    }
    await this.wake();
  }

  /** Brings the container's checkout (and so the preview) to a branch, when the container is up. */
  private async syncCheckout(branch: string): Promise<void> {
    const container = this.container();
    if (!container.running) return;
    try {
      await container.runner.gitSync(branch);
    } catch (error) {
      console.error('[project] Could not update the checkout:', errorText(error));
    }
  }

  async rollback(actor: Actor, origin: Origin): Promise<string> {
    const release = this.store
      .releases(20)
      .find((row) => (row.status === 'live' || row.status === 'deploying') && row.pull_request_node_id !== null);
    if (release === undefined || release.pull_request_node_id === null) return t(origin.locale, 'nothingToRollback');
    if (this.store.get('rollback_in_progress') === '1' || this.homolog().status === 'publishing') {
      return t(origin.locale, 'publishing');
    }
    this.store.set('rollback_in_progress', 1);
    const text = await this.announce('rollbackStarted', { pr: release.pull_request ?? '?' }, origin);
    const nodeId = release.pull_request_node_id;
    this.ctx.waitUntil(
      (async () => {
        try {
          const repo = this.repo();
          const title = truncate(`Revert "${release.summary}"`, 120);
          const revert = await repo.revertPullRequest(nodeId, {
            title,
            body: `Rollback requested by ${actor.name} in bohr.`,
          });
          const merged = await repo.mergePullRequest(revert.number, {
            sha: revert.headSha,
            title: `${title} (#${revert.number})`,
          });
          this.store.updateRelease(release.id, { status: 'rolled_back' });
          this.store.addRelease({
            id: `rel_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
            status: 'deploying',
            pull_request: revert.number,
            pull_request_node_id: revert.nodeId,
            commit_sha: merged.sha,
            summary: title,
            created_at: deps.now().toISOString(),
            approved_by: actor.name,
            chat_id: origin.source === 'telegram' ? origin.chatId : null,
            run_url: null,
            checked_at: null,
          });
          if (this.homolog().status === 'clean') {
            await repo.resetBranch(WORK_BRANCH, merged.sha);
            this.store.set('homolog_head_sha', merged.sha);
            await this.syncCheckout(WORK_BRANCH);
          }
          await this.announce('rollbackDone', { pr: revert.number }, origin);
          await this.wake(RELEASE_POLL_MS);
        } catch (error) {
          await this.announce('rollbackFailed', { error: errorText(error) }, origin);
        } finally {
          this.store.unset('rollback_in_progress');
        }
      })(),
    );
    return text;
  }

  private async trackReleases(): Promise<void> {
    const now = deps.now();
    for (const release of this.store.deployingReleases()) {
      if (release.commit_sha === null) continue;
      if (release.checked_at !== null && now.getTime() - Date.parse(release.checked_at) < RELEASE_POLL_MS - 1000) {
        continue;
      }
      this.store.updateRelease(release.id, { checked_at: now.toISOString() });
      let run: Awaited<ReturnType<RepoApi['latestWorkflowRun']>>;
      try {
        run = await this.repo().latestWorkflowRun(this.env.PRODUCTION_BRANCH, release.commit_sha);
      } catch (error) {
        console.error('[project] Could not read workflow runs:', errorText(error));
        continue;
      }
      const origin: Origin | undefined =
        release.chat_id === null ? undefined : { source: 'telegram', chatId: release.chat_id, locale: this.locale };
      if (run === null) {
        // No workflow ran for this commit; nothing will report the deploy, so stop waiting.
        if (now.getTime() - Date.parse(release.created_at) > RELEASE_GIVE_UP_MS) {
          this.store.updateRelease(release.id, { status: 'live' });
        }
        continue;
      }
      this.store.updateRelease(release.id, { run_url: run.url });
      if (run.status !== 'completed') continue;
      if (run.conclusion === 'success') {
        this.store.updateRelease(release.id, { status: 'live' });
        const url = this.env.PRODUCTION_URL ? `: ${this.env.PRODUCTION_URL}` : '';
        await this.announce('deployLive', { url }, origin);
      } else {
        this.store.updateRelease(release.id, { status: 'failed' });
        await this.announce('deployFailed', { url: run.url }, origin);
      }
    }
  }

  // Members

  async createInvite(actor: Actor): Promise<{ code: string; expiresAt: string } | null> {
    if (actor.role !== 'owner') return null;
    const code = newInviteCode();
    const now = deps.now();
    this.store.addInvite(await hashInviteCode(code), actor.key, now, INVITE_TTL_MS);
    this.store.deleteExpiredInvites(now);
    return { code, expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString() };
  }

  async join(identity: { key: string; name: string }, rawCode: string): Promise<'joined' | 'member' | 'invalid'> {
    if (this.store.member(identity.key) !== null) return 'member';
    const code = normalizeInviteCode(rawCode);
    if (code === null) return 'invalid';
    const now = deps.now();
    if (!this.store.redeemInvite(await hashInviteCode(code), identity.key, now)) return 'invalid';
    this.store.addMember({ key: identity.key, name: identity.name, role: 'member' }, now);
    this.ctx.waitUntil(
      reportMemberChange(this.env, { action: 'joined', memberKey: identity.key, name: identity.name }, deps.fetch),
    );
    return 'joined';
  }

  /** Removes a member by their position in the members list (1-based) or their key. */
  revoke(actor: Actor, target: string): { result: 'revoked' | 'owner_only' | 'not_found' | 'owner'; name?: string } {
    if (actor.role !== 'owner') return { result: 'owner_only' };
    const members = this.store.members();
    const index = Number(target);
    const member =
      Number.isInteger(index) && index > 0 ? members[index - 1] : members.find((row) => row.key === target);
    if (member === undefined) return { result: 'not_found' };
    if (member.role === 'owner') return { result: 'owner' };
    this.store.removeMember(member.key);
    // Whatever they left waiting would still run the agent on the project's key
    for (const request of this.store.cancellable(member.key)) {
      this.ctx.waitUntil(this.cancel(actor, request.id, { source: 'web', locale: this.locale }));
    }
    this.ctx.waitUntil(
      reportMemberChange(this.env, { action: 'removed', memberKey: member.key, name: member.name }, deps.fetch),
    );
    return { result: 'revoked', name: member.name };
  }

  updateSettings(
    actor: Actor,
    patch: { model?: string; maxBudgetUsd?: number; maxTurns?: number; locale?: Locale },
  ): boolean {
    if (actor.role !== 'owner') return false;
    if (patch.model !== undefined) this.store.set('model', patch.model);
    if (patch.maxBudgetUsd !== undefined) this.store.set('max_budget_usd', patch.maxBudgetUsd);
    if (patch.maxTurns !== undefined) this.store.set('max_turns', patch.maxTurns);
    if (patch.locale !== undefined) this.store.set('locale', patch.locale);
    return true;
  }

  // Views

  private requestView(row: RequestRow): RequestView {
    return {
      id: row.id,
      status: row.status,
      text: row.text,
      author: { key: row.author_key, name: row.author_name },
      source: row.source,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      summary: row.summary,
      costUsd: row.cost_usd,
      progress: row.progress,
    };
  }

  state(actor: Actor): ProjectState {
    const homolog = this.homolog();
    const running = this.store.running();
    return {
      project: {
        id: this.env.PROJECT_ID,
        name: this.env.PROJECT_NAME,
        repository: `${this.env.REPO_OWNER}/${this.env.REPO_NAME}`,
        productionBranch: this.env.PRODUCTION_BRANCH,
        productionUrl: this.env.PRODUCTION_URL || null,
        previewUrl: this.env.PREVIEW_URL || null,
        agentEnabled: this.agentEnabled,
        importStatus: this.importStatus(),
        previewState: this.previewState(),
      },
      you: { key: actor.key, role: actor.role },
      homolog: {
        status: homolog.status,
        version: homolog.version,
        headSha: homolog.headSha,
        changes: this.store
          .requestsInCycle(homolog.cycle)
          .map((row) => ({ requestId: row.id, summary: firstLine(row.summary ?? row.text) })),
      },
      current: running === null ? null : this.requestView(running),
      queue: this.store.queued().map((row) => this.requestView(row)),
      releases: this.store.releases(10).map((row) => ({
        id: row.id,
        status: row.status,
        pullRequest: row.pull_request,
        commitSha: row.commit_sha,
        createdAt: row.created_at,
        summary: row.summary,
      })),
      settings: {
        model: this.model(),
        maxBudgetUsd: this.store.number('max_budget_usd', DEFAULT_MAX_BUDGET_USD),
        maxTurns: this.store.number('max_turns', DEFAULT_MAX_TURNS),
        locale: this.locale,
      },
    };
  }

  // Connecting the owner's Claude subscription: the official CLI's `claude setup-token` runs in this
  // project's container; the instance relays the URL and the code, and stores the token it gets back.

  async claudeLoginStart(): Promise<{ loginId: string; url: string }> {
    const container = this.container();
    await container.start();
    return container.runner.claudeLoginStart();
  }

  async claudeLoginFinish(loginId: string, code: string): Promise<{ token: string }> {
    const container = this.container();
    // A container that went to sleep lost the sign-in; the runner answers that it does not know it
    await container.start();
    return container.runner.claudeLoginFinish(loginId, code);
  }

  async claudeLoginCancel(loginId: string): Promise<void> {
    const container = this.container();
    if (container.running) await container.runner.claudeLoginCancel(loginId);
  }

  // Entry points

  async telegramUpdate(update: TelegramUpdate): Promise<void> {
    await handleTelegramUpdate(this, update);
  }

  async api(call: ApiCall): Promise<Response> {
    const result = await handleApi(this, call);
    return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }

  /**
   * Why the preview is or is not up, for the panel: what this object recorded and, while the container runs,
   * what the runner reports, with the recent output of the install and dev server commands.
   */
  async previewDiagnostics(): Promise<{
    state: string;
    status: string | null;
    port: number | null;
    reason: string | null;
    containerRunning: boolean;
    runner: { status: string; port: number | null; reason: string | null; log: string } | null;
  }> {
    const container = this.container();
    const runner = container.running ? await container.runner.previewStatus() : null;
    const port = this.store.number('preview_port', 0);
    return {
      state: this.previewState(),
      status: this.store.get('preview_status'),
      port: port === 0 ? null : port,
      reason: this.store.get('preview_reason'),
      containerRunning: container.running,
      runner:
        runner === null
          ? null
          : {
              status: runner.status,
              port: runner.port ?? null,
              reason: runner.reason ?? null,
              log: runner.log.slice(-8000),
            },
    };
  }

  /** Preview traffic, from the preview Worker. */
  override async fetch(request: Request): Promise<Response> {
    const locale = this.locale;
    const title = this.env.PROJECT_NAME;
    const container = this.container();
    const stored = this.store.number('preview_port', 0);
    const port = stored === AGENT_PORT ? 0 : stored;
    const status = this.store.get('preview_status');
    const reason = this.store.get('preview_reason');
    // Nothing to start until the agent writes .bohr/preview.json; check again now and then, while it may
    const notConfigured = () =>
      previewPage(title, t(locale, 'previewNotConfigured'), this.importStatus() === 'done' ? null : 30);
    if (!container.running) {
      if (port === 0 && this.homolog().headSha === null && this.store.get('imported') === null) return notConfigured();
      this.ctx.waitUntil(this.bootPreview());
      if (status === 'stopped' && reason === 'not_configured') return notConfigured();
      return previewPage(title, t(locale, 'previewStarting'), 5);
    }
    if (status === 'stopped' && reason === 'not_configured') return notConfigured();
    if (status === 'failed' || (status === 'stopped' && reason === 'invalid')) {
      return previewPage(title, t(locale, 'previewFailed'), 30);
    }
    if (port === 0 || status !== 'running') return previewPage(title, t(locale, 'previewStarting'), 5);
    // Through the runner's proxy, which reaches dev servers that only listen on localhost; runners older than
    // the proxy are reached on the dev server's port directly
    const forward = toContainerRequest(request);
    const replay = forward.body === null ? undefined : forward.clone();
    let response: Response;
    try {
      response = await container.fetchPort(PREVIEW_PROXY_PORT, forward);
    } catch (error) {
      try {
        response = await container.fetchPort(port, replay ?? toContainerRequest(request));
      } catch (direct) {
        console.error('[project] The preview did not answer:', errorText(error), '/', errorText(direct));
        return previewPage(title, t(locale, 'previewNotAnswering'), 10);
      }
    }
    const headers = new Headers(response.headers);
    headers.set('x-robots-tag', 'noindex');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  /** After a cold start the disk is empty: check the work branch out again so the preview comes back. */
  private bootPreview(): Promise<void> {
    // Every preview request that finds the container asleep lands here; one boot serves them all.
    this.#booting ??= (async () => {
      try {
        this.store.set('preview_status', 'starting');
        const container = this.container();
        await container.start();
        this.store.set('runner_last_seq', 0);
        const branch = this.homolog().headSha === null ? this.env.PRODUCTION_BRANCH : WORK_BRANCH;
        await container.runner.gitSync(branch);
      } catch (error) {
        console.error('[project] Could not start the preview:', errorText(error));
      } finally {
        this.#booting = null;
      }
    })();
    return this.#booting;
  }

  override async alarm(): Promise<void> {
    try {
      const running = this.store.running();
      if (running !== null) await this.watchdog(running);
      // No new request while an update waits to restart this object
      else if (this.store.get('restart_pending') === null) await this.startNext();
      await this.trackReleases();
    } catch (error) {
      console.error('[project] Alarm failed:', errorText(error));
    }
    // An update waited for the request that was running: restart on the new code now that it is over
    if (this.store.get('restart_pending') !== null && this.store.running() === null) {
      await this.restartNow();
      return;
    }
    if (this.store.running() !== null) await this.ctx.storage.setAlarm(deps.alarmAt(WATCHDOG_INTERVAL_MS));
    // A held queue waits for an answer or a cancel, which wake this object themselves
    else if (this.store.queued().length > 0 && this.homolog().status !== 'publishing' && !this.queueHeld()) {
      await this.ctx.storage.setAlarm(deps.alarmAt(1000));
    } else if (this.store.deployingReleases().length > 0) {
      await this.ctx.storage.setAlarm(deps.alarmAt(RELEASE_POLL_MS));
    }
  }

  // Telegram setup

  /** Sets the command menu and remembers the bot's username, once. */
  async ensureBotSetup(bot: TelegramBot): Promise<string | null> {
    const known = this.store.get('telegram_username');
    if (known !== null && this.store.get('commands_set') === '1') return known;
    try {
      const me = await bot.getMe();
      if (me.username) this.store.set('telegram_username', me.username);
      await bot.setMyCommands(commandMenu('en'));
      await bot.setMyCommands(commandMenu('pt-BR'), { language_code: 'pt' });
      await bot.setMyCommands(commandMenu('es'), { language_code: 'es' });
      this.store.set('commands_set', 1);
      return me.username ?? null;
    } catch (error) {
      console.error('[project] Bot setup failed:', errorText(error));
      return known;
    }
  }

  /** A Telegram user unknown here may be a member under their instance user key; the instance knows. */
  async actorForTelegram(key: string, name: string): Promise<Actor | null> {
    const known = this.actorFor(key, name);
    if (known !== null) return known;
    const now = deps.now().getTime();
    if ((this.#unknownUntil.get(key) ?? 0) > now) return null;
    const aliases = (await memberAliases(this.env, key, deps.fetch)).filter((alias) => alias !== key);
    const actor = aliases.length === 0 ? null : this.actorFor(key, name, aliases);
    if (actor === null) this.#unknownUntil.set(key, now + 10 * 60_000);
    return actor;
  }

  /**
   * Offers the pending preview in a chat (the owner may open the bot after the import already finished):
   * the changes so far and the decision buttons. Returns false when there is nothing to decide.
   */
  async offerPendingDecision(chatId: number, locale: Locale): Promise<boolean> {
    const homolog = this.homolog();
    if (homolog.status !== 'pending') return false;
    const changes = this.store
      .requestsInCycle(homolog.cycle)
      .map((row) => `- ${truncate(firstLine(row.summary ?? row.text), 120)}`);
    const text = [t(locale, 'pendingPreview'), ...changes].join('\n');
    await this.retireDecisionMessage();
    const messageId = await this.send(chatId, text, this.decisionKeyboard(homolog.version));
    if (messageId !== null) {
      this.store.set('decision_chat_id', chatId);
      this.store.set('decision_message_id', messageId);
    }
    return true;
  }

  rememberNoticeChat(actor: Actor, chatId: number): void {
    if (actor.role === 'owner' && this.store.get('notify_chat_id') === null) this.store.set('notify_chat_id', chatId);
  }

  statusText(locale: Locale): string {
    const homolog = this.homolog();
    const running = this.store.running();
    const release = this.store.releases(1)[0];
    const releaseStatus = {
      deploying: 'releaseDeploying',
      live: 'releaseLive',
      failed: 'releaseFailed',
      rolled_back: 'releaseRolledBack',
    } as const;
    const lines = [
      t(locale, 'statusTitle', { project: this.env.PROJECT_NAME }),
      running === null
        ? t(locale, 'statusIdle')
        : `${t(locale, 'statusRunning', { text: truncate(firstLine(running.text), 120) })}${running.progress ? `\n${t(locale, 'progress', { status: running.progress })}` : ''}`,
      t(locale, 'statusQueue', { count: this.store.queued().length }),
      homolog.status === 'pending'
        ? t(locale, 'statusHomologPending')
        : homolog.status === 'publishing'
          ? t(locale, 'statusHomologPublishing')
          : t(locale, 'statusHomologClean'),
    ];
    if (release !== undefined && release.pull_request !== null) {
      lines.push(
        t(locale, 'statusRelease', { pr: release.pull_request, status: t(locale, releaseStatus[release.status]) }),
      );
    }
    if (!this.agentEnabled) lines.push('', t(locale, 'agentDisabled'));
    return lines.join('\n');
  }
}

/**
 * Why the runner stopped the preview. Runners that predate the `reason` field only say so in the log, where a
 * missing PREVIEW_CONFIG_PATH reads "... was not found".
 */
function previewStopReason(reason: string | undefined, log: string | undefined): string | undefined {
  if (reason !== undefined) return (PREVIEW_STOP_REASONS as readonly string[]).includes(reason) ? reason : undefined;
  if (log?.includes(`${PREVIEW_CONFIG_PATH} was not found`)) return 'not_configured';
  if (log?.includes(`${PREVIEW_CONFIG_PATH} is`)) return 'invalid';
  return undefined;
}

/**
 * A preview request as the container takes it: Cloudflare connects to containers over plain HTTP only (the
 * connection is already secure), so the public https URL becomes http, same host, path and query; the dev
 * server learns the original scheme and host from the X-Forwarded headers.
 */
export function toContainerRequest(request: Request): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.set('x-forwarded-host', url.host);
  url.protocol = 'http:';
  return new Request(url, { method: request.method, headers, body: request.body, redirect: 'manual' });
}
