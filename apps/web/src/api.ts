// Typed client for the instance API. Everything is same-origin: the instance Worker serves this app
// and its API together, and the HttpOnly session cookie (__Host-bohr_session) rides along on every call.
import type { AgentEffort, ChatEntry, Locale, MemberView, ProjectState, ProjectTemplate, Role } from '@bohr/shared';

export type { ProjectTemplate };

/** An API call that failed: HTTP status (0 when the network failed), a short code and a readable message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The runtime's error code ("not_a_member"), "network_error", or "http_<status>". */
    readonly code: string,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  /** JSON body; mutations without one send `{}`. */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** False leaves a 401 to the caller instead of sending the user to the sign-in page. */
  redirectOn401?: boolean;
}

const ERROR_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * Error bodies come in two shapes: the instance answers `{ error: "Sentence." }`, the project runtime
 * `{ error: "code", message?: "Sentence." }`. Codes are kept, sentences become the message.
 */
export function toApiError(status: number, body: unknown, fallback: string): ApiError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const error = typeof record.error === 'string' && record.error.length > 0 ? record.error : undefined;
  const detail = typeof record.message === 'string' && record.message.length > 0 ? record.message : undefined;
  const isCode = error !== undefined && ERROR_CODE.test(error);
  return new ApiError(
    status,
    isCode ? error : `http_${status}`,
    detail ?? (isCode ? undefined : error) ?? fallback,
    body,
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// The instance's own rule (lib/session.ts): a local path made of URL characters, never "//" or "/\".
const LOCAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;

/** Same-origin paths only, like the instance's own check; anything else (and the sign-in page) is the fallback. */
export function safeRedirect(value: unknown, fallback = '/projects'): string {
  if (typeof value !== 'string' || !LOCAL_PATH.test(value)) return fallback;
  return value === '/login' || value.startsWith('/login?') || value.startsWith('/login#') ? fallback : value;
}

export function loginPath(redirect: string): string {
  return `/login?redirect=${encodeURIComponent(safeRedirect(redirect))}`;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

let unauthorizedHandler: (path: string) => void = (path) => window.location.assign(loginPath(path));
let requestLocale: string | undefined;

/** Called with the current path when a call answers 401 (the session ended). */
export function setUnauthorizedHandler(handler: (path: string) => void): void {
  unauthorizedHandler = handler;
}

/** Sent as Accept-Language, so the project Worker answers in the language the user picked. */
export function setRequestLocale(locale: string | undefined): void {
  requestLocale = locale;
}

function withQuery(path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null;
  const type = response.headers.get('Content-Type') ?? '';
  if (type.includes('json')) return response.json().catch(() => null);
  const text = await response.text().catch(() => '');
  return text.length > 0 ? text : null;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (requestLocale) headers['Accept-Language'] = requestLocale;
  let body: string | undefined;
  // The API refuses mutations that are not JSON (415). DELETE carries a body only when it has one.
  if (method !== 'GET' && (method !== 'DELETE' || options.body !== undefined)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body ?? {});
  }

  let response: Response;
  try {
    response = await fetch(withQuery(path, options.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'network_error', error instanceof Error ? error.message : String(error));
  }

  const data = await readBody(response);
  if (!response.ok) {
    const error = toApiError(response.status, data, response.statusText || `HTTP ${response.status}`);
    if (response.status === 401 && options.redirectOn401 !== false) unauthorizedHandler(currentPath());
    throw error;
  }
  return data as T;
}

// Shapes of the instance API (apps/instance/src/routes)

/** Public facts about the instance, for the sign-in page (no session needed). */
export interface InstanceInfo {
  setup: { githubApp: boolean; platformBot: boolean };
  /** The instance charges for its use: bohr.io Cloud. Self-hosted instances have no billing. */
  billing: boolean;
  /** Username of the platform bot, which also signs people in. */
  telegramBot: string | null;
  githubAppSlug: string | null;
}

export type IdentityProvider = 'github' | 'email' | 'telegram';

/** admin: also manages the instance (/admin). */
export type UserRole = 'user' | 'admin';

export interface Me {
  /** user.role is the same as role (older instances only send it here). */
  user: { id: string; name: string | null; email: string | null; role?: UserRole };
  identities: { provider: IdentityProvider; username: string | null }[];
  role: UserRole;
}

/** How people can sign in to this instance (GET /auth/methods). */
export interface AuthMethods {
  github: boolean;
  email: boolean;
}

/** Everything connected to the user's account (GET /api/me/connections). */
export interface Connections {
  /** Sign-in methods and the Telegram link; canRemove is false for the last way to sign in. */
  identities: { provider: IdentityProvider; username: string | null; canRemove: boolean }[];
  /** GitHub accounts where the bohr GitHub App is installed (GitHub's installation id), with how many projects use each. */
  githubInstallations: { id: number; account: string; projects: number }[];
  cloudflare: { id: string; accountId: string; accountName: string | null; projects: number }[];
  telegram: { username: string | null } | null;
  agent: AgentSettings;
  subscription: { status: string } | null;
}

/** Only what every user must set up; projects and the agent come afterwards. */
export type OnboardingStep = 'subscription' | 'cloudflare' | 'cloudflare_account' | 'github' | 'done';

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface Onboarding {
  step: OnboardingStep;
  /** The project the Telegram onboarding created, if any (the web wizard does not use it). */
  projectId?: string | null;
  cloudflare: {
    connections: CloudflareConnection[];
    tokenTemplateUrl: string;
  };
  github: { installUrl: string | null };
  pendingAccounts: CloudflareAccount[];
  /** The instance's platform bot, when it has one. */
  telegram: { username: string; canManageBots: boolean } | null;
  /**
   * bohr.io Cloud charges a subscription (Stripe) to use the instance; projects always run in the
   * user's own Cloudflare account. Self-hosted instances have no billing.
   */
  billing: { enabled: boolean; subscribed: boolean };
  /** The user's agent settings (GET /api/me/agent) exist. */
  agent: { configured: boolean };
}

/**
 * The agent's model provider, set once per user and applied to every project they own: the Anthropic API,
 * any endpoint compatible with the Anthropic Messages API (OpenRouter, DeepSeek, a LiteLLM proxy…), or the
 * user's Claude subscription (Pro/Max) through the official Claude Code CLI.
 */
export type AgentProvider = 'anthropic' | 'compatible' | 'subscription';

export type { AgentEffort };

export interface AgentSettings {
  configured: boolean;
  provider: AgentProvider | null;
  /** Compatible endpoints only: the part before /v1/messages. */
  baseUrl: string | null;
  /** null: bohr's default model (claude-opus-5-5 on Anthropic). */
  model: string | null;
  /** null: the model's default effort. */
  effort: AgentEffort | null;
  /** The key's last characters ("…abcd"). */
  keyHint: string | null;
}

/**
 * A Claude subscription sign-in in progress: `claude setup-token` runs in the instance's sign-in container
 * (`projectId` null) or, on instances without one, in the container of one of the owner's projects; the user
 * authorizes at `url`.
 */
export interface SubscriptionLogin {
  projectId: string | null;
  loginId: string;
  url: string;
}

export interface AgentSettingsInput {
  provider: AgentProvider;
  /** Omitted: keep the stored key (only while the provider stays the same). With a subscription, its token. */
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  effort?: AgentEffort | null;
}

/** An API token (Account › Tokens): for scripts and AI agents (BOHR_TOKEN), or made by `bohr login` (source "cli"). */
export interface ApiToken {
  id: string;
  name: string;
  /** The token's first characters ("bohr_k3x9…"); the token itself is only shown when created. */
  hint: string;
  source: 'panel' | 'cli';
  /** null: all the user's projects. A project the user no longer reaches has a null name. */
  projects: { id: string; name: string | null }[] | null;
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** GET /api/me/tokens: the tokens, and the projects a new one may be limited to. */
export interface Tokens {
  tokens: ApiToken[];
  projects: { id: string; name: string; repository: string }[];
}

export interface NewToken {
  name: string;
  /** null: all my projects. */
  projectIds: string[] | null;
  /** null: never expires. */
  expiresInDays: number | null;
}

/** A `bohr login` waiting for the signed-in person to approve it (the /cli page). */
export interface CliLogin {
  userCode: string;
  /** "CLI on <hostname>": the name the token gets. */
  clientName: string;
  /** done: approved, and the CLI already got its token. */
  status: 'pending' | 'approved' | 'denied' | 'done' | 'expired';
  createdAt: string;
  expiresAt: string;
}

/** A GitHub Actions run of the project's repository (a deploy). */
export interface Build {
  id: number;
  number: number | null;
  workflow: string | null;
  title: string | null;
  branch: string | null;
  commit: string;
  event: string;
  /** GitHub's: queued, in_progress, completed, waiting… */
  status: string | null;
  /** GitHub's, once completed: success, failure, cancelled, skipped… */
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** A deploy `bohr deploy` made with wrangler in the owner's Cloudflare account (GET …/cli-deploys). */
export interface CliDeploy {
  id: string;
  branch: string;
  /** true: production (`wrangler deploy`); false: a preview (`wrangler versions upload`). */
  production: boolean;
  workerName: string | null;
  versionId: string | null;
  /** The preview's address, or production's; null when Cloudflare gave none. */
  url: string | null;
  /** null when the working tree had uncommitted changes. */
  commitSha: string | null;
  userId: string | null;
  createdAt: string;
}

export interface BuildJob {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: { number: number; name: string; status: string | null; conclusion: string | null }[];
  /** The job's log (its last part when long), with timestamps. */
  log: string;
}

/** bohr.io Cloud's subscription (Stripe). The billing endpoints answer 404 where billing is off. */
export interface Billing {
  subscription: {
    /** Stripe's status ("active", "past_due", "canceled"…), or "imported" for v1 customers not synced yet. */
    status: string;
    /** A bohr v1 customer, who keeps the old price. */
    legacy: boolean;
    currentPeriodEnd: string | null;
    priceId: string | null;
  } | null;
}

export type SubscriptionResult = { status: 'ready' } | { status: 'payment_required'; checkoutUrl: string };

/**
 * What a Cloudflare API token must be able to do (@bohr/cloudflare TokenCapability). Containers are optional (the
 * agent's sandbox, on the Workers Paid plan) and never reported missing.
 */
export type TokenCapability = 'workers_scripts' | 'durable_objects' | 'workers_subdomain' | 'account_read';

export type CloudflareResult =
  /** containers: the account can run the agent's sandbox itself (absent on older instances). */
  | { status: 'connected'; connectionId: string; accountName: string | null; containers?: boolean }
  | { status: 'choose_account'; accounts: CloudflareAccount[] }
  | { status: 'missing'; missing: TokenCapability[]; errors: Partial<Record<TokenCapability, string>> };

export interface Repository {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface NewProject {
  repository: string;
  /** The organization (slug) the project belongs to; omitted for a personal project. */
  org?: string;
  productionBranch?: string;
  name?: string;
  locale?: string;
}

/** POST /api/templates/projects: the project's name is also the new repository's. */
export interface NewTemplateProject {
  template: string;
  name: string;
  /** The organization (slug) that owns the repository and the project; omitted for a personal project. */
  org?: string;
  private: boolean;
  locale?: string;
}

/** The admin password of a project created from a template, shown once, and where its site will be. */
export interface TemplatePassword {
  password: string;
  url: string | null;
}

export type RuntimeStatus = 'pending' | 'provisioning' | 'ready' | 'error';

export interface Runtime {
  status: RuntimeStatus;
  error: string | null;
  previewUrl: string | null;
  botUsername: string | null;
  version: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  repository: string;
  status: 'active' | 'migrating' | 'suspended';
  mode: 'managed' | 'byo';
  role: Role;
  productionUrl: string | null;
  /** The project Worker (agent, bot, preview); null for projects that only deploy. */
  runtime: { status: RuntimeStatus; previewUrl: string | null; botUsername: string | null } | null;
  /** The organization the project belongs to; null for a personal project (absent on older instances). */
  org?: OrgRef | null;
  /** When the project last changed (absent on older instances). */
  updatedAt?: string;
  /** The latest deploy, of any branch; null before the first one (absent on older instances). */
  lastDeploy?: { status: 'building' | 'success' | 'error'; branch: string; createdAt: string } | null;
}

/**
 * One address of a project that moved out of bohr's hosting. moved: served from the owner's account;
 * redirected: a bohr.io address that now redirects there; pending: the domain's zone is not in the owner's
 * Cloudflare account yet; dropped: a branch preview address that is no longer deployed.
 */
export interface MovedHostname {
  hostname: string;
  status: 'moved' | 'proxied' | 'redirected' | 'pending' | 'dropped';
}

/** Moving a project migrated from bohr v1 (hosted by bohr) to its owner's own Cloudflare account. */
export type MoveView =
  | { status: 'available' }
  | { status: 'unavailable' }
  | {
      status: 'prepared' | 'done';
      /** The Worker's name in the owner's account. */
      script: string;
      accountId: string;
      pullRequest: { number: number; url: string };
      hostnames: MovedHostname[];
    };

export interface CloudflareConnection {
  id: string;
  accountId: string;
  accountName: string | null;
}

/** runtime: the site's production Worker; build: read by the deploy workflow while installing and building. */
export type VariableTarget = 'runtime' | 'build';

export interface Variable {
  key: string;
  target: VariableTarget;
  secret: boolean;
  /** null for secrets, which cannot be read back. */
  value: string | null;
  updatedAt: string;
}

export interface VariableInput {
  target: VariableTarget;
  key: string;
  value: string;
  secret: boolean;
}

/** Basic Auth in front of the site. */
export interface Protection {
  type: 'none' | 'basic';
  users: { username: string }[];
  /** Paths that skip the protection: exact, or a prefix when they end with "*". */
  bypassPaths: string[];
  /** custom_deploy: the site deploys with its own command, so bohr cannot put the protection in front of it. */
  warning: 'custom_deploy' | null;
}

export interface ProtectionInput {
  type: 'none' | 'basic';
  /** A user without a password keeps the one it had. */
  users: { username: string; password?: string }[];
  bypassPaths: string[];
}

/** The site's custom domains: read-only while bohr hosts the project, managed in the owner's account otherwise. */
export type Domains = (
  | { hosting: 'bohr'; domains: { id: string; hostname: string; status: 'pending' | 'live' }[] }
  | {
      hosting: 'own';
      /** False until the site's first deploy created its Worker. */
      deployed: boolean;
      worker: string | null;
      workersDev: string | null;
      domains: { id: string; hostname: string }[];
      /** The zones of the owner's Cloudflare account a domain can be added under. */
      zones: { name: string; status: string }[];
      error?: string;
    }
) & { canEdit: boolean };

/** member: the user takes part in the project; admin: an instance admin looking at someone else's project. */
export type ProjectAccess = 'member' | 'admin';

/** GET /api/projects/:id: the instance's view of one project. */
export interface ProjectDetail {
  project: {
    id: string;
    name: string;
    repository: string;
    productionBranch: string;
    status: ProjectSummary['status'];
    mode: ProjectSummary['mode'];
    role: Role | null;
    access?: ProjectAccess;
    org?: OrgRef | null;
  };
  /** The same as project.access; older instances only send that one (detailAccess() reads either). */
  access?: ProjectAccess;
  /** The organization the project belongs to, null for a personal one; the same as project.org (detailOrg()). */
  org?: OrgRef | null;
}

/** The access of GET /api/projects/:id: at the top level, or inside project on older instances. */
export function detailAccess(detail: ProjectDetail): ProjectAccess | null {
  return detail.access ?? detail.project.access ?? null;
}

/** The organization of GET /api/projects/:id: at the top level, or inside project on older instances. */
export function detailOrg(detail: ProjectDetail): OrgRef | null {
  return detail.org ?? detail.project.org ?? null;
}

// Organizations: a GitHub organization where the bohr GitHub App is installed, with its own subscription,
// Cloudflare account and agent settings. Members mirror the GitHub organization's.

export type OrgRole = 'admin' | 'member';

/** An organization, as a badge or a link: its slug (the lowercase GitHub login) and name. */
export interface OrgRef {
  slug: string;
  name: string;
}

/** What the organization has set up; projects need the subscription (on bohr.io Cloud) and Cloudflare. */
export interface OrgStatus {
  subscription: boolean;
  cloudflare: boolean;
  agent: boolean;
  /** The bohr GitHub App is still installed on the GitHub organization. */
  installation: boolean;
}

/** GET /api/orgs: an organization the user is an active member of. */
export interface OrgSummary extends OrgRef {
  id: string;
  avatarUrl: string | null;
  role: OrgRole;
  status: OrgStatus;
}

/** GET /api/orgs/:slug */
export interface OrgDetail {
  org: OrgSummary & {
    githubLogin: string;
    /** False while the GitHub App lacks the Members: read permission: only the installer was imported. */
    membersPermission: boolean;
  };
  billing: { enabled: boolean; subscribed: boolean };
}

/**
 * A member of an organization, mirrored from GitHub. pending: no bohr account yet (activated when they sign in
 * with GitHub). source: 'bohr' when the role was changed in bohr (kept until GitHub changes it).
 */
export interface OrgMember {
  githubUserId: number;
  githubLogin: string;
  name: string | null;
  email: string | null;
  userId: string | null;
  role: OrgRole;
  status: 'active' | 'pending';
  source: 'github' | 'bohr';
}

export interface OrgSync {
  members: OrgMember[];
  added: number;
  removed: number;
  updated: number;
  /** False when the GitHub App lacks Members: read (nothing was imported). */
  membersPermission?: boolean;
}

/** GET /api/orgs/:slug/cloudflare */
export interface OrgCloudflare {
  /** projects: how many of the organization's projects run in the account (absent on older instances). */
  connections: (CloudflareConnection & { projects?: number })[];
  tokenTemplateUrl: string;
}

// The admin area (/api/manage, admins only)

export interface ManageOverview {
  users: number;
  projects: number;
  subscriptions: { active: number };
  runtimes: Record<RuntimeStatus, number>;
}

export interface ManagedUser {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  createdAt: string;
  identities: { provider: IdentityProvider; username: string | null }[];
  projects: number;
  /** The bohr.io Cloud subscription's status, or null without one. */
  subscription: string | null;
  /** Organizations the user is a member of (when the instance lists them). */
  orgs?: OrgRef[];
}

/** GET /api/manage/orgs */
export interface ManagedOrg extends OrgRef {
  id: string;
  members: number;
  projects: number;
  /** The organization's subscription status ("active"…), or null without one. */
  subscription: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  repository: string;
  owner: { id: string; name: string | null; email: string | null };
  mode: ProjectSummary['mode'];
  status: ProjectSummary['status'];
  createdAt: string;
  productionUrl: string | null;
  runtime: { status: RuntimeStatus; version: string | null; error: string | null } | null;
  /** The organization the project belongs to, or null for a personal project. */
  org?: OrgRef | null;
}

export interface ManagedUserDetail {
  user: ManagedUser;
  projects: ProjectRow[];
  /** The user's organizations, with their role in each. */
  orgs?: (OrgRef & { role: OrgRole })[];
  connections: {
    githubInstallations: { id: number; account: string }[];
    cloudflare: { id: string; accountId: string; accountName: string | null }[];
    telegram: { username: string | null } | null;
    agent: { configured: boolean };
  };
}

/** Anonymous, opt-in usage telemetry of a self-hosted instance. */
export interface Telemetry {
  /** False on bohr.io Cloud, which sends nothing. */
  available: boolean;
  enabled: boolean;
  /** The operator turned telemetry off for good (BOHR_TELEMETRY=off): it cannot be turned on here. */
  forcedOff?: boolean;
  instanceId: string;
  lastSentAt: string | null;
  endpoint: string;
  /** Exactly what is sent, once a day. */
  payload: { instanceId: string; version: string; projects: number };
}

// DNS of the domains whose zone bohr hosts (bohr.io Cloud): bohr v1 kept its customers' domains in bohr's
// Cloudflare account. Owners and organization admins change the records; members read them.

/** A domain whose DNS bohr hosts. */
export interface DnsZoneSummary {
  name: string;
  canEdit: boolean;
  /** The organization it belongs to; null for the user's own. */
  org: { slug: string; name: string } | null;
  /** Instance admins only: who it belongs to (a GitHub login or an org), null when nobody was given it yet. */
  owner?: string | null;
}

/** The types the panel creates and edits; a zone may hold others (NS…), shown read-only. */
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsRecord {
  id: string;
  type: string;
  /** The full name: "www.example.com", or the domain itself. */
  name: string;
  /** SRV: "weight port target"; CAA: `flags tag "value"`. */
  content: string;
  /** 1 is automatic. */
  ttl: number;
  proxied: boolean;
  /** MX and SRV only. */
  priority: number | null;
  /** bohr serves a site through it (or it is the domain's nameservers): read-only. */
  managedByBohr: boolean;
  editable: boolean;
}

export interface DnsZoneDetail {
  zone: DnsZoneSummary & { access: 'member' | 'admin' };
  records: DnsRecord[];
}

export interface DnsRecordInput {
  type: DnsRecordType;
  /** "@" is the domain itself; "www" or "www.example.com". */
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
}

/** Lists of the admin area come 50 to a page. */
export const MANAGE_PAGE_SIZE = 50;

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const userPath = (userId: string) => `/api/manage/users/${encodeURIComponent(userId)}`;
const orgPath = (slug: string) => `/api/orgs/${encodeURIComponent(slug)}`;
const zonePath = (zone: string) => `/api/dns/zones/${encodeURIComponent(zone)}`;

type AgentSaved = { agent: AgentSettings; projects: { applied: number; failed: number } };
export interface SubscriptionFinish {
  projectId: string | null;
  loginId: string;
  code: string;
  model?: string | null;
  effort?: AgentEffort | null;
}

export const api = {
  instance: () => request<InstanceInfo>('/api/instance', { redirectOn401: false }),
  me: () => request<Me>('/api/me', { redirectOn401: false }),
  logout: () => request<null>('/auth/logout', { method: 'POST', redirectOn401: false }),
  /** Deep link to the platform bot that attaches the Telegram account (404 without a platform bot). */
  telegramLink: () => request<{ url: string }>('/api/me/telegram-link', { method: 'POST' }),

  /** The sign-in methods this instance offers. */
  authMethods: () => request<AuthMethods>('/auth/methods', { redirectOn401: false }),
  /**
   * Sends a 6-digit code to the address. Answers { sent: true } even for unknown addresses; 400 when the
   * address is invalid, 429 when rate limited.
   */
  emailStart: (input: { email: string; redirect?: string; locale?: string }) =>
    request<{ sent: boolean }>('/auth/email/start', { method: 'POST', body: input, redirectOn401: false }),
  /**
   * Sets the session cookie and says where to go. 400 { error, attemptsLeft } for a wrong code; 410 once
   * the code expired or had too many attempts.
   */
  emailVerify: (input: { email: string; code: string }) =>
    request<{ redirect: string }>('/auth/email/verify', { method: 'POST', body: input, redirectOn401: false }),

  /** Sign-in methods, GitHub App installations, Cloudflare accounts, Telegram, the agent and the subscription. */
  connections: () => request<Connections>('/api/me/connections'),
  /** Removes a sign-in method or the Telegram link; 409 for the last way to sign in. */
  removeIdentity: (provider: IdentityProvider) =>
    request<Connections>(`/api/me/identities/${encodeURIComponent(provider)}`, { method: 'DELETE' }),
  /** Adds an email sign-in: sends a code to the address. */
  linkEmailStart: (email: string) =>
    request<{ sent: boolean }>('/api/me/email/start', { method: 'POST', body: { email } }),
  /** 409 when the address belongs to another account. */
  linkEmailVerify: (email: string, code: string) =>
    request<{ identity: { provider: 'email'; username: string } }>('/api/me/email/verify', {
      method: 'POST',
      body: { email, code },
    }),
  /** Uninstalls the bohr GitHub App from that GitHub account; 409 (listing them) while projects use it. */
  disconnectGithubInstallation: (id: number) =>
    request<Connections>(`/api/me/github-installations/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
  /** 409 (listing them) while projects use it; the hint says to delete the API token in Cloudflare too. */
  disconnectCloudflare: (id: string) =>
    request<Connections & { hint: string | null }>(`/api/me/cloudflare/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /**
   * Deletes the account and everything bohr created for it. `deleteSites` also removes the sites published
   * in the user's Cloudflare accounts. What could not be removed comes back as warnings.
   */
  deleteAccount: (input: { deleteSites: boolean }) =>
    request<{ warnings: string[] }>('/api/me', { method: 'DELETE', body: { confirm: true, ...input } }),

  manageOverview: () => request<ManageOverview>('/api/manage/overview'),
  /** Updates every project runtime to the instance's runtime version. */
  updateRuntimes: () =>
    request<{ version: string; updating: string[] }>('/api/manage/runtimes/update', { method: 'POST' }),
  manageUsers: (query: { query?: string; page?: number } = {}) =>
    request<{ users: ManagedUser[]; total: number }>('/api/manage/users', { query }),
  manageUser: (userId: string) => request<ManagedUserDetail>(userPath(userId)),
  /** 409 when it would leave the instance without an admin. */
  setUserRole: (userId: string, role: UserRole) =>
    request<{ user: ManagedUser }>(`${userPath(userId)}/role`, { method: 'PUT', body: { role } }),
  deleteUser: (userId: string, input: { deleteSites: boolean }) =>
    request<{ warnings: string[] }>(userPath(userId), { method: 'DELETE', body: input }),
  manageProjects: (query: { query?: string; page?: number } = {}) =>
    request<{ projects: ProjectRow[]; total: number }>('/api/manage/projects', { query }),
  manageOrgs: (query: { query?: string; page?: number } = {}) =>
    request<{ orgs: ManagedOrg[]; total: number }>('/api/manage/orgs', { query }),
  telemetry: () => request<Telemetry>('/api/manage/telemetry'),
  setTelemetry: (enabled: boolean) => request<Telemetry>('/api/manage/telemetry', { method: 'PUT', body: { enabled } }),

  onboarding: () => request<Onboarding>('/api/onboarding'),
  billing: () => request<Billing>('/api/billing'),
  /** Stripe Checkout for the bohr.io Cloud subscription; Stripe returns to /billing?billing=success. */
  billingCheckout: () => request<{ url: string }>('/api/billing/checkout', { method: 'POST' }),
  /** Stripe's customer portal; it returns to /billing. */
  billingPortal: () => request<{ url: string }>('/api/billing/portal', { method: 'POST' }),

  /**
   * bohr.io Cloud: moves the onboarding past the subscription step when the user is subscribed;
   * otherwise answers with a Stripe Checkout URL, which returns to /start?billing=success.
   */
  checkSubscription: () => request<SubscriptionResult>('/api/onboarding/subscription', { method: 'POST' }),
  connectCloudflare: (token: string) =>
    request<CloudflareResult>('/api/onboarding/cloudflare', { method: 'POST', body: { token } }),
  chooseCloudflareAccount: (accountId: string) =>
    request<CloudflareResult>('/api/onboarding/cloudflare/account', { method: 'POST', body: { accountId } }),

  /** The user's API tokens (never the tokens themselves) and the projects a new one may list. */
  tokens: () => request<Tokens>('/api/me/tokens'),
  /** The token is answered once, here; the list comes back with it. */
  createToken: (input: NewToken) =>
    request<Tokens & { token: string; id: string }>('/api/me/tokens', { method: 'POST', body: input }),
  revokeToken: (tokenId: string) =>
    request<Tokens>(`/api/me/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }),
  /** A `bohr login` by its code (404 when no sign-in has it). */
  cliLogin: (code: string) => request<{ login: CliLogin }>(`/api/cli/logins/${encodeURIComponent(code)}`),
  /** 409 when it was already answered or expired. */
  answerCliLogin: (code: string, approve: boolean) =>
    request<{ login: CliLogin }>(`/api/cli/logins/${encodeURIComponent(code)}/${approve ? 'approve' : 'deny'}`, {
      method: 'POST',
    }),

  /** The agent's provider, model and effort for every project the user owns. */
  agentSettings: () => request<{ agent: AgentSettings }>('/api/me/agent'),
  /** 400 with a sentence when the instance or the provider refuses the settings. */
  saveAgentSettings: (input: AgentSettingsInput) =>
    request<AgentSaved>('/api/me/agent', { method: 'PUT', body: input }),
  /** Turns the agent off in every project the user owns. */
  removeAgentSettings: () => request<{ agent: AgentSettings }>('/api/me/agent', { method: 'DELETE' }),
  /**
   * Starts connecting the user's Claude subscription. On instances without the sign-in container, 409 with code
   * "no_runtime" when no project is ready.
   */
  startSubscription: () => request<SubscriptionLogin>('/api/me/agent/subscription/start', { method: 'POST' }),
  /** The code claude.ai showed; the instance keeps the token and answers like saveAgentSettings. */
  finishSubscription: (input: SubscriptionFinish) =>
    request<AgentSaved>('/api/me/agent/subscription/finish', { method: 'POST', body: input }),
  cancelSubscription: (input: { projectId: string | null; loginId: string }) =>
    request<{ cancelled: boolean }>('/api/me/agent/subscription/cancel', { method: 'POST', body: input }),

  /** Repositories the GitHub App reaches that are not projects yet: the personal ones, or an organization's. */
  repositories: (org?: string) => request<{ repositories: Repository[] }>('/api/repositories', { query: { org } }),
  /**
   * Creates the project and starts setting up its runtime. With `org`, inside the organization (its subscription,
   * Cloudflare account and agent settings). `runtime` is false when the agent cannot run yet (a self-hosted
   * instance whose Cloudflare account has no Containers): the project only deploys.
   */
  createProject: (input: NewProject) =>
    request<{ projectId: string; runtime?: boolean }>('/api/projects', { method: 'POST', body: input }),
  /** The templates a new project can start from. */
  templates: () => request<{ templates: ProjectTemplate[] }>('/api/templates'),
  /**
   * Checks and keeps a new project from a template; the browser then goes to `url` (GitHub's authorization), and
   * GitHub's return creates it and comes back to /projects/new?project=… (or the form with ?error=).
   */
  startTemplateProject: (input: NewTemplateProject) =>
    request<{ url: string }>('/api/templates/projects', { method: 'POST', body: input }),
  /** The admin password of a project just created from a template: answered once (404 afterwards). */
  templatePassword: (projectId: string) =>
    request<TemplatePassword>('/api/templates/password', { method: 'POST', body: { projectId } }),

  /** The personal projects, or the organization's projects the user can access. */
  projects: (org?: string) => request<{ projects: ProjectSummary[] }>('/api/projects', { query: { org } }),
  /** The personal scope: the user's projects outside organizations. */
  personalProjects: () => request<{ projects: ProjectSummary[] }>('/api/projects', { query: { scope: 'personal' } }),
  /** access: 'admin' when an instance admin opens someone else's project. */
  project: (projectId: string) => request<ProjectDetail>(projectPath(projectId)),
  runtime: (projectId: string) => request<Runtime>(`${projectPath(projectId)}/runtime`),
  /** Owner only (403 otherwise). */
  moveStatus: (projectId: string) =>
    request<{ move: MoveView; connections: CloudflareConnection[] }>(`${projectPath(projectId)}/move`),
  /** Opens the pull request that deploys to the chosen account; 409 with a reason when it cannot. */
  prepareMove: (projectId: string, connectionId: string) =>
    request<{ move: MoveView }>(`${projectPath(projectId)}/move`, { method: 'POST', body: { connectionId } }),
  /** After the merge and the deploy; 409 while the pull request is open or the Worker is not deployed yet. */
  completeMove: (projectId: string) =>
    request<{ move: MoveView }>(`${projectPath(projectId)}/move/complete`, { method: 'POST' }),
  /** Members read them (canEdit false); the owner changes them. */
  variables: (projectId: string) =>
    request<{ variables: Variable[]; canEdit: boolean }>(`${projectPath(projectId)}/variables`),
  setVariable: (projectId: string, input: VariableInput) =>
    request<{ variables: Variable[] }>(`${projectPath(projectId)}/variables`, { method: 'PUT', body: input }),
  deleteVariable: (projectId: string, target: VariableTarget, key: string) =>
    request<{ variables: Variable[] }>(`${projectPath(projectId)}/variables`, {
      method: 'DELETE',
      query: { target, key },
    }),
  domains: (projectId: string) => request<Domains>(`${projectPath(projectId)}/domains`),
  addDomain: (projectId: string, hostname: string) =>
    request<Domains>(`${projectPath(projectId)}/domains`, { method: 'POST', body: { hostname } }),
  removeDomain: (projectId: string, domainId: string) =>
    request<Domains>(`${projectPath(projectId)}/domains/${encodeURIComponent(domainId)}`, { method: 'DELETE' }),
  protection: (projectId: string) =>
    request<{ protection: Protection; canEdit: boolean }>(`${projectPath(projectId)}/protection`),
  setProtection: (projectId: string, input: ProtectionInput) =>
    request<{ protection: Protection }>(`${projectPath(projectId)}/protection`, { method: 'PUT', body: input }),
  /**
   * Turns the agent on for a project that only deploys (migrated from bohr v1, or whose account could not run
   * Containers); 409 when it has a runtime, 422 containers_unavailable while the account still cannot run them.
   */
  enableRuntime: (projectId: string) =>
    request<{ started: boolean }>(`${projectPath(projectId)}/runtime/enable`, { method: 'POST' }),
  retryRuntime: (projectId: string) =>
    request<{ started: boolean }>(`${projectPath(projectId)}/runtime/retry`, { method: 'POST' }),
  /** Asks the project's agent to prepare the repository (the import), as its owner. */
  importRepository: (projectId: string) =>
    request<{ started: boolean }>(`${projectPath(projectId)}/runtime/import`, { method: 'POST' }),
  /** A bot token from BotFather. */
  connectTelegramBot: (projectId: string, token: string) =>
    request<{ username: string }>(`${projectPath(projectId)}/runtime/telegram-bot`, {
      method: 'POST',
      body: { token },
    }),
  /** The repository's GitHub Actions runs, newest first. */
  builds: (projectId: string, signal?: AbortSignal) =>
    request<{ builds: Build[] }>(`${projectPath(projectId)}/builds`, { signal }),
  /** The deploys the CLI made in the owner's Cloudflare account, newest first (projects in their owner's account). */
  cliDeploys: (projectId: string, signal?: AbortSignal) =>
    request<{ deploys: CliDeploy[] }>(`${projectPath(projectId)}/cli-deploys`, { signal }),
  /** A run's jobs, with their steps and logs. */
  buildJobs: (projectId: string, runId: number, signal?: AbortSignal) =>
    request<{ jobs: BuildJob[] }>(`${projectPath(projectId)}/builds/${encodeURIComponent(String(runId))}`, { signal }),
  /**
   * Owner only. `confirm` is the project's name; `deleteSite` also removes the site's Worker in the owner's
   * Cloudflare account. What could not be removed comes back as warnings.
   */
  deleteProject: (projectId: string, input: { confirm: string; deleteSite: boolean }) =>
    request<{ warnings: string[] }>(projectPath(projectId), { method: 'DELETE', body: input }),

  /** The organizations the user is an active member of. */
  orgs: () => request<{ orgs: OrgSummary[] }>('/api/orgs'),
  /** The GitHub App's installation page, where the user picks a GitHub organization; GitHub returns to /orgs/:slug. */
  orgInstallUrl: () => request<{ url: string }>('/api/orgs/install-url'),
  org: (slug: string) => request<OrgDetail>(orgPath(slug)),
  orgMembers: (slug: string) => request<{ members: OrgMember[] }>(`${orgPath(slug)}/members`),
  /** Admins: imports the members from GitHub again. */
  syncOrgMembers: (slug: string) => request<OrgSync>(`${orgPath(slug)}/members/sync`, { method: 'POST' }),
  /** Admins: 409 when it would leave the organization without an admin. */
  setOrgMemberRole: (slug: string, githubUserId: number, role: OrgRole) =>
    request<{ members: OrgMember[] }>(`${orgPath(slug)}/members/${encodeURIComponent(String(githubUserId))}`, {
      method: 'PUT',
      body: { role },
    }),
  /** Admins: removes the member's access in bohr (GitHub is not changed); a later sync does not bring them back. */
  removeOrgMember: (slug: string, githubUserId: number) =>
    request<{ members: OrgMember[] }>(`${orgPath(slug)}/members/${encodeURIComponent(String(githubUserId))}`, {
      method: 'DELETE',
    }),
  /** The organization's agent settings, for every project of the organization (members read, admins change). */
  orgAgentSettings: (slug: string) => request<{ agent: AgentSettings }>(`${orgPath(slug)}/agent`),
  saveOrgAgentSettings: (slug: string, input: AgentSettingsInput) =>
    request<AgentSaved>(`${orgPath(slug)}/agent`, { method: 'PUT', body: input }),
  removeOrgAgentSettings: (slug: string) =>
    request<{ agent: AgentSettings }>(`${orgPath(slug)}/agent`, { method: 'DELETE' }),
  /** Connects a Claude subscription for the organization, in the container of one of its projects. */
  startOrgSubscription: (slug: string) =>
    request<SubscriptionLogin>(`${orgPath(slug)}/agent/subscription/start`, { method: 'POST' }),
  finishOrgSubscription: (slug: string, input: SubscriptionFinish) =>
    request<AgentSaved>(`${orgPath(slug)}/agent/subscription/finish`, { method: 'POST', body: input }),
  cancelOrgSubscription: (slug: string, input: { projectId: string | null; loginId: string }) =>
    request<{ cancelled: boolean }>(`${orgPath(slug)}/agent/subscription/cancel`, { method: 'POST', body: input }),
  /** Admins: the organization's Cloudflare accounts. */
  orgCloudflare: (slug: string) => request<OrgCloudflare>(`${orgPath(slug)}/cloudflare`),
  connectOrgCloudflare: (slug: string, token: string) =>
    request<CloudflareResult>(`${orgPath(slug)}/cloudflare`, { method: 'POST', body: { token } }),
  chooseOrgCloudflareAccount: (slug: string, accountId: string) =>
    request<CloudflareResult>(`${orgPath(slug)}/cloudflare/account`, { method: 'POST', body: { accountId } }),
  /** 409 while projects of the organization use it. */
  disconnectOrgCloudflare: (slug: string, id: string) =>
    request<OrgCloudflare & { hint: string | null }>(`${orgPath(slug)}/cloudflare/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /** Admins: Stripe Checkout for the organization's subscription. */
  orgBillingCheckout: (slug: string) =>
    request<{ url: string }>(`${orgPath(slug)}/billing/checkout`, { method: 'POST' }),
  orgBillingPortal: (slug: string) => request<{ url: string }>(`${orgPath(slug)}/billing/portal`, { method: 'POST' }),
  /**
   * Admins: deletes the organization's projects (with deleteSites, their sites too), its subscription, Cloudflare
   * connections and agent settings, and uninstalls the GitHub App from the GitHub organization.
   */
  deleteOrg: (slug: string, input: { deleteSites: boolean }) =>
    request<{ warnings: string[] }>(orgPath(slug), {
      method: 'DELETE',
      body: { confirm: slug, deleteSites: input.deleteSites },
    }),

  /** The domains whose DNS bohr hosts that the user can see (404 outside bohr.io Cloud). */
  dnsZones: () => request<{ zones: DnsZoneSummary[] }>('/api/dns/zones'),
  dnsZone: (zone: string) => request<DnsZoneDetail>(`${zonePath(zone)}/records`),
  /** 400 with what is wrong (or what Cloudflare refused); 409 when the name is one bohr serves. */
  createDnsRecord: (zone: string, input: DnsRecordInput) =>
    request<DnsZoneDetail>(`${zonePath(zone)}/records`, { method: 'POST', body: input }),
  updateDnsRecord: (zone: string, recordId: string, input: DnsRecordInput) =>
    request<DnsZoneDetail>(`${zonePath(zone)}/records/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: input,
    }),
  deleteDnsRecord: (zone: string, recordId: string) =>
    request<DnsZoneDetail>(`${zonePath(zone)}/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' }),
};

/** The zone file (BIND) of a domain whose DNS bohr hosts: a plain link, the browser downloads it. */
export const dnsExportUrl = (zone: string) => `${zonePath(zone)}/export`;

// The project runtime API (@bohr/shared runtime-api), proxied by the instance

export interface MessagesPage {
  messages: ChatEntry[];
  /** Highest seq in the conversation. */
  last: number;
}

/** A message the agent accepted, with the reply to show. */
export interface Submitted {
  requestId: string;
  message: string;
}

export interface Invite {
  code: string;
  expiresAt: string;
}

export type ProjectSettings = ProjectState['settings'];

export interface SettingsPatch {
  model?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  locale?: Locale;
}

/** Why the preview is or is not up (GET …/agent/preview). */
export interface PreviewDiagnostics {
  state: string;
  status: string | null;
  port: number | null;
  reason: string | null;
  containerRunning: boolean;
  runner: { status: string; port: number | null; reason: string | null; log: string } | null;
}

export function agentApi(projectId: string) {
  const base = `${projectPath(projectId)}/agent`;
  return {
    state: (signal?: AbortSignal) => request<ProjectState>(`${base}/state`, { signal }),
    messages: (after: number, limit: number, signal?: AbortSignal) =>
      request<MessagesPage>(`${base}/messages`, { query: { after, limit }, signal }),
    send: (text: string) => request<Submitted>(`${base}/messages`, { method: 'POST', body: { text } }),
    /** `version` is the preview version the member reviewed. */
    decide: (action: 'approve' | 'discard', version: number) =>
      request<{ message: string }>(`${base}/decisions`, { method: 'POST', body: { action, version } }),
    answer: (requestId: string, option: number) =>
      request<Submitted>(`${base}/answers`, { method: 'POST', body: { requestId, option } }),
    cancel: (requestId: string) =>
      request<{ message: string }>(`${base}/requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' }),
    rollback: () => request<{ message: string }>(`${base}/rollback`, { method: 'POST' }),
    createInvite: () => request<Invite>(`${base}/invites`, { method: 'POST' }),
    join: (code: string) => request<{ joined: boolean }>(`${base}/join`, { method: 'POST', body: { code } }),
    members: () => request<{ members: MemberView[] }>(`${base}/members`),
    revoke: (key: string) =>
      request<{ revoked: boolean }>(`${base}/members/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    updateSettings: (patch: SettingsPatch) =>
      request<ProjectSettings>(`${base}/settings`, { method: 'PATCH', body: patch }),
    startImport: () => request<Submitted>(`${base}/import`, { method: 'POST' }),
    preview: () => request<PreviewDiagnostics>(`${base}/preview`),
  };
}

export type AgentApi = ReturnType<typeof agentApi>;
