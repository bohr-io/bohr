// The demo instance: a Vite dev-server plugin that answers every instance route the panel calls
// (/api, /auth, /setup, /.well-known, /health) from the in-memory data in data.ts, so the panel runs with
// no GitHub App, Cloudflare account or instance behind it. Only `vite --mode demo` loads this file; it is
// never part of the production build.
// The template catalog is imported relatively, not from '@bohr/shared': vite bundles the config's own imports
// but leaves workspace packages to Node, which cannot load the package's TypeScript sources.

import type { Plugin } from 'vite';
import { findTemplate, PROJECT_TEMPLATES } from '../../../packages/shared/src/templates.ts';
import type {
  AgentEffort,
  AgentProvider,
  AgentSettings,
  CloudflareAccount,
  CloudflareResult,
  Connections,
  Domains,
  ManagedOrg,
  ManagedUser,
  ManagedUserDetail,
  ManageOverview,
  Me,
  MoveView,
  Onboarding,
  OnboardingStep,
  OrgDetail,
  OrgMember,
  OrgRef,
  OrgSummary,
  ProjectRow,
  ProjectSummary,
  Protection,
  Runtime,
  RuntimeStatus,
  SettingsPatch,
  Telemetry,
} from '../src/api.ts';
import { INSTANCE_PATHS } from '../src/build-config.ts';
import { RuntimeError } from './agent.ts';
import { buildJobs, buildView } from './builds.ts';
import {
  ANA,
  ANA_ID,
  createWorld,
  DEMO_EMAIL_CODE,
  type DemoAgentSettings,
  type DemoOrg,
  type DemoOrgMember,
  type DemoProject,
  type DemoUser,
  type DemoWorld,
  demoSite,
  freshAgent,
  INSTANCE,
  PORTFOLIO_HOSTNAMES,
  REPOSITORIES,
} from './data.ts';
import { previewPage, screenshotSvg, setupPage, stripePage } from './pages.ts';

interface DemoRequest {
  method: string;
  url: URL;
  body: unknown;
  /** The panel page that made the call (the Referer), for ?step= on /start. */
  referer: URL | null;
}

interface DemoReply {
  status: number;
  json?: unknown;
  html?: string;
  /** An image (the stand-in screenshots). */
  svg?: string;
  location?: string;
}

/** An instance error: `{ error: "Sentence." }`. */
class InstanceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields of the error body, like the instance's { code }. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** What the instance says after removing a Cloudflare connection (services/accounts.ts). */
const CLOUDFLARE_TOKEN_HINT =
  'bohr no longer has this token. Delete the token itself in the Cloudflare dashboard (My Profile → API Tokens).';
const STEPS: readonly OnboardingStep[] = ['subscription', 'cloudflare', 'cloudflare_account', 'github', 'done'];
const EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const PROVIDERS: readonly AgentProvider[] = ['anthropic', 'compatible', 'subscription'];
const CLAUDE_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/;

const PENDING_ACCOUNTS: CloudflareAccount[] = [
  { id: '7c3f0a9e5b2d4c18a6e9f1b03d7c2e54', name: 'Ana Souza' },
  { id: 'b2e81d0c4a6f49e3b7d5c9a1f0e2d3c4', name: 'Aurora Comércio' },
];

const ok = (json: unknown, status = 200): DemoReply => ({ status, json });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Wrong codes before a code is dropped (410). */
const CODE_ATTEMPTS = 5;
/** Codes per address before 429. */
const CODE_SENDS = 5;
const PAGE_SIZE = 50;
/** The runtime version "Update runtimes" brings every runtime to. */
const RUNTIME_VERSION = '0.9.3';
const SIGN_IN: readonly string[] = ['github', 'email'];

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** A local path to go back to, like the instance's own check. */
function localPath(value: string | null, fallback: string): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : fallback;
}

export class DemoInstance {
  private world: DemoWorld = createWorld();
  /** The Claude subscription sign-in in progress (claude setup-token in the instance's sign-in container). */
  private claudeLogin: { loginId: string } | null = null;
  /** Admin passwords of projects created from a template, until the result screen shows them (once). */
  private templatePasswords = new Map<string, { password: string; url: string }>();
  /** The first "Connect GitHub sign-in" fails (to show the error coming back); the next one links. */
  private githubLinks = 0;

  reset() {
    for (const project of this.world.projects) project.agent?.stop();
    this.world = createWorld();
    this.githubLinks = 0;
    this.claudeLogin = null;
    this.templatePasswords.clear();
  }

  handle(request: DemoRequest): DemoReply {
    try {
      return this.route(request);
    } catch (error) {
      if (error instanceof RuntimeError) return ok({ error: error.code, message: error.message }, error.status);
      if (error instanceof InstanceError) return ok({ ...error.details, error: error.message }, error.status);
      throw error;
    }
  }

  private route(request: DemoRequest): DemoReply {
    const { method, url } = request;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const world = this.world;

    // Pages of the demo itself
    if (path === '/__demo/reset') {
      this.reset();
      return { status: 302, location: '/projects' };
    }
    if (path === '/__demo/preview')
      return { status: 200, html: previewPage(this.project(url.searchParams.get('project') ?? 'p1')) };
    if (path === '/__demo/stripe') return this.stripe(url);
    if (path === '/__demo/github-org') return this.installOrg();
    if (path === '/setup' || path.startsWith('/setup/')) return { status: 200, html: setupPage() };
    if (path === '/health') return ok({ ok: true });

    // Signing in and out
    if (method === 'GET' && path === '/auth/methods') return ok({ github: true, email: true });
    if (method === 'GET' && path === '/auth/github') {
      if (url.searchParams.get('link') === '1') return this.linkGithub(url);
      world.signedIn = true;
      return { status: 302, location: localPath(url.searchParams.get('redirect'), '/projects') };
    }
    if (method === 'POST' && path === '/auth/email/start') return this.emailStart(request, 'login');
    if (method === 'POST' && path === '/auth/email/verify') return this.emailVerify(request, 'login');
    if (method === 'POST' && path === '/auth/logout') {
      world.signedIn = false;
      return { status: 204 };
    }

    if (method === 'GET' && path === '/api/instance') return ok(INSTANCE);
    if (!path.startsWith('/api/')) throw new InstanceError(404, 'Not found.');
    if (!world.signedIn) throw new InstanceError(401, 'Not signed in.');

    // The user, billing and the onboarding
    if (method === 'GET' && path === '/api/me') return ok(this.me());
    if (method === 'DELETE' && path === '/api/me') return this.deleteAccount(request);
    if (method === 'POST' && path === '/api/me/telegram-link') {
      // The demo links right away, so "I already linked it" finds the account.
      const ana = this.ana();
      if (!ana.identities.some((entry) => entry.provider === 'telegram')) {
        ana.identities.push({ provider: 'telegram', username: 'ana_souza' });
      }
      return ok({ url: 'https://t.me/bohr_demo_bot?start=demo' });
    }
    if (path.startsWith('/api/me/agent/subscription/')) return this.personalSubscription(request, path);
    if (path.startsWith('/api/me/') && path !== '/api/me/agent') {
      const reply = this.connectionsRoute(request, path);
      if (reply !== null) return reply;
    }
    if (path.startsWith('/api/manage/')) return this.manageRoute(request, path);
    if (method === 'GET' && path === '/api/billing') return ok(world.billing);
    if (method === 'POST' && path === '/api/billing/checkout') return ok({ url: '/__demo/stripe' });
    if (method === 'POST' && path === '/api/billing/portal') return ok({ url: '/__demo/stripe?portal=1' });
    if (path === '/api/me/agent') return this.agentSettingsRoute(request);
    if (path.startsWith('/api/onboarding')) return this.onboardingRoute(request, path);
    if (path === '/api/orgs' || path.startsWith('/api/orgs/')) return this.orgRoute(request, path);
    if (method === 'GET' && path === '/api/repositories') {
      const slug = url.searchParams.get('org');
      return ok({ repositories: slug ? this.orgRepositories(this.memberOrg(slug).org) : this.repositories() });
    }

    if (method === 'GET' && path === '/api/projects') {
      const slug = url.searchParams.get('org');
      if (slug) this.memberOrg(slug);
      return ok({
        projects: world.projects
          .filter((project) => (slug ? project.orgSlug === slug : this.personal(project)))
          .map((project) => this.summary(project, url.origin)),
      });
    }
    if (method === 'POST' && path === '/api/projects') return this.createProject(request);
    if (method === 'GET' && path === '/api/templates') return ok({ templates: PROJECT_TEMPLATES });
    if (method === 'POST' && path === '/api/templates/projects') return this.createFromTemplate(request);
    if (method === 'POST' && path === '/api/templates/password') {
      const projectId = String(record(request.body).projectId ?? '');
      const found = this.templatePasswords.get(projectId);
      if (found === undefined) throw new InstanceError(404, 'The password was already shown.');
      this.templatePasswords.delete(projectId);
      return ok(found);
    }
    const match = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (match?.[1] !== undefined) return this.projectRoute(request, this.project(match[1]), match[2] ?? '');
    throw new InstanceError(404, 'Not found.');
  }

  private ana(): DemoUser {
    const ana = this.world.users.find((user) => user.id === ANA_ID);
    if (ana === undefined) throw new InstanceError(401, 'Not signed in.');
    return ana;
  }

  private me(): Me {
    const ana = this.ana();
    return {
      user: { id: ana.id, name: ana.name, email: ana.email, role: ana.role },
      identities: ana.identities.map(({ provider, username }) => ({ provider, username })),
      role: ana.role,
    };
  }

  /** "Connect GitHub sign-in": back to the account page, with ?error= the first time. */
  private linkGithub(url: URL): DemoReply {
    const back = localPath(url.searchParams.get('redirect'), '/account');
    this.githubLinks += 1;
    if (this.githubLinks === 1) {
      const error = 'This GitHub account is already linked to another bohr account. (Demo: try again to link it.)';
      return { status: 302, location: `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` };
    }
    const ana = this.ana();
    if (!ana.identities.some((entry) => entry.provider === 'github')) {
      ana.identities.push({ provider: 'github', username: 'anasouza' });
    }
    return { status: 302, location: back };
  }

  /** A code by email, to sign in or to add the address to Ana's account. The demo's code is always 123456. */
  private emailStart(request: DemoRequest, purpose: 'login' | 'link'): DemoReply {
    const body = record(request.body);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email)) throw new InstanceError(400, 'Enter a valid email address.');
    const key = `${purpose}:${email}`;
    const entry = this.world.emailCodes[key] ?? { attempts: 0, redirect: '/projects', sends: 0 };
    if (entry.sends >= CODE_SENDS) throw new InstanceError(429, 'Too many codes requested. Wait a few minutes.');
    entry.sends += 1;
    entry.attempts = 0;
    entry.redirect = localPath(typeof body.redirect === 'string' ? body.redirect : null, '/projects');
    this.world.emailCodes[key] = entry;
    return ok({ sent: true });
  }

  private emailVerify(request: DemoRequest, purpose: 'login' | 'link'): DemoReply {
    const body = record(request.body);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const key = `${purpose}:${email}`;
    const entry = this.world.emailCodes[key];
    if (entry === undefined || entry.attempts >= CODE_ATTEMPTS) {
      throw new InstanceError(410, 'The code expired or had too many attempts. Ask for a new one.');
    }
    if (String(body.code ?? '') !== DEMO_EMAIL_CODE) {
      entry.attempts += 1;
      const attemptsLeft = CODE_ATTEMPTS - entry.attempts;
      if (attemptsLeft <= 0) {
        delete this.world.emailCodes[key];
        throw new InstanceError(410, 'Too many wrong codes. Ask for a new one.');
      }
      return ok({ error: 'Wrong code.', attemptsLeft }, 400);
    }
    delete this.world.emailCodes[key];
    if (purpose === 'login') {
      this.world.signedIn = true;
      return ok({ redirect: entry.redirect });
    }
    const ana = this.ana();
    const taken = this.world.users.some(
      (user) =>
        user.id !== ANA_ID && (user.email === email || user.identities.some((identity) => identity.username === email)),
    );
    if (taken) throw new InstanceError(409, 'This email address belongs to another bohr account.');
    ana.identities = ana.identities.filter((identity) => identity.provider !== 'email');
    ana.identities.push({ provider: 'email', username: email });
    ana.email ??= email;
    return ok({ identity: { provider: 'email', username: email } });
  }

  /** Ana's projects that use a GitHub account's installation or a Cloudflare account. */
  private projectsUsing(kind: 'github' | 'cloudflare', id: string | number): DemoProject[] {
    const own = this.world.projects.filter((project) => this.personal(project));
    if (kind === 'github') {
      const account = this.world.installations.find((entry) => entry.id === id)?.account;
      return own.filter((project) => project.summary.repository.startsWith(`${account}/`));
    }
    // The demo's sites in Ana's own account all use her first Cloudflare connection.
    return id === this.world.connections[0]?.id ? own.filter((project) => project.summary.mode === 'byo') : [];
  }

  private connections(): Connections {
    const world = this.world;
    const ana = this.ana();
    const signIns = ana.identities.filter((entry) => SIGN_IN.includes(entry.provider)).length;
    const telegram = ana.identities.find((entry) => entry.provider === 'telegram');
    return {
      identities: ana.identities.map(({ provider, username }) => ({
        provider,
        username,
        canRemove: provider === 'telegram' || signIns > 1,
      })),
      githubInstallations: world.installations.map((entry) => ({
        ...entry,
        projects: this.projectsUsing('github', entry.id).length,
      })),
      cloudflare: world.connections.map((entry) => ({
        ...entry,
        projects: this.projectsUsing('cloudflare', entry.id).length,
      })),
      telegram: telegram === undefined ? null : { username: telegram.username },
      agent: this.agentView(),
      subscription: world.billing.subscription === null ? null : { status: world.billing.subscription.status },
    };
  }

  /** /api/me/…: the connected accounts. Null for routes handled elsewhere. */
  private connectionsRoute(request: DemoRequest, path: string): DemoReply | null {
    const { method } = request;
    const world = this.world;
    const ana = this.ana();
    if (method === 'GET' && path === '/api/me/connections') return ok(this.connections());
    if (method === 'POST' && path === '/api/me/email/start') return this.emailStart(request, 'link');
    if (method === 'POST' && path === '/api/me/email/verify') return this.emailVerify(request, 'link');

    const identity = path.match(/^\/api\/me\/identities\/([^/]+)$/);
    if (method === 'DELETE' && identity?.[1] !== undefined) {
      const provider = decodeURIComponent(identity[1]);
      if (!ana.identities.some((entry) => entry.provider === provider)) {
        throw new InstanceError(404, 'That account is not linked.');
      }
      const signIns = ana.identities.filter((entry) => SIGN_IN.includes(entry.provider)).length;
      if (SIGN_IN.includes(provider) && signIns <= 1) {
        throw new InstanceError(409, 'This is the only way to sign in to your account. Add another one first.');
      }
      ana.identities = ana.identities.filter((entry) => entry.provider !== provider);
      return ok(this.connections());
    }

    const installation = path.match(/^\/api\/me\/github-installations\/([^/]+)$/);
    if (method === 'DELETE' && installation?.[1] !== undefined) {
      const id = Number(decodeURIComponent(installation[1]));
      const found = world.installations.find((entry) => entry.id === id);
      if (found === undefined) throw new InstanceError(404, 'Installation not found.');
      const using = this.projectsUsing('github', id).map((project) => project.summary.name);
      if (using.length > 0) {
        throw new InstanceError(409, `These projects use this installation: ${using.join(', ')}.`, { projects: using });
      }
      world.installations = world.installations.filter((entry) => entry.id !== id);
      return ok(this.connections());
    }

    const cloudflare = path.match(/^\/api\/me\/cloudflare\/([^/]+)$/);
    if (method === 'DELETE' && cloudflare?.[1] !== undefined) {
      const id = decodeURIComponent(cloudflare[1]);
      const found = world.connections.find((entry) => entry.id === id);
      if (found === undefined) throw new InstanceError(404, 'Cloudflare connection not found.');
      const using = this.projectsUsing('cloudflare', id).map((project) => project.summary.name);
      if (using.length > 0) {
        throw new InstanceError(409, `These projects run in this account: ${using.join(', ')}.`, { projects: using });
      }
      world.connections = world.connections.filter((entry) => entry.id !== id);
      return ok({ ...this.connections(), hint: CLOUDFLARE_TOKEN_HINT });
    }
    return null;
  }

  /** The danger zone: Ana's account goes, and the demo starts over signed out. */
  private deleteAccount(request: DemoRequest): DemoReply {
    const body = record(request.body);
    if (body.confirm !== true) throw new InstanceError(400, 'Confirm the deletion.');
    const warnings =
      body.deleteSites === true
        ? ['site Worker of Blog da Aurora: This Worker does not exist (the site was never deployed).']
        : [];
    this.reset();
    this.world.signedIn = false;
    return ok({ warnings });
  }

  private managedUser(user: DemoUser): ManagedUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      identities: user.identities.map(({ provider, username }) => ({ provider, username })),
      projects: this.world.projects.filter((project) => project.ownerId === user.id).length,
      subscription: user.id === ANA_ID ? (this.world.billing.subscription?.status ?? null) : user.subscription,
      orgs: this.orgsOf(user.id).map(({ org }) => ({ slug: org.slug, name: org.name })),
    };
  }

  private row(project: DemoProject, origin: string): ProjectRow {
    const owner = this.world.users.find((user) => user.id === project.ownerId);
    const runtime = this.runtime(project, origin);
    return {
      id: project.summary.id,
      name: project.summary.name,
      repository: project.summary.repository,
      owner: { id: project.ownerId, name: owner?.name ?? null, email: owner?.email ?? null },
      mode: project.summary.mode,
      status: project.summary.status,
      createdAt: project.createdAt,
      productionUrl: project.summary.productionUrl,
      runtime: runtime === null ? null : { status: runtime.status, version: runtime.version, error: runtime.error },
      org: this.orgRef(project),
    };
  }

  private telemetry(): Telemetry {
    const instanceId = 'inst_4f9c2a7e1b3d';
    return {
      available: true,
      enabled: this.world.telemetry.enabled,
      forcedOff: false,
      instanceId,
      lastSentAt: this.world.telemetry.lastSentAt,
      endpoint: 'https://telemetry.bohr.io/v1/ping',
      payload: { instanceId, version: '2.0.0', projects: this.world.projects.length },
    };
  }

  /** A page of a list, 50 at a time, like the instance. */
  private page<T>(items: T[], url: URL): { items: T[]; total: number } {
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: items.length };
  }

  /** The admin area (/api/manage): Ana is an admin of the demo instance. */
  private manageRoute(request: DemoRequest, path: string): DemoReply {
    const { method, url } = request;
    const world = this.world;
    const body = record(request.body);
    if (this.ana().role !== 'admin') throw new InstanceError(403, 'Only instance admins can do this.');
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
    const matches = (...values: (string | null | undefined)[]) =>
      query === '' || values.some((value) => value?.toLowerCase().includes(query));

    if (method === 'GET' && path === '/api/manage/overview') {
      const runtimes: Record<RuntimeStatus, number> = { ready: 0, provisioning: 0, pending: 0, error: 0 };
      for (const project of world.projects) {
        const runtime = this.runtime(project, url.origin);
        if (runtime !== null) runtimes[runtime.status] += 1;
      }
      const active = world.users
        .map((user) => this.managedUser(user).subscription)
        .filter((status) => status === 'active' || status === 'trialing' || status === 'past_due').length;
      return ok({
        users: world.users.length,
        projects: world.projects.length,
        subscriptions: { active },
        runtimes,
      } satisfies ManageOverview);
    }
    if (method === 'POST' && path === '/api/manage/runtimes/update') {
      const updating: string[] = [];
      for (const project of world.projects) {
        const runtime = project.runtime;
        if (runtime?.status !== 'ready' || runtime.version === RUNTIME_VERSION) continue;
        runtime.version = RUNTIME_VERSION;
        updating.push(project.summary.id);
      }
      return ok({ version: RUNTIME_VERSION, updating });
    }

    if (method === 'GET' && path === '/api/manage/users') {
      const users = world.users
        .filter((user) =>
          matches(user.name, user.email, user.id, ...user.identities.map((identity) => identity.username)),
        )
        .map((user) => this.managedUser(user));
      const { items, total } = this.page(users, url);
      return ok({ users: items, total });
    }
    const userMatch = path.match(/^\/api\/manage\/users\/([^/]+)(\/role)?$/);
    if (userMatch?.[1] !== undefined) {
      const id = decodeURIComponent(userMatch[1]);
      const user = world.users.find((candidate) => candidate.id === id);
      if (user === undefined) throw new InstanceError(404, 'User not found.');
      if (userMatch[2] === '/role' && method === 'PUT') {
        const role = body.role === 'admin' ? 'admin' : body.role === 'user' ? 'user' : null;
        if (role === null) throw new InstanceError(400, 'Invalid role.');
        const admins = world.users.filter((candidate) => candidate.role === 'admin').length;
        if (role === 'user' && user.role === 'admin' && admins <= 1) {
          throw new InstanceError(409, 'The instance needs at least one admin.');
        }
        user.role = role;
        return ok({ user: this.managedUser(user) });
      }
      if (userMatch[2] === undefined && method === 'GET') return ok(this.userDetail(user, url.origin));
      if (userMatch[2] === undefined && method === 'DELETE') {
        if (user.id === ANA_ID) throw new InstanceError(400, 'Delete your own account from the account page.');
        const theirs = world.projects.filter((project) => project.ownerId === user.id);
        for (const project of theirs) project.agent?.stop();
        world.projects = world.projects.filter((project) => project.ownerId !== user.id);
        world.users = world.users.filter((candidate) => candidate.id !== user.id);
        const warnings =
          body.deleteSites === true && theirs.some((project) => project.site.worker === null)
            ? ['site Worker of Cardápio Café Lume: This Worker does not exist (the site was never deployed).']
            : [];
        return ok({ warnings });
      }
    }

    if (method === 'GET' && path === '/api/manage/orgs') {
      const rows = world.orgs
        .filter((org) => matches(org.name, org.slug))
        .map(
          (org): ManagedOrg => ({
            id: org.id,
            slug: org.slug,
            name: org.name,
            members: org.members.filter((member) => member.status !== 'removed').length,
            projects: world.projects.filter((project) => project.orgSlug === org.slug).length,
            subscription: org.subscription,
          }),
        );
      const { items, total } = this.page(rows, url);
      return ok({ orgs: items, total });
    }
    if (method === 'GET' && path === '/api/manage/projects') {
      const rows = world.projects
        .map((project) => this.row(project, url.origin))
        .filter((row) => matches(row.name, row.repository, row.owner.name, row.owner.email));
      const { items, total } = this.page(rows, url);
      return ok({ projects: items, total });
    }

    if (path === '/api/manage/telemetry') {
      if (method === 'PUT') {
        world.telemetry.enabled = body.enabled === true;
        return ok(this.telemetry());
      }
      if (method === 'GET') return ok(this.telemetry());
    }
    throw new InstanceError(404, 'Not found.');
  }

  private userDetail(user: DemoUser, origin: string): ManagedUserDetail {
    const projects = this.world.projects.filter((project) => project.ownerId === user.id);
    const telegram = user.identities.find((identity) => identity.provider === 'telegram');
    const github = user.identities.find((identity) => identity.provider === 'github');
    const own = user.id === ANA_ID;
    return {
      user: this.managedUser(user),
      projects: projects.map((project) => this.row(project, origin)),
      orgs: this.orgsOf(user.id).map(({ org, member }) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        role: member.role,
      })),
      connections: {
        githubInstallations: own
          ? this.world.installations
          : github !== undefined && projects.length > 0
            ? [{ id: 42000 + this.world.users.indexOf(user), account: github.username }]
            : [],
        cloudflare: own
          ? this.world.connections
          : projects.length > 0
            ? [{ id: `cf_${user.id}`, accountId: '0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6', accountName: user.name }]
            : [],
        telegram: telegram === undefined ? null : { username: telegram.username },
        agent: { configured: own ? this.world.agent !== null : projects.length > 0 },
      },
    };
  }

  private onboardingRoute(request: DemoRequest, path: string): DemoReply {
    const { method } = request;
    const world = this.world;
    const body = record(request.body);
    const onboarding = world.onboarding;

    if (method === 'GET' && path === '/api/onboarding') return ok(this.onboarding(request));
    if (method === 'GET' && path === '/api/onboarding/repositories') return ok({ repositories: this.repositories() });
    if (method === 'POST' && path === '/api/onboarding/subscription') {
      if (onboarding.step === 'subscription') onboarding.step = 'cloudflare';
      return ok({ status: 'ready' });
    }
    if (method === 'POST' && path === '/api/onboarding/cloudflare') {
      if (typeof body.token !== 'string' || body.token.trim().length < 40) {
        throw new InstanceError(400, 'That does not look like a Cloudflare API token.');
      }
      if (onboarding.step !== 'cloudflare_account') onboarding.resumeStep = onboarding.step;
      onboarding.step = 'cloudflare_account';
      return ok({ status: 'choose_account', accounts: PENDING_ACCOUNTS } satisfies CloudflareResult);
    }
    if (method === 'POST' && path === '/api/onboarding/cloudflare/account') {
      const account = PENDING_ACCOUNTS.find((candidate) => candidate.id === body.accountId);
      if (account === undefined || onboarding.step !== 'cloudflare_account') {
        throw new InstanceError(400, 'Paste the Cloudflare token again.');
      }
      let connection = world.connections.find((candidate) => candidate.accountId === account.id);
      if (connection === undefined) {
        connection = { id: `cf_${world.connections.length + 1}`, accountId: account.id, accountName: account.name };
        world.connections.push(connection);
      }
      onboarding.step = onboarding.resumeStep === 'done' ? 'done' : 'github';
      return ok({
        status: 'connected',
        connectionId: connection.id,
        accountName: connection.accountName,
      } satisfies CloudflareResult);
    }
    if (method === 'POST' && path === '/api/onboarding/projects') return this.createProject(request);
    throw new InstanceError(404, 'Not found.');
  }

  private onboarding(request: DemoRequest): Onboarding {
    const world = this.world;
    let { step } = world.onboarding;
    // /start?step=<step> previews any step of the wizard.
    const forced = request.referer?.pathname === '/start' ? request.referer.searchParams.get('step') : null;
    const preview = STEPS.find((candidate) => candidate === forced);
    if (preview !== undefined) step = preview;
    const subscribed = step !== 'subscription' && world.billing.subscription?.status === 'active';
    return {
      step,
      cloudflare: {
        connections: world.connections,
        tokenTemplateUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      },
      github: { installUrl: step === 'github' ? 'https://github.com/apps/bohr-demo/installations/new' : null },
      pendingAccounts: step === 'cloudflare_account' ? PENDING_ACCOUNTS : [],
      telegram: { username: 'bohr_demo_bot', canManageBots: true },
      billing: { enabled: true, subscribed },
      agent: { configured: world.agent !== null },
    };
  }

  /** Repositories the GitHub App reaches that are not projects yet. */
  private repositories() {
    return REPOSITORIES.filter(
      (repository) => !this.world.projects.some((project) => project.summary.repository === repository.fullName),
    );
  }

  /**
   * A new project from a template. The instance sends the browser through GitHub's authorization first; the demo
   * creates the repository and the project right away and answers the page GitHub's return would lead to. A name
   * with "no-d1" in it shows the error of a Cloudflare token without D1: Edit.
   */
  private createFromTemplate(request: DemoRequest): DemoReply {
    const world = this.world;
    const body = record(request.body);
    const template = findTemplate(String(body.template ?? ''));
    if (template === undefined) throw new InstanceError(404, 'Template not found.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new InstanceError(400, 'Invalid request.');
    const org = typeof body.org === 'string' && body.org !== '' ? this.memberOrg(body.org).org : null;
    if (org !== null && org.connections.length === 0) {
      throw new InstanceError(400, 'Connect a Cloudflare account to the organization first.');
    }
    if (name.includes('no-d1')) {
      throw new InstanceError(
        403,
        'The Cloudflare token cannot create D1 databases. Edit the token in the Cloudflare dashboard (My Profile › API Tokens), add the "D1: Edit" permission and try again.',
        { code: 'd1_permission' },
      );
    }
    const repository = `${org?.githubLogin ?? 'anasouza'}/${name}`;
    if (world.projects.some((project) => project.summary.repository.toLowerCase() === repository.toLowerCase())) {
      throw new InstanceError(409, `${repository} is already a bohr project.`);
    }
    const id = `p${world.nextProject++}`;
    const script =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'project';
    world.projects.push({
      ownerId: ANA_ID,
      ...(org !== null ? { orgSlug: org.slug } : {}),
      createdAt: new Date().toISOString(),
      summary: {
        id,
        name,
        repository,
        status: 'active',
        mode: 'byo',
        role: org !== null && this.memberOrg(org.slug).member.role !== 'admin' ? 'member' : 'owner',
        productionUrl: null,
      },
      runtime: { status: 'provisioning', error: null, botUsername: null, version: null, readyAt: Date.now() + 12_000 },
      agent: null,
      move: null,
      site: demoSite({
        worker: script,
        variables: [
          { key: 'ADMIN_PASSWORD', target: 'runtime', secret: true, value: null, updatedAt: new Date().toISOString() },
        ],
      }),
      builds: [],
    });
    const password = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
      'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(byte % 57),
    ).join('');
    this.templatePasswords.set(id, { password, url: `https://${script}.ana-souza.workers.dev` });
    const query = new URLSearchParams({
      ...(org !== null ? { org: org.slug } : {}),
      project: id,
      template: template.slug,
    });
    return ok({ url: `/projects/new?${query}` });
  }

  private createProject(request: DemoRequest): DemoReply {
    const world = this.world;
    const body = record(request.body);
    // A project of an organization: its member, with its subscription and Cloudflare account.
    const org = typeof body.org === 'string' && body.org !== '' ? this.memberOrg(body.org).org : null;
    if (org !== null) {
      if (org.connections.length === 0) {
        throw new InstanceError(400, 'Connect a Cloudflare account to the organization first.');
      }
      if (org.subscription !== 'active') {
        throw new InstanceError(402, 'bohr.io Cloud needs an active subscription for this organization.');
      }
    }
    const repository = (org?.repositories ?? REPOSITORIES).find((candidate) => candidate.fullName === body.repository);
    if (repository === undefined) throw new InstanceError(404, 'The GitHub App cannot reach that repository.');
    if (world.projects.some((project) => project.summary.repository === repository.fullName)) {
      throw new InstanceError(409, 'This repository already has a project.');
    }
    const id = `p${world.nextProject++}`;
    const name =
      typeof body.name === 'string' && body.name.trim() ? body.name.trim() : (repository.fullName.split('/')[1] ?? id);
    world.projects.push({
      ownerId: ANA_ID,
      ...(org !== null ? { orgSlug: org.slug } : {}),
      createdAt: new Date().toISOString(),
      summary: {
        id,
        name,
        repository: repository.fullName,
        status: 'active',
        mode: 'byo',
        role: org !== null && this.memberOrg(org.slug).member.role !== 'admin' ? 'member' : 'owner',
        productionUrl: null,
      },
      runtime: {
        status: 'provisioning',
        error: null,
        botUsername: null,
        version: null,
        readyAt: Date.now() + 12_000,
      },
      agent: null,
      move: null,
      site: demoSite(),
      builds: [],
    });
    return ok({ projectId: id }, 201);
  }

  /** Agent settings as the API shows them (the key only by its last characters). */
  private agentView(agent: DemoAgentSettings | null = this.world.agent): AgentSettings {
    return {
      configured: agent !== null,
      provider: agent?.provider ?? null,
      baseUrl: agent?.baseUrl ?? null,
      model: agent?.model ?? null,
      effort: agent?.effort ?? null,
      keyHint: agent ? `…${agent.apiKey.slice(-4)}` : null,
    };
  }

  /** Checks a PUT of agent settings like the instance; a blank key keeps the current one for the same provider. */
  private agentInput(body: Record<string, unknown>, current: DemoAgentSettings | null): DemoAgentSettings {
    const provider = PROVIDERS.find((candidate) => candidate === body.provider) ?? null;
    if (provider === null) throw new InstanceError(400, 'Invalid request.');
    const typed = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const apiKey = typed || (current?.provider === provider ? current.apiKey : '');
    if (apiKey === '') throw new InstanceError(400, 'Enter the API key.');
    if (provider === 'anthropic' && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
      throw new InstanceError(400, 'That does not look like an Anthropic API key (sk-ant-…).');
    }
    if (provider === 'subscription' && !CLAUDE_TOKEN.test(apiKey)) {
      throw new InstanceError(400, 'That does not look like a token from claude setup-token (sk-ant-oat01-…).');
    }
    // The demo's provider refuses any key with "invalid" in it.
    if (apiKey.includes('invalid')) throw new InstanceError(400, 'The provider did not accept this key.');
    let baseUrl: string | null = null;
    if (provider === 'compatible') {
      const value = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
      if (!value.startsWith('https://')) throw new InstanceError(400, 'The base URL must use https.');
      baseUrl = value.replace(/\/+$/, '').replace(/\/v1$/, '');
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    if (provider === 'compatible' && model === null) {
      throw new InstanceError(400, 'Compatible providers need a model name.');
    }
    const effort = EFFORTS.find((level) => level === body.effort) ?? null;
    return { provider, apiKey, baseUrl, model, effort };
  }

  private agentSettingsRoute(request: DemoRequest): DemoReply {
    const world = this.world;
    if (request.method === 'GET') return ok({ agent: this.agentView() });
    if (request.method === 'DELETE') {
      world.agent = null;
      this.applyAgent();
      return ok({ agent: this.agentView() });
    }
    if (request.method !== 'PUT') throw new InstanceError(404, 'Not found.');
    world.agent = this.agentInput(record(request.body), world.agent);
    return ok({ agent: this.agentView(), projects: { applied: this.applyAgent(), failed: 0 } });
  }

  /**
   * Connecting a Claude subscription (Ana's, or an organization's). The real instance runs the official CLI's
   * `claude setup-token` in its dedicated sign-in container, so no project is needed (projectId null); the demo
   * hands out a fake claude.ai link and accepts any code.
   */
  private subscriptionRoute(
    request: DemoRequest,
    step: string,
    target: {
      /** Stores the token; returns how many projects got it. */
      save: (settings: DemoAgentSettings) => number;
      view: () => AgentSettings;
    },
  ): DemoReply {
    if (request.method !== 'POST') throw new InstanceError(404, 'Not found.');
    const body = record(request.body);
    if (step === 'start') {
      const loginId = `login_demo_${Date.now().toString(36)}`;
      this.claudeLogin = { loginId };
      return ok({
        projectId: null,
        loginId,
        url: `https://claude.ai/oauth/authorize?code=true&client_id=demo&response_type=code&state=${loginId}`,
      });
    }
    const login = this.claudeLogin;
    const matches = login !== null && body.loginId === login.loginId;
    if (step === 'cancel') {
      if (matches) this.claudeLogin = null;
      return ok({ cancelled: true });
    }
    if (step !== 'finish') throw new InstanceError(404, 'Not found.');
    if (!matches) throw new InstanceError(404, 'The sign-in expired; start again.', { code: 'login_expired' });
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (code === '' || /\s/.test(code)) throw new InstanceError(400, 'Invalid request.');
    this.claudeLogin = null;
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    const effort = EFFORTS.find((level) => level === body.effort) ?? null;
    const apiKey = `sk-ant-oat01-demo${Math.random().toString(36).slice(2).padEnd(24, 'x')}`;
    const applied = target.save({ provider: 'subscription', apiKey, baseUrl: null, model, effort });
    return ok({ agent: target.view(), projects: { applied, failed: 0 } });
  }

  /** Ana's own subscription sign-in (/api/me/agent/subscription/…). */
  private personalSubscription(request: DemoRequest, path: string): DemoReply {
    return this.subscriptionRoute(request, path.slice('/api/me/agent/subscription/'.length), {
      save: (settings) => {
        this.world.agent = settings;
        return this.applyAgent();
      },
      view: () => this.agentView(),
    });
  }

  /** Gives the settings to Ana's personal projects with a ready runtime; returns how many. */
  private applyAgent(): number {
    let applied = 0;
    for (const project of this.world.projects) {
      if (!this.personal(project) || project.agent === null) continue;
      project.agent.state.project.agentEnabled = this.world.agent !== null;
      applied++;
    }
    return applied;
  }

  /** Gives an organization's settings to its projects with a ready runtime; returns how many. */
  private applyOrgAgent(org: DemoOrg): number {
    let applied = 0;
    for (const project of this.world.projects) {
      if (project.orgSlug !== org.slug || project.agent === null) continue;
      project.agent.state.project.agentEnabled = org.agent !== null;
      applied++;
    }
    return applied;
  }

  /** The settings a project's agent runs with: its organization's, or its owner's. */
  private agentSettingsOf(project: DemoProject): DemoAgentSettings | null {
    if (project.orgSlug === undefined) return this.world.agent;
    return this.world.orgs.find((org) => org.slug === project.orgSlug)?.agent ?? null;
  }

  // Organizations

  /** Ana's personal projects (not those of an organization). */
  private personal(project: DemoProject): boolean {
    return project.ownerId === ANA_ID && project.orgSlug === undefined;
  }

  /** The organizations a user is an active member of. */
  private orgsOf(userId: string): { org: DemoOrg; member: DemoOrgMember }[] {
    return this.world.orgs.flatMap((org) => {
      const member = org.members.find((entry) => entry.userId === userId && entry.status === 'active');
      return member === undefined ? [] : [{ org, member }];
    });
  }

  /** The organization of a project, when Ana is one of its members. */
  private orgOf(project: DemoProject): { org: DemoOrg; member: DemoOrgMember } | null {
    return this.orgsOf(ANA_ID).find(({ org }) => org.slug === project.orgSlug) ?? null;
  }

  private orgRef(project: DemoProject): OrgRef | null {
    const org = this.world.orgs.find((candidate) => candidate.slug === project.orgSlug);
    return org === undefined ? null : { slug: org.slug, name: org.name };
  }

  /** An organization Ana is a member of; 404 otherwise, like the instance. */
  private memberOrg(slug: string): { org: DemoOrg; member: DemoOrgMember } {
    const found = this.orgsOf(ANA_ID).find(({ org }) => org.slug === slug.toLowerCase());
    if (found === undefined) throw new InstanceError(404, 'Organization not found.');
    return found;
  }

  private orgSummary(org: DemoOrg, member: DemoOrgMember): OrgSummary {
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      avatarUrl: org.avatarUrl,
      role: member.role,
      status: {
        subscription: org.subscription === 'active',
        cloudflare: org.connections.length > 0,
        agent: org.agent !== null,
        installation: org.installed,
      },
    };
  }

  private orgDetail(org: DemoOrg, member: DemoOrgMember): OrgDetail {
    return {
      org: { ...this.orgSummary(org, member), githubLogin: org.githubLogin, membersPermission: org.membersPermission },
      billing: { enabled: true, subscribed: org.subscription === 'active' },
    };
  }

  private orgMembers(org: DemoOrg): OrgMember[] {
    return org.members.flatMap((member) =>
      member.status === 'removed' ? [] : [{ ...member, status: member.status } as OrgMember],
    );
  }

  /** The organization's repositories that are not projects yet. */
  private orgRepositories(org: DemoOrg) {
    return org.repositories.filter(
      (repository) => !this.world.projects.some((project) => project.summary.repository === repository.fullName),
    );
  }

  /** /api/orgs and /api/orgs/:slug/… */
  private orgRoute(request: DemoRequest, path: string): DemoReply {
    const { method } = request;
    const body = record(request.body);
    const world = this.world;
    if (method === 'GET' && path === '/api/orgs') {
      return ok({ orgs: this.orgsOf(ANA_ID).map(({ org, member }) => this.orgSummary(org, member)) });
    }
    // GitHub's installation page, where the user picks an organization; the demo makes one up.
    if (method === 'GET' && path === '/api/orgs/install-url') return ok({ url: '/__demo/github-org' });

    const match = path.match(/^\/api\/orgs\/([^/]+)(\/.*)?$/);
    if (match?.[1] === undefined) throw new InstanceError(404, 'Not found.');
    const { org, member } = this.memberOrg(decodeURIComponent(match[1]));
    const rest = match[2] ?? '';
    const admin = () => {
      if (member.role !== 'admin') throw new InstanceError(403, 'Only organization admins can do this.');
    };
    const projects = () => world.projects.filter((project) => project.orgSlug === org.slug);
    const orgCloudflare = () => ({
      connections: org.connections.map((connection, index) => ({
        ...connection,
        projects: index === 0 ? projects().length : 0,
      })),
      tokenTemplateUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    });

    if (rest === '' && method === 'GET') return ok(this.orgDetail(org, member));
    if (rest === '' && method === 'DELETE') {
      admin();
      if (body.confirm !== org.slug) throw new InstanceError(400, 'Type the organization slug to confirm.');
      const theirs = projects();
      for (const project of theirs) project.agent?.stop();
      world.projects = world.projects.filter((project) => project.orgSlug !== org.slug);
      world.orgs = world.orgs.filter((candidate) => candidate !== org);
      const undeployed = theirs.find((project) => project.site.worker === null);
      const warnings =
        body.deleteSites === true && undeployed !== undefined
          ? [`site Worker of ${undeployed.summary.name}: This Worker does not exist (the site was never deployed).`]
          : [];
      return ok({ warnings });
    }

    // Members, mirrored from GitHub
    if (rest === '/members' && method === 'GET') return ok({ members: this.orgMembers(org) });
    if (rest === '/members/sync' && method === 'POST') {
      admin();
      let added = 0;
      if (org.membersPermission) {
        for (const incoming of org.nextSync) {
          if (org.members.some((entry) => entry.githubUserId === incoming.githubUserId)) continue;
          org.members.push({ ...incoming });
          added++;
        }
        org.nextSync = [];
      }
      return ok({
        members: this.orgMembers(org),
        added,
        removed: 0,
        updated: 0,
        membersPermission: org.membersPermission,
      });
    }
    const memberMatch = rest.match(/^\/members\/(\d+)$/);
    if (memberMatch?.[1] !== undefined) {
      admin();
      const target = org.members.find(
        (entry) => entry.githubUserId === Number(memberMatch[1]) && entry.status !== 'removed',
      );
      if (target === undefined) throw new InstanceError(404, 'Member not found.');
      const otherAdmins = org.members.filter(
        (entry) => entry !== target && entry.role === 'admin' && entry.status === 'active',
      ).length;
      if (method === 'PUT') {
        const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
        if (role === null) throw new InstanceError(400, 'Invalid role.');
        if (role === 'member' && target.role === 'admin' && otherAdmins === 0) {
          throw new InstanceError(409, 'The organization needs at least one admin.');
        }
        if (target.role !== role) {
          target.role = role;
          target.source = 'bohr';
        }
        return ok({ members: this.orgMembers(org) });
      }
      if (method === 'DELETE') {
        if (target.role === 'admin' && otherAdmins === 0) {
          throw new InstanceError(409, 'The organization needs at least one admin.');
        }
        target.status = 'removed';
        return ok({ members: this.orgMembers(org) });
      }
    }

    // The agent of every project of the organization
    if (rest === '/agent') {
      if (method === 'GET') return ok({ agent: this.agentView(org.agent) });
      admin();
      if (method === 'DELETE') {
        org.agent = null;
        this.applyOrgAgent(org);
        return ok({ agent: this.agentView(org.agent) });
      }
      if (method === 'PUT') {
        org.agent = this.agentInput(body, org.agent);
        return ok({ agent: this.agentView(org.agent), projects: { applied: this.applyOrgAgent(org), failed: 0 } });
      }
    }
    if (rest.startsWith('/agent/subscription/')) {
      admin();
      return this.subscriptionRoute(request, rest.slice('/agent/subscription/'.length), {
        save: (settings) => {
          org.agent = settings;
          return this.applyOrgAgent(org);
        },
        view: () => this.agentView(org.agent),
      });
    }

    // The organization's Cloudflare accounts
    if (rest === '/cloudflare' || rest.startsWith('/cloudflare/')) {
      admin();
      if (rest === '/cloudflare' && method === 'GET') return ok(orgCloudflare());
      if (rest === '/cloudflare' && method === 'POST') {
        if (typeof body.token !== 'string' || body.token.trim().length < 40) {
          throw new InstanceError(400, 'That does not look like a Cloudflare API token.');
        }
        org.choosingAccount = true;
        return ok({ status: 'choose_account', accounts: PENDING_ACCOUNTS } satisfies CloudflareResult);
      }
      if (rest === '/cloudflare/account' && method === 'POST') {
        const account = PENDING_ACCOUNTS.find((candidate) => candidate.id === body.accountId);
        if (account === undefined || !org.choosingAccount)
          throw new InstanceError(400, 'Paste the Cloudflare token again.');
        org.choosingAccount = false;
        let connection = org.connections.find((candidate) => candidate.accountId === account.id);
        if (connection === undefined) {
          connection = {
            id: `cf_${org.id}_${org.connections.length + 1}`,
            accountId: account.id,
            accountName: account.name,
          };
          org.connections.push(connection);
        }
        return ok({
          status: 'connected',
          connectionId: connection.id,
          accountName: connection.accountName,
        } satisfies CloudflareResult);
      }
      const remove = rest.match(/^\/cloudflare\/([^/]+)$/);
      if (remove?.[1] !== undefined && method === 'DELETE') {
        const id = decodeURIComponent(remove[1]);
        const index = org.connections.findIndex((candidate) => candidate.id === id);
        if (index === -1) throw new InstanceError(404, 'Cloudflare connection not found.');
        const using = (index === 0 ? projects() : []).map((project) => project.summary.name);
        if (using.length > 0) {
          throw new InstanceError(409, `These projects run in this account: ${using.join(', ')}.`, {
            projects: using,
          });
        }
        org.connections.splice(index, 1);
        return ok({ ...orgCloudflare(), hint: CLOUDFLARE_TOKEN_HINT });
      }
    }

    // Billing: Stripe's pages (the demo's stand-in)
    if (rest === '/billing/checkout' && method === 'POST') {
      admin();
      return ok({ url: `/__demo/stripe?org=${encodeURIComponent(org.slug)}` });
    }
    if (rest === '/billing/portal' && method === 'POST') {
      admin();
      return ok({ url: `/__demo/stripe?portal=1&org=${encodeURIComponent(org.slug)}` });
    }
    throw new InstanceError(404, 'Not found.');
  }

  /** The demo's Stripe page; paying for an organization activates its subscription. */
  private stripe(url: URL): DemoReply {
    const portal = url.searchParams.get('portal') === '1';
    const org = this.world.orgs.find((candidate) => candidate.slug === url.searchParams.get('org'));
    if (org === undefined) return { status: 200, html: stripePage(portal) };
    if (!portal) org.subscription = 'active';
    const base = `/orgs/${encodeURIComponent(org.slug)}`;
    return { status: 200, html: stripePage(portal, portal ? `${base}/configuracoes` : `${base}?billing=success`) };
  }

  /** "Install the GitHub app on an organization": GitHub would ask which one; the demo creates Laboratório Sol. */
  private installOrg(): DemoReply {
    const slug = 'laboratorio-sol';
    if (!this.world.orgs.some((org) => org.slug === slug)) {
      const ana = this.ana();
      this.world.orgs.push({
        id: 'o_sol',
        slug,
        name: 'Laboratório Sol',
        githubLogin: 'laboratorio-sol',
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        installed: true,
        membersPermission: true,
        subscription: null,
        connections: [],
        choosingAccount: false,
        agent: null,
        members: [
          {
            githubUserId: 5550101,
            githubLogin: 'anasouza',
            name: ana.name,
            email: ana.email,
            userId: ANA_ID,
            role: 'admin',
            status: 'active',
            source: 'github',
          },
        ],
        repositories: [{ id: 501, fullName: 'laboratorio-sol/site', defaultBranch: 'main', private: false }],
        nextSync: [],
      });
    }
    return { status: 302, location: `/orgs/${slug}` };
  }

  private project(id: string): DemoProject {
    const project = this.world.projects.find((candidate) => candidate.summary.id === id);
    if (project === undefined) throw new InstanceError(404, 'Project not found.');
    return project;
  }

  /** The runtime, ready once its time has come (with a fresh conversation). */
  private runtime(project: DemoProject, origin: string): Runtime | null {
    const runtime = project.runtime;
    if (runtime === null) return null;
    if (runtime.status === 'provisioning' && Date.now() >= runtime.readyAt) {
      runtime.status = 'ready';
      runtime.version = '0.9.2';
      const { id, name, repository, productionUrl } = project.summary;
      project.agent ??= freshAgent(id, name, repository, productionUrl);
      const settings = this.agentSettingsOf(project);
      project.agent.state.project.agentEnabled = settings !== null;
      // With the owner's (or the organization's) agent settings, the agent prepares the repository right away.
      if (settings !== null) project.agent.startImport();
    }
    const { readyAt: _readyAt, ...rest } = runtime;
    return {
      ...rest,
      previewUrl: runtime.status === 'ready' ? `${origin}/__demo/preview?project=${project.summary.id}` : null,
    };
  }

  private summary(project: DemoProject, origin: string): ProjectSummary {
    const runtime = this.runtime(project, origin);
    // The latest GitHub Actions run stands for the latest deploy (newest first)
    const latest = project.builds[0];
    const now = Date.now();
    return {
      ...project.summary,
      org: this.orgRef(project),
      updatedAt: latest === undefined ? project.createdAt : new Date(Math.min(latest.completesAt, now)).toISOString(),
      lastDeploy:
        latest === undefined
          ? null
          : {
              status: latest.completesAt > now ? 'building' : latest.outcome === 'success' ? 'success' : 'error',
              branch: latest.build.branch ?? 'main',
              createdAt: latest.build.createdAt,
            },
      runtime:
        runtime === null
          ? null
          : { status: runtime.status, previewUrl: runtime.previewUrl, botUsername: runtime.botUsername },
    };
  }

  private projectRoute(request: DemoRequest, project: DemoProject, rest: string): DemoReply {
    const { method, url } = request;
    const body = record(request.body);
    const world = this.world;

    if (rest.startsWith('/agent')) return this.agentRoute(request, project, rest.slice('/agent'.length));

    // The picture of the production site on the project's card; a password-protected site has none, like the instance
    if (method === 'GET' && rest === '/screenshot') {
      if (project.summary.productionUrl === null || project.site.protection.type === 'basic') {
        throw new InstanceError(404, 'No screenshot yet.');
      }
      return { status: 200, svg: screenshotSvg(project) };
    }

    // The instance's view of the project; an admin may open other users' projects.
    if (method === 'GET' && rest === '') {
      const own = project.orgSlug === undefined ? project.ownerId === ANA_ID : this.orgOf(project) !== null;
      const access = own ? 'member' : 'admin';
      const org = this.orgRef(project);
      return ok({
        project: {
          id: project.summary.id,
          name: project.summary.name,
          repository: project.summary.repository,
          productionBranch: 'main',
          status: project.summary.status,
          mode: project.summary.mode,
          // An instance admin gets owner-level access
          role: own ? project.summary.role : 'owner',
          access,
          org,
        },
        access,
        org,
        hostnames: [],
        deployments: [],
        envVars: [],
      });
    }

    // The danger zone
    if (method === 'DELETE' && rest === '') {
      if (project.summary.role !== 'owner') throw new InstanceError(403, 'Only the project owner can do this.');
      if (typeof body.confirm !== 'string' || body.confirm.trim() !== project.summary.name) {
        throw new InstanceError(400, 'Type the project name to confirm.');
      }
      const warnings: string[] = [];
      if (body.deleteSite === true && project.summary.mode === 'byo' && project.site.worker === null) {
        warnings.push('site Worker: This Worker does not exist (the site was never deployed).');
      }
      project.agent?.stop();
      world.projects = world.projects.filter((candidate) => candidate !== project);
      return ok({ warnings });
    }

    // Builds: the repository's GitHub Actions runs
    if (method === 'GET' && rest === '/builds') return ok({ builds: project.builds.map(buildView) });
    // What `bohr deploy` published in the owner's account
    if (method === 'GET' && rest === '/cli-deploys') return ok({ deploys: project.cliDeploys ?? [] });
    const run = rest.match(/^\/builds\/(\d+)$/);
    if (method === 'GET' && run?.[1] !== undefined) {
      const found = project.builds.find((candidate) => candidate.build.id === Number(run[1]));
      if (found === undefined) throw new InstanceError(404, 'Not Found');
      return ok({ jobs: buildJobs(found) });
    }

    if (rest === '/variables' || rest === '/protection' || rest.startsWith('/domains')) {
      return this.siteRoute(request, project, rest);
    }

    // Moving out of bohr's hosting
    if (rest === '/move') {
      if (method === 'GET') {
        return ok({ move: project.move?.view ?? { status: 'unavailable' }, connections: world.connections });
      }
      if (method === 'POST') {
        if (project.move === null || project.summary.mode !== 'managed') {
          throw new InstanceError(400, 'Only projects hosted by bohr can move.');
        }
        const connection = world.connections.find((candidate) => candidate.id === body.connectionId);
        if (connection === undefined) throw new InstanceError(404, 'Cloudflare connection not found.');
        project.move = {
          completions: 0,
          view: {
            status: 'prepared',
            script: 'portfolio-ana',
            accountId: connection.accountId,
            pullRequest: { number: 12, url: 'https://github.com/anasouza/portfolio/pull/12' },
            hostnames: [],
          },
        };
        return ok({ move: project.move.view });
      }
    }
    if (method === 'POST' && rest === '/move/complete') {
      const move = project.move;
      if (move === null || move.view.status === 'available' || move.view.status === 'unavailable') {
        throw new InstanceError(409, 'Prepare the move first.');
      }
      if (move.view.status === 'prepared') {
        move.completions += 1;
        const done = move.completions >= 2;
        const view: MoveView = {
          ...move.view,
          status: done ? 'done' : 'prepared',
          hostnames: done ? PORTFOLIO_HOSTNAMES.done : PORTFOLIO_HOSTNAMES.partial,
        };
        move.view = view;
        if (done) {
          project.summary.mode = 'byo';
          // The site now runs in Ana's account, with the custom domain it had.
          project.site.worker = 'portfolio-ana';
          project.site.domains = project.site.domains.filter((domain) => !domain.hostname.endsWith('.bohr.io'));
        }
      }
      return ok({ move: move.view });
    }

    // The project runtime, as the instance sets it up
    if (method === 'GET' && rest === '/runtime') {
      const runtime = this.runtime(project, url.origin);
      if (runtime === null) throw new InstanceError(404, 'This project has no runtime.');
      return ok(runtime);
    }
    if (method === 'POST' && rest === '/runtime/enable') {
      if (project.runtime !== null) throw new InstanceError(409, 'The agent is already set up for this project.');
      if (project.summary.mode !== 'managed') {
        throw new InstanceError(400, 'Only projects hosted by bohr can turn the agent on this way.');
      }
      project.runtime = {
        status: 'provisioning',
        error: null,
        botUsername: null,
        version: null,
        readyAt: Date.now() + 15_000,
      };
      return ok({ started: true }, 201);
    }
    if (method === 'POST' && rest === '/runtime/retry') return ok({ started: true });
    if (method === 'POST' && rest === '/runtime/telegram-bot') {
      if (typeof body.token !== 'string' || !/^\d+:[\w-]{30,}$/.test(body.token.trim())) {
        throw new InstanceError(400, 'That is not a bot token from BotFather.');
      }
      const username = `${project.summary.name
        .normalize('NFD')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase()}_bot`;
      if (project.runtime !== null) project.runtime.botUsername = username;
      return ok({ username });
    }
    if (method === 'POST' && rest === '/runtime/import') {
      project.agent?.startImport();
      return ok({ started: true });
    }
    throw new InstanceError(404, 'Not found.');
  }

  /** The production site's variables, protection (Basic Auth) and domains. */
  private siteRoute(request: DemoRequest, project: DemoProject, rest: string): DemoReply {
    const { method, url } = request;
    const body = record(request.body);
    const site = project.site;
    const managed = project.summary.mode === 'managed';
    const owner = project.summary.role === 'owner';
    const notDeployed = () =>
      new InstanceError(
        409,
        `The site's Worker (${project.summary.repository.split('/')[1] ?? project.summary.id}) is not deployed yet. Publish the site once, then try again.`,
      );

    if (rest === '/variables') {
      const list = () =>
        [...site.variables].sort((a, b) => a.target.localeCompare(b.target) || a.key.localeCompare(b.key));
      if (method === 'GET') return ok({ variables: list(), canEdit: owner });
      const target = body.target === 'build' || url.searchParams.get('target') === 'build' ? 'build' : 'runtime';
      if (method === 'PUT') {
        const key = String(body.key ?? '');
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key) || typeof body.value !== 'string') {
          throw new InstanceError(400, 'Invalid variable.');
        }
        if (/^(GITHUB_|CLOUDFLARE_|BOHR_)/.test(key) || key === 'CI') {
          throw new InstanceError(400, `${key} is a name bohr or GitHub use themselves.`);
        }
        if (target === 'runtime' && !managed && site.worker === null) throw notDeployed();
        const secret = body.secret === true;
        site.variables = site.variables.filter((entry) => !(entry.target === target && entry.key === key));
        site.variables.push({
          key,
          target,
          secret,
          value: secret ? null : body.value,
          updatedAt: new Date().toISOString(),
        });
        return ok({ variables: list() });
      }
      if (method === 'DELETE') {
        const key = url.searchParams.get('key') ?? '';
        site.variables = site.variables.filter((entry) => !(entry.target === target && entry.key === key));
        return ok({ variables: list() });
      }
    }

    if (rest === '/protection') {
      const view = (): Protection => ({
        type: site.protection.type,
        users: site.protection.users.map((user) => ({ username: user.username })),
        bypassPaths: site.protection.bypassPaths,
        warning: site.protection.warning,
      });
      if (method === 'GET') return ok({ protection: view(), canEdit: owner });
      if (method === 'PUT') {
        if (!managed && site.worker === null) throw notDeployed();
        if (body.type !== 'basic') {
          site.protection = { ...site.protection, type: 'none', users: [], bypassPaths: [] };
          return ok({ protection: view() });
        }
        const known = new Map(site.protection.users.map((user) => [user.username, user.password]));
        const users: { username: string; password: string }[] = [];
        for (const entry of Array.isArray(body.users) ? body.users : []) {
          const user = record(entry);
          const username = String(user.username ?? '');
          if (!/^[^:\s]{1,100}$/.test(username)) throw new InstanceError(400, 'Usernames cannot have spaces or ":".');
          if (users.some((candidate) => candidate.username === username)) {
            throw new InstanceError(400, `${username} appears twice.`);
          }
          const password =
            typeof user.password === 'string' && user.password !== '' ? user.password : known.get(username);
          if (password === undefined) throw new InstanceError(400, `Set a password for ${username}.`);
          users.push({ username, password });
        }
        if (users.length === 0) throw new InstanceError(400, 'Add at least one user.');
        const bypassPaths = (Array.isArray(body.bypassPaths) ? body.bypassPaths : []).map(String);
        if (bypassPaths.some((path) => !/^\/\S*$/.test(path))) throw new InstanceError(400, 'Paths start with "/".');
        site.protection = { ...site.protection, type: 'basic', users, bypassPaths };
        return ok({ protection: view() });
      }
    }

    if (rest.startsWith('/domains')) {
      const view = (status = 200): DemoReply => {
        if (managed) return ok({ hosting: 'bohr', domains: site.domains, canEdit: false } satisfies Domains, status);
        if (site.worker === null) {
          return ok({
            hosting: 'own',
            deployed: false,
            worker: null,
            workersDev: null,
            domains: [],
            zones: [],
            error: notDeployed().message,
            canEdit: owner,
          } satisfies Domains);
        }
        return ok(
          {
            hosting: 'own',
            deployed: true,
            worker: site.worker,
            workersDev: `https://${site.worker}.ana-souza.workers.dev`,
            domains: site.domains.map(({ id, hostname }) => ({ id, hostname })),
            zones: site.zones,
            canEdit: owner,
          } satisfies Domains,
          status,
        );
      };
      if (method === 'GET' && rest === '/domains') return view();
      if (managed) throw new InstanceError(409, 'Move the project to your Cloudflare account to change its domains.');
      if (site.worker === null) throw notDeployed();
      if (method === 'POST' && rest === '/domains') {
        const hostname = String(body.hostname ?? '')
          .trim()
          .toLowerCase();
        if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
          throw new InstanceError(400, `${hostname} is not a domain name (wildcards are not supported).`);
        }
        if (!site.zones.some((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))) {
          throw new InstanceError(
            409,
            `No zone in your Cloudflare account covers ${hostname}. Add the domain to Cloudflare first.`,
          );
        }
        if (!site.domains.some((domain) => domain.hostname === hostname)) {
          site.domains.push({ id: `dom_${Date.now().toString(36)}`, hostname, status: 'live' });
        }
        return view(201);
      }
      const remove = rest.match(/^\/domains\/([^/]+)$/);
      if (method === 'DELETE' && remove?.[1] !== undefined) {
        const id = decodeURIComponent(remove[1]);
        if (!site.domains.some((domain) => domain.id === id)) {
          throw new InstanceError(404, 'That domain is not attached to this site.');
        }
        site.domains = site.domains.filter((domain) => domain.id !== id);
        return view();
      }
    }
    throw new InstanceError(404, 'Not found.');
  }

  private agentRoute(request: DemoRequest, project: DemoProject, rest: string): DemoReply {
    const { method, url } = request;
    const body = record(request.body);
    this.runtime(project, url.origin);
    const agent = project.agent;
    if (agent === null) throw new InstanceError(409, 'The project runtime is not ready yet.');

    if (method === 'GET' && rest === '/state') {
      const state = agent.view();
      return ok({
        ...state,
        project: { ...state.project, previewUrl: `${url.origin}/__demo/preview?project=${project.summary.id}` },
      });
    }
    if (method === 'GET' && rest === '/messages') {
      const after = Number(url.searchParams.get('after') ?? 0) || 0;
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 200);
      return ok(agent.messages(after, limit));
    }
    if (method === 'POST' && rest === '/messages') return ok(agent.send(String(body.text ?? ''), ANA), 201);
    if (method === 'POST' && rest === '/decisions') {
      const action = body.action === 'approve' || body.action === 'discard' ? body.action : null;
      if (action === null) throw new RuntimeError(400, 'invalid_request', 'Ação inválida.');
      return ok(agent.decide(action, Number(body.version), ANA));
    }
    if (method === 'POST' && rest === '/answers') {
      return ok(
        agent.answer(String(body.requestId ?? ''), typeof body.option === 'number' ? body.option : undefined, ANA),
      );
    }
    const cancel = rest.match(/^\/requests\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancel?.[1] !== undefined) return ok(agent.cancel(decodeURIComponent(cancel[1]), ANA));
    if (method === 'POST' && rest === '/rollback') return ok(agent.rollback(ANA));
    if (method === 'POST' && rest === '/invites') return ok(agent.invite(), 201);
    if (method === 'POST' && rest === '/join') return ok({ joined: true });
    if (method === 'GET' && rest === '/members') return ok({ members: agent.members });
    const member = rest.match(/^\/members\/([^/]+)$/);
    if (method === 'DELETE' && member?.[1] !== undefined) return ok(agent.revoke(decodeURIComponent(member[1]), ANA));
    if (method === 'PATCH' && rest === '/settings') return ok(agent.updateSettings(body as SettingsPatch));
    if (method === 'POST' && rest === '/import') return ok(agent.startImport());
    if (method === 'GET' && rest === '/preview') {
      return ok({
        state: 'running',
        status: 'running',
        port: 5173,
        reason: null,
        containerRunning: true,
        runner: {
          status: 'running',
          port: 5173,
          reason: null,
          log: '$ npm install\nadded 212 packages in 9s\n$ npm run dev -- --port 5173\n  VITE ready in 412 ms\n',
        },
      });
    }
    throw new RuntimeError(404, 'not_found', 'Not found.');
  }
}

// The Vite plugin

/** What the middleware uses of Node's request and response. */
interface NodeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

const DEMO_PATHS = [...INSTANCE_PATHS, '/__demo'];

function parseUrl(value: string | string[] | undefined): URL | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function readBody(request: NodeRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(bytes);
      try {
        resolve(text ? JSON.parse(text) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

export function demoApi(): Plugin {
  const instance = new DemoInstance();
  return {
    name: 'bohr-demo-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req: NodeRequest, res: NodeResponse, next: () => void) => {
        const host = typeof req.headers.host === 'string' ? req.headers.host : 'localhost';
        const url = new URL(req.url ?? '/', `http://${host}`);
        if (!DEMO_PATHS.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
          next();
          return;
        }
        const referer = parseUrl(req.headers.referer);
        const reply = instance.handle({ method: req.method ?? 'GET', url, body: await readBody(req), referer });
        res.statusCode = reply.status;
        res.setHeader('Cache-Control', 'no-store');
        if (reply.location !== undefined) {
          res.setHeader('Location', reply.location);
          res.end();
        } else if (reply.svg !== undefined) {
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(reply.svg);
        } else if (reply.html !== undefined) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(reply.html);
        } else if (reply.json !== undefined) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(reply.json));
        } else {
          res.end();
        }
      });
      server.config.logger.info(
        '\n  bohr demo: signed in as Ana Souza (an admin), with demo data in memory. The email sign-in code is 123456. /__demo/reset starts over.\n',
      );
    },
  };
}
