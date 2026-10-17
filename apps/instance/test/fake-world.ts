// One fake for everything outside the instance that onboarding talks to: the user's Cloudflare
// account, GitHub, Telegram, Anthropic and the provisioned project Worker.

type Json = Record<string, unknown>;
export type Call = { method: string; url: URL; headers: Headers; body: string };

const cf = (result: unknown, init: ResponseInit = {}) =>
  Response.json(
    {
      success: true,
      errors: [],
      messages: [],
      result,
      result_info: { page: 1, per_page: 1000, count: 1, total_count: 1, total_pages: 1 },
    },
    init,
  );
const cfError = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });

export class FakeWorld {
  calls: Call[] = [];
  // Cloudflare
  accounts = [{ id: 'acc-user', name: "Ana's account" }];
  deniedCapabilities = new Set<'containers' | 'scripts' | 'd1'>();
  subdomain: string | null = 'ana';
  scripts = new Map<string, { metadata: Json; modules: string[] }>();
  secrets = new Map<string, Map<string, string>>();
  namespaces: { id: string; name: string; script: string; class: string }[] = [];
  applications = new Map<string, Json>();
  workersDev = new Set<string>();
  // Zones of the user's account (name -> id) and Custom Domains of its Workers
  zones = new Map<string, string>();
  domains: { id: string; hostname: string; service: string; zone_id: string; zone_name: string }[] = [];
  // D1 databases of the user's account
  d1Databases: { uuid: string; name: string }[] = [];
  // GitHub
  // type defaults to User; accountId to 9000 + the installation id
  installations = new Map<
    number,
    {
      login: string;
      type?: 'User' | 'Organization';
      accountId?: number;
      repos: { id: number; name: string; owner: string; default_branch: string }[];
      /** "all": repositories created later are reached too; selected (the default) needs them added. */
      selection?: 'all' | 'selected';
    }
  >([[55, { login: 'ana', repos: [{ id: 901, name: 'loja', owner: 'ana', default_branch: 'main' }] }]]);
  // Repositories created from a template (POST /repos/:owner/:template/generate), by full name
  generated = new Map<string, { id: number; template: string; private: boolean; description: string | null }>();
  // Polls of a new repository's default branch that still miss it (GitHub copies the template afterwards)
  branchDelay = 1;
  // Accounts where the user cannot create repositories (GitHub answers 403)
  generateDenied = new Set<string>();
  // Files written with PUT /repos/:owner/:repo/contents/:path, in order
  commits: { repository: string; path: string; message: string; branch: string; content: string }[] = [];
  // Repositories added to installations (PUT /user/installations/:id/repositories/:repositoryId)
  installationAdds: { installationId: number; repositoryId: number }[] = [];
  // GitHub organizations (by login) and their members, for GET /orgs/:org/members
  githubOrgs = new Map<
    string,
    { id: number; name: string | null; members: { id: number; login: string; role: 'admin' | 'member' }[] }
  >();
  // The App without Organization › Members: read; GitHub refuses the narrowed token, or the listing
  membersDenied: null | 'token' | 'listing' = null;
  memberPageSize = 100;
  actionsSecrets = new Set<string>();
  // Files of the repositories (by path), as GET /repos/:owner/:repo/contents/:path serves them
  repoFiles = new Map<string, string>();
  // Installations the signed-in GitHub user can access (GET /user/installations)
  userInstallations = [55];
  // The profile behind the user access token (GET /user, the sign-in)
  githubProfile = { id: 5001, login: 'ana', name: 'Ana' as string | null, email: null as string | null };
  // Installations removed with DELETE /app/installations/:id
  uninstalled: number[] = [];
  // Stripe subscriptions cancelled with DELETE /v1/subscriptions/:id
  stripeCancelled: string[] = [];
  // Telegram
  telegram: { token: string; method: string; body: Json }[] = [];
  managedTokens = new Map<number, string>([[42424242, '42424242:managed-token-for-the-project-bot-0123']]);
  // Anthropic
  validAnthropicKeys = new Set(['sk-ant-api03-validkey-0123456789abcdef']);
  // Project Worker
  projectWorkerCalls: Call[] = [];
  // Its Claude subscription sign-in (claude setup-token in the container): the link, and the token for good-code#state
  claudeLoginUrl = 'https://claude.com/cai/oauth/authorize?code=true&client_id=cli&state=s';
  claudeToken = `sk-ant-oat01-${'k'.repeat(40)}wxyz`;
  private messageId = 500;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const isForm = request.headers.get('content-type')?.startsWith('multipart/form-data');
    const body = isForm ? '' : await request.clone().text();
    const call = { method: request.method, url, headers: request.headers, body };
    this.calls.push(call);
    if (url.hostname === 'api.cloudflare.com') return this.cloudflare(request, url, body);
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
      return Response.json({ access_token: 'ghu_user_token' });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/user/installations') {
      return Response.json({
        total_count: this.userInstallations.length,
        installations: this.userInstallations.map((id) => {
          const found = this.installations.get(id);
          return { id, account: { login: found?.login ?? 'ana', type: found?.type ?? 'User' } };
        }),
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/user') return Response.json(this.githubProfile);
    if (url.hostname === 'api.github.com') return this.github(url, request.method, request.headers, body);
    const stripeSubscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname);
    if (url.hostname === 'api.stripe.com' && stripeSubscription?.[1] !== undefined && request.method === 'DELETE') {
      this.stripeCancelled.push(decodeURIComponent(stripeSubscription[1]));
      return Response.json({ id: stripeSubscription[1], status: 'canceled' });
    }
    if (url.hostname === 'api.telegram.org') return this.telegramApi(url, body);
    if (url.hostname === 'api.anthropic.com') {
      return this.validAnthropicKeys.has(request.headers.get('x-api-key') ?? '')
        ? Response.json({ data: [] })
        : Response.json({ type: 'error' }, { status: 401 });
    }
    // A provider compatible with the Anthropic API, behind a path prefix
    if (url.hostname === 'llm.example.com') {
      const key = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      return url.pathname === '/anthropic/v1/models' && this.validAnthropicKeys.has(key)
        ? Response.json({ data: [] })
        : Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (url.hostname.endsWith('.ana.workers.dev')) {
      this.projectWorkerCalls.push(call);
      return this.projectWorker(url, body);
    }
    return new Response(`unexpected ${request.method} ${url}`, { status: 599 });
  };

  private projectWorker(url: URL, body: string): Response {
    const path = url.pathname.replace('/__bohr/api/v1', '');
    if (path === '/claude-login/start') return Response.json({ loginId: 'login_0123456789', url: this.claudeLoginUrl });
    if (path === '/claude-login/finish') {
      const { loginId, code } = JSON.parse(body) as { loginId: string; code: string };
      if (loginId !== 'login_0123456789') return Response.json({ error: 'unknown_login' }, { status: 404 });
      return code === 'good-code#state'
        ? Response.json({ token: this.claudeToken })
        : Response.json(
            { error: 'code_rejected', message: 'OAuth error: Invalid authorization code' },
            { status: 422 },
          );
    }
    if (path === '/claude-login/cancel') return Response.json({ cancelled: true });
    return Response.json({ requestId: 'req_import' });
  }

  private async cloudflare(request: Request, url: URL, body: string): Promise<Response> {
    const path = url.pathname.replace('/client/v4', '');
    const method = request.method;
    if (path === '/user/tokens/verify') return cf({ id: 'tok1', status: 'active' });
    if (path === '/accounts' && method === 'GET') return cf(this.accounts);
    if (path === '/zones' && method === 'GET') {
      const name = url.searchParams.get('name');
      const zones = [...this.zones].map(([zoneName, id]) => ({ id, name: zoneName, status: 'active' }));
      return cf(name === null ? zones : zones.filter((zone) => zone.name === name));
    }
    const account = /^\/accounts\/([^/]+)(\/.*)?$/.exec(path);
    if (account === null) return cfError(404, 7003, 'no route');
    const rest = account[2] ?? '';
    if (rest === '' && method === 'GET') return cf(this.accounts.find((a) => a.id === account[1]));
    if (rest === '/d1/database' && this.deniedCapabilities.has('d1'))
      return cfError(403, 10000, 'Authentication error');
    if (rest === '/d1/database' && method === 'GET') {
      const name = url.searchParams.get('name');
      return cf(name === null ? this.d1Databases : this.d1Databases.filter((database) => database.name.includes(name)));
    }
    if (rest === '/d1/database' && method === 'POST') {
      const { name } = JSON.parse(body) as { name: string };
      const database = { uuid: `d1-${this.d1Databases.length + 1}-0000-4000-8000-000000000000`, name };
      this.d1Databases.push(database);
      return cf(database);
    }
    const d1 = /^\/d1\/database\/([^/]+)$/.exec(rest);
    if (d1?.[1] !== undefined && method === 'DELETE') {
      const before = this.d1Databases.length;
      this.d1Databases = this.d1Databases.filter((database) => database.uuid !== d1[1]);
      return before === this.d1Databases.length ? cfError(404, 7404, 'database not found') : cf(null);
    }
    if (rest === '/workers/scripts' && method === 'GET') {
      return this.deniedCapabilities.has('scripts') ? cfError(403, 10000, 'Authentication error') : cf([]);
    }
    if (rest === '/containers/applications' && method === 'GET') {
      return this.deniedCapabilities.has('containers') ? cfError(403, 10000, 'Authentication error') : cf([]);
    }
    if (rest === '/workers/subdomain') {
      return this.subdomain === null ? cfError(404, 10007, 'no subdomain') : cf({ subdomain: this.subdomain });
    }
    if (rest === '/workers/durable_objects/namespaces') return cf(this.namespaces);
    if (rest === '/workers/domains' && method === 'GET') {
      const service = url.searchParams.get('service');
      return cf(service === null ? this.domains : this.domains.filter((domain) => domain.service === service));
    }
    if (rest === '/workers/domains' && method === 'PUT') {
      const { hostname, service, zone_id } = JSON.parse(body) as { hostname: string; service: string; zone_id: string };
      const zoneName = [...this.zones].find(([, id]) => id === zone_id)?.[0] ?? '';
      const domain = { id: `dom-${this.domains.length + 1}`, hostname, service, zone_id, zone_name: zoneName };
      this.domains.push(domain);
      return cf(domain);
    }
    const domain = /^\/workers\/domains\/([^/]+)$/.exec(rest);
    if (domain?.[1] !== undefined && method === 'DELETE') {
      this.domains = this.domains.filter((candidate) => candidate.id !== domain[1]);
      return cf(null);
    }
    const service = /^\/workers\/services\/([^/]+)$/.exec(rest);
    if (service?.[1] !== undefined) {
      const script = this.scripts.get(service[1]);
      return script === undefined
        ? cfError(404, 10090, 'service not found')
        : cf({ default_environment: { script: { migration_tag: 'v1' } } });
    }
    const subdomain = /^\/workers\/scripts\/([^/]+)\/subdomain$/.exec(rest);
    if (subdomain?.[1] !== undefined && method === 'POST') {
      this.workersDev.add(subdomain[1]);
      return cf({ enabled: true });
    }
    const secret = /^\/workers\/scripts\/([^/]+)\/secrets$/.exec(rest);
    if (secret?.[1] !== undefined && method === 'PUT') {
      const { name, text } = JSON.parse(body) as { name: string; text: string };
      const secrets = this.secrets.get(secret[1]) ?? new Map();
      secrets.set(name, text);
      this.secrets.set(secret[1], secrets);
      return cf({ name, type: 'secret_text' });
    }
    const deleted = /^\/workers\/scripts\/([^/]+)\/secrets\/([^/]+)$/.exec(rest);
    if (deleted?.[1] !== undefined && deleted[2] !== undefined && method === 'DELETE') {
      const removed = this.secrets.get(deleted[1])?.delete(decodeURIComponent(deleted[2]));
      return removed ? cf(null) : cfError(404, 10056, 'secret not found');
    }
    const script = /^\/workers\/scripts\/([^/]+)$/.exec(rest);
    if (script?.[1] !== undefined && method === 'DELETE') {
      const name = script[1];
      if (!this.scripts.delete(name)) return cfError(404, 10007, 'script not found');
      this.namespaces = this.namespaces.filter((namespace) => namespace.script !== name);
      this.secrets.delete(name);
      this.workersDev.delete(name);
      return cf(null);
    }
    if (script?.[1] !== undefined && method === 'PUT') {
      const form = await request.formData();
      const part = form.get('metadata');
      const metadata = JSON.parse(typeof part === 'string' ? part : await (part as File).text()) as Json;
      const modules = [...form.keys()].filter((key) => key !== 'metadata');
      this.scripts.set(script[1], { metadata, modules });
      const migrations = metadata.migrations as { new_sqlite_classes?: string[] } | undefined;
      for (const className of migrations?.new_sqlite_classes ?? []) {
        this.namespaces.push({
          id: `ns-${script[1]}`,
          name: `${script[1]}_${className}`,
          script: script[1],
          class: className,
        });
      }
      const secrets = this.secrets.get(script[1]) ?? new Map();
      for (const binding of (metadata.bindings as { type: string; name: string; text?: string }[]) ?? []) {
        if (binding.type === 'secret_text') secrets.set(binding.name, binding.text ?? '');
      }
      this.secrets.set(script[1], secrets);
      return cf({ id: script[1], migration_tag: migrations ? 'v1' : undefined });
    }
    const application = /^\/containers\/applications\/([^/]+)$/.exec(rest);
    if (application?.[1] !== undefined && method === 'DELETE') {
      return this.applications.delete(application[1]) ? cf(null) : cfError(404, 1000, 'not found');
    }
    if (application?.[1] !== undefined && method === 'GET') {
      const found = this.applications.get(application[1]);
      return found === undefined ? cfError(404, 1000, 'not found') : cf(found);
    }
    if (rest === '/containers/applications' && method === 'POST') {
      const created = JSON.parse(body) as { name: string; durable_objects: { namespace_id: string } };
      const app = {
        id: created.durable_objects.namespace_id,
        name: created.name,
        scheduling_policy: 'durable_object',
        durable_objects: created.durable_objects,
      };
      this.applications.set(app.id, app);
      return cf(app);
    }
    if (rest === '/containers/image-preparations') return cf({ status: 'ready' });
    return cfError(404, 7003, `no route ${method} ${path}`);
  }

  private github(url: URL, method: string, headers: Headers, body: string): Response {
    const generate = /^\/repos\/([^/]+)\/([^/]+)\/generate$/.exec(url.pathname);
    if (generate !== null && method === 'POST') {
      const input = JSON.parse(body) as { owner: string; name: string; private: boolean; description?: string };
      const fullName = `${input.owner}/${input.name}`;
      if (this.generateDenied.has(input.owner)) {
        return Response.json({ message: 'Resource not accessible by integration' }, { status: 403 });
      }
      if (this.generated.has(fullName)) {
        return Response.json(
          { message: 'Repository creation failed.', errors: ['Name already exists on this account'] },
          { status: 422 },
        );
      }
      const id = 7000 + this.generated.size;
      this.generated.set(fullName, {
        id,
        template: `${generate[1]}/${generate[2]}`,
        private: input.private,
        description: input.description ?? null,
      });
      const repo = { id, name: input.name, owner: input.owner, default_branch: 'main' };
      // An installation on every repository of the account reaches the new one by itself
      for (const installation of this.installations.values()) {
        if (installation.login === input.owner && installation.selection === 'all') installation.repos.push(repo);
      }
      return Response.json(
        {
          id,
          node_id: `R_${id}`,
          name: input.name,
          full_name: fullName,
          owner: { login: input.owner },
          default_branch: 'main',
          private: input.private,
          html_url: `https://github.com/${fullName}`,
        },
        { status: 201 },
      );
    }
    const branch = /^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/.exec(url.pathname);
    if (branch !== null && this.generated.has(`${branch[1]}/${branch[2]}`)) {
      if (this.branchDelay > 0) {
        this.branchDelay--;
        // What GitHub answers while it copies the template into the new repository
        return Response.json({ message: 'Git Repository is empty.' }, { status: 409 });
      }
      return Response.json({ ref: `refs/heads/${branch[3]}`, object: { sha: 'a'.repeat(40), type: 'commit' } });
    }
    const added = /^\/user\/installations\/(\d+)\/repositories\/(\d+)$/.exec(url.pathname);
    if (added?.[1] !== undefined && added[2] !== undefined && method === 'PUT') {
      const installation = this.installations.get(Number(added[1]));
      const repositoryId = Number(added[2]);
      const generated = [...this.generated].find(([, repo]) => repo.id === repositoryId);
      if (installation === undefined || generated === undefined) {
        return Response.json({ message: 'Not Found' }, { status: 404 });
      }
      const [owner = '', name = ''] = generated[0].split('/');
      installation.repos.push({ id: repositoryId, name, owner, default_branch: 'main' });
      this.installationAdds.push({ installationId: Number(added[1]), repositoryId });
      return new Response(null, { status: 204 });
    }
    const written = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(url.pathname);
    if (written?.[3] !== undefined && method === 'PUT') {
      const input = JSON.parse(body) as { message: string; content: string; branch: string };
      const path = decodeURIComponent(written[3]);
      const content = new TextDecoder().decode(Uint8Array.from(atob(input.content), (char) => char.charCodeAt(0)));
      this.repoFiles.set(path, content);
      this.commits.push({
        repository: `${written[1]}/${written[2]}`,
        path,
        message: input.message,
        branch: input.branch,
        content,
      });
      return Response.json({ commit: { sha: `c${this.commits.length}`.padEnd(40, '0') } }, { status: 201 });
    }
    const orgMembers = /^\/orgs\/([^/]+)\/members$/.exec(url.pathname);
    if (orgMembers?.[1] !== undefined) {
      if (this.membersDenied !== null) {
        return Response.json({ message: 'Resource not accessible by integration' }, { status: 403 });
      }
      const org = this.githubOrgs.get(orgMembers[1]);
      if (org === undefined) return Response.json({ message: 'Not Found' }, { status: 404 });
      const role = url.searchParams.get('role') ?? 'all';
      const all = org.members.filter((member) => role === 'all' || member.role === role);
      const size = Math.min(this.memberPageSize, Number(url.searchParams.get('per_page') ?? 30));
      const page = Number(url.searchParams.get('page') ?? 1);
      const items = all.slice((page - 1) * size, page * size);
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      return Response.json(
        items.map((member) => ({ id: member.id, login: member.login, avatar_url: null })),
        page * size < all.length ? { headers: { link: `<${next.href}>; rel="next"` } } : {},
      );
    }
    const org = /^\/orgs\/([^/]+)$/.exec(url.pathname);
    if (org?.[1] !== undefined) {
      const found = this.githubOrgs.get(org[1]);
      return found === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({
            id: found.id,
            login: org[1],
            name: found.name,
            avatar_url: `https://avatars.example/${found.id}`,
          });
    }
    const repoInstallation = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(url.pathname);
    if (repoInstallation !== null) {
      const id = [...this.installations].find(([, found]) =>
        found.repos.some((repo) => repo.owner === repoInstallation[1] && repo.name === repoInstallation[2]),
      )?.[0];
      return id === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({ id, account: { login: repoInstallation[1] } });
    }
    if (/^\/repos\/[^/]+\/[^/]+\/actions\/secrets\/public-key$/.test(url.pathname)) {
      return Response.json({ key_id: 'key-1', key: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) });
    }
    const actionsSecret = /^\/repos\/[^/]+\/[^/]+\/actions\/secrets\/([A-Z_]+)$/.exec(url.pathname);
    if (actionsSecret?.[1] !== undefined && method === 'PUT') {
      this.actionsSecrets.add(actionsSecret[1]);
      return new Response(null, { status: 201 });
    }
    if (actionsSecret?.[1] !== undefined && method === 'DELETE') {
      return this.actionsSecrets.delete(actionsSecret[1])
        ? new Response(null, { status: 204 })
        : Response.json({ message: 'Not Found' }, { status: 404 });
    }
    const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(url.pathname);
    if (contents?.[1] !== undefined && method === 'GET') {
      const text = this.repoFiles.get(decodeURIComponent(contents[1]));
      return text === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({ type: 'file', sha: 'blob', encoding: 'base64', content: btoa(text) });
    }
    const installation = /^\/app\/installations\/(\d+)$/.exec(url.pathname);
    if (installation?.[1] !== undefined && method === 'DELETE') {
      const id = Number(installation[1]);
      if (!this.installations.delete(id)) return Response.json({ message: 'Not Found' }, { status: 404 });
      this.uninstalled.push(id);
      return new Response(null, { status: 204 });
    }
    if (installation?.[1] !== undefined) {
      const id = Number(installation[1]);
      const found = this.installations.get(id);
      return found === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json({
            id,
            account: {
              id: found.accountId ?? 9000 + id,
              login: found.login,
              type: found.type ?? 'User',
              avatar_url: `https://avatars.example/${found.login}`,
            },
            permissions: { metadata: 'read' },
            repository_selection: found.selection ?? 'selected',
          });
    }
    const token = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (token?.[1] !== undefined) {
      const requested = (body ? JSON.parse(body) : {}) as { permissions?: Record<string, string> };
      if (this.membersDenied === 'token' && requested.permissions?.members !== undefined) {
        return Response.json(
          { message: 'The permissions requested are not granted to this installation.' },
          { status: 422 },
        );
      }
      return Response.json(
        {
          token: `ghs_installation_${token[1]}`,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: {},
        },
        { status: 201 },
      );
    }
    if (url.pathname === '/installation/repositories') {
      // An installation token sees its installation's repositories
      const tokenFor = /^Bearer ghs_installation_(\d+)$/.exec(headers.get('authorization') ?? '')?.[1];
      const repos = [...this.installations]
        .filter(([id]) => tokenFor === undefined || String(id) === tokenFor)
        .flatMap(([, found]) => found.repos);
      return Response.json({
        total_count: repos.length,
        repositories: repos.map((repo) => ({
          id: repo.id,
          node_id: `R_${repo.id}`,
          name: repo.name,
          full_name: `${repo.owner}/${repo.name}`,
          owner: { login: repo.owner },
          default_branch: repo.default_branch,
          private: true,
          html_url: `https://github.com/${repo.owner}/${repo.name}`,
        })),
      });
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  }

  private telegramApi(url: URL, body: string): Response {
    const [, botPart = '', method = ''] = url.pathname.split('/');
    const token = botPart.replace(/^bot/, '');
    const params = (body ? JSON.parse(body) : {}) as Json;
    this.telegram.push({ token, method, body: params });
    if (method === 'getMe') {
      const id = Number(token.split(':')[0]);
      return Response.json({
        ok: true,
        result: {
          id,
          is_bot: true,
          first_name: 'Bot',
          username: id === 42424242 ? 'loja_ana_bot' : 'bohr_platform_bot',
          can_manage_bots: true,
        },
      });
    }
    if (method === 'getManagedBotToken') {
      const managed = this.managedTokens.get(Number(params.user_id));
      return managed === undefined
        ? Response.json({ ok: false, error_code: 400, description: 'Bad Request: bot not found' }, { status: 400 })
        : Response.json({ ok: true, result: managed });
    }
    if (method === 'sendMessage') {
      this.messageId++;
      return Response.json({
        ok: true,
        result: {
          message_id: this.messageId,
          date: 1,
          chat: { id: params.chat_id, type: 'private' },
          text: params.text,
        },
      });
    }
    return Response.json({ ok: true, result: true });
  }

  /** Text of the messages a bot sent, in order. */
  sentBy(tokenPrefix: string): string[] {
    return this.telegram
      .filter((call) => call.token.startsWith(tokenPrefix) && call.method === 'sendMessage')
      .map((call) => String(call.body.text));
  }
}
