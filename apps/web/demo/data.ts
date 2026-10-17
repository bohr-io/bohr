// The demo's in-memory instance: Ana Souza on bohr.io Cloud, with three projects. Everything resets when
// the dev server restarts (or at /__demo/reset).
import type { MemberView, ProjectState } from '@bohr/shared';
import type {
  AgentSettingsInput,
  Billing,
  CliDeploy,
  CloudflareConnection,
  IdentityProvider,
  InstanceInfo,
  MovedHostname,
  MoveView,
  OnboardingStep,
  OrgRole,
  ProjectSummary,
  Protection,
  Repository,
  Runtime,
  UserRole,
  Variable,
} from '../src/api.ts';
import { DemoAgent, type Person } from './agent.ts';
import { DEMO_BUILDS, type DemoBuild } from './builds.ts';

/** Ana is a Telegram user, so her member key in the projects is her Telegram one. */
export const ANA: Person = { key: 'tg:5550101', name: 'Ana Souza' };
export const BRUNO: Person = { key: 'tg:5550202', name: 'Bruno Lima' };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let nextCliDeploy = 1;
/** A deploy `bohr deploy` made with wrangler; `committed: false` had uncommitted changes (no commit). */
function cliDeploy(branch: string, production: boolean, url: string, msAgo: number, committed = true): CliDeploy {
  const n = nextCliDeploy++;
  return {
    id: `cd_demo${n}`,
    branch,
    production,
    workerName: 'loja-aurora',
    versionId: `5f0c${n}a2e-7b1d-4c3e-9f20-1a2b3c4d5e6${n}`,
    url,
    commitSha: committed ? `${n}e4d7c9a1b2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d`.slice(0, 40) : null,
    userId: ANA_ID,
    createdAt: ago(msAgo),
  };
}

export const INSTANCE: InstanceInfo = {
  setup: { githubApp: true, platformBot: true },
  billing: true,
  telegramBot: 'bohr_demo_bot',
  githubAppSlug: 'bohr-demo',
};

/** Ana's user id: she is signed in, and she is an admin of the demo instance. */
export const ANA_ID = 'u_ana';

/** The code the demo's email sign-in accepts (the login page shows it in demo mode). */
export const DEMO_EMAIL_CODE = '123456';

// Production addresses that are real public sites, so the overview's preview has a page to show.
const LOJA_AURORA_URL = 'https://bohr.io';
const PORTFOLIO_URL = 'https://example.com';

/** A user of the instance, as the admin area sees them; Telegram is one of the identities. */
export interface DemoUser {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  createdAt: string;
  identities: { provider: IdentityProvider; username: string }[];
  /** Everyone but Ana; hers comes from the world's billing. */
  subscription: string | null;
}

function demoUsers(): DemoUser[] {
  return [
    {
      id: ANA_ID,
      name: ANA.name,
      email: 'ana.souza@exemplo.com.br',
      role: 'admin',
      createdAt: ago(240 * DAY),
      identities: [
        { provider: 'github', username: 'anasouza' },
        { provider: 'email', username: 'ana.souza@exemplo.com.br' },
        { provider: 'telegram', username: 'ana_souza' },
      ],
      subscription: null,
    },
    {
      id: 'u_bruno',
      name: BRUNO.name,
      email: 'bruno.lima@exemplo.com.br',
      role: 'user',
      createdAt: ago(60 * DAY),
      identities: [
        { provider: 'github', username: 'brunolima' },
        { provider: 'telegram', username: 'bruno_lima' },
      ],
      subscription: 'active',
    },
    {
      id: 'u_carla',
      name: 'Carla Mendes',
      email: 'carla@cafelume.com.br',
      role: 'user',
      createdAt: ago(12 * DAY),
      identities: [{ provider: 'email', username: 'carla@cafelume.com.br' }],
      subscription: 'past_due',
    },
    {
      id: 'u_diego',
      name: 'Diego Rocha',
      email: 'diego@aurora.dev',
      role: 'admin',
      createdAt: ago(200 * DAY),
      identities: [{ provider: 'github', username: 'diegorocha' }],
      subscription: null,
    },
    {
      id: 'u_eva',
      name: null,
      email: 'eva@exemplo.com',
      role: 'user',
      createdAt: ago(2 * DAY),
      identities: [{ provider: 'email', username: 'eva@exemplo.com' }],
      subscription: null,
    },
  ];
}

export const REPOSITORIES: Repository[] = [
  { id: 101, fullName: 'anasouza/blog-aurora', defaultBranch: 'main', private: false },
  { id: 102, fullName: 'anasouza/cardapio-cafe-lume', defaultBranch: 'main', private: true },
  { id: 103, fullName: 'anasouza/loja-aurora', defaultBranch: 'main', private: true },
  { id: 104, fullName: 'anasouza/portfolio', defaultBranch: 'master', private: false },
];

/** A member of an organization, mirrored from GitHub; removed: taken out in bohr, so a sync does not bring them back. */
export interface DemoOrgMember {
  githubUserId: number;
  githubLogin: string;
  name: string | null;
  email: string | null;
  userId: string | null;
  role: OrgRole;
  status: 'active' | 'pending' | 'removed';
  source: 'github' | 'bohr';
}

/** An organization: a GitHub organization with the bohr GitHub App, its own subscription, Cloudflare and agent. */
export interface DemoOrg {
  id: string;
  slug: string;
  name: string;
  githubLogin: string;
  avatarUrl: string | null;
  createdAt: string;
  installed: boolean;
  /** False: the GitHub App lacks Members: read, so only the installer was imported. */
  membersPermission: boolean;
  /** The subscription's status, or null without one. */
  subscription: string | null;
  connections: CloudflareConnection[];
  /** A pasted token reached several accounts: the admin picks one. */
  choosingAccount: boolean;
  agent: DemoAgentSettings | null;
  members: DemoOrgMember[];
  /** The repositories the organization's installation reaches. */
  repositories: Repository[];
  /** People GitHub reports on the next sync. */
  nextSync: DemoOrgMember[];
}

const orgMember = (
  githubUserId: number,
  githubLogin: string,
  role: OrgRole,
  user: { id: string; name: string | null; email: string | null } | null,
): DemoOrgMember => ({
  githubUserId,
  githubLogin,
  name: user?.name ?? null,
  email: user?.email ?? null,
  userId: user?.id ?? null,
  role,
  status: user === null ? 'pending' : 'active',
  source: 'github',
});

const ANA_GITHUB = { id: ANA_ID, name: 'Ana Souza', email: 'ana.souza@exemplo.com.br' };

export function demoOrgs(): DemoOrg[] {
  return [
    {
      // Set up, with an admin, a member and someone who has not signed in to bohr yet.
      id: 'o_aurora',
      slug: 'aurora-comercio',
      name: 'Aurora Comércio',
      githubLogin: 'aurora-comercio',
      avatarUrl: null,
      createdAt: ago(90 * DAY),
      installed: true,
      membersPermission: true,
      subscription: 'active',
      connections: [{ id: 'cf_org_1', accountId: 'f4e3d2c1b0a99887766554433221100f', accountName: 'Aurora Comércio' }],
      choosingAccount: false,
      agent: {
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-demo-org-aurora-demo-demo-9c1d',
        baseUrl: null,
        model: 'claude-sonnet-5-5',
        effort: 'medium',
      },
      members: [
        orgMember(5550101, 'anasouza', 'admin', ANA_GITHUB),
        orgMember(5550404, 'diegorocha', 'admin', { id: 'u_diego', name: 'Diego Rocha', email: 'diego@aurora.dev' }),
        orgMember(5550202, 'brunolima', 'member', {
          id: 'u_bruno',
          name: 'Bruno Lima',
          email: 'bruno.lima@exemplo.com.br',
        }),
        orgMember(5550606, 'fernanda-dev', 'member', null),
      ],
      repositories: [
        { id: 201, fullName: 'aurora-comercio/site-institucional', defaultBranch: 'main', private: true },
        { id: 202, fullName: 'aurora-comercio/catalogo', defaultBranch: 'main', private: true },
        { id: 203, fullName: 'aurora-comercio/blog', defaultBranch: 'main', private: false },
      ],
      nextSync: [orgMember(5550707, 'gabriel-sa', 'member', null)],
    },
    {
      // Just installed: the GitHub App has no Members: read, and nothing is set up yet (the setup checklist).
      id: 'o_lume',
      slug: 'cafe-lume',
      name: 'Café Lume',
      githubLogin: 'cafe-lume',
      avatarUrl: null,
      createdAt: ago(1 * DAY),
      installed: true,
      membersPermission: false,
      subscription: null,
      connections: [],
      choosingAccount: false,
      agent: null,
      members: [orgMember(5550101, 'anasouza', 'admin', ANA_GITHUB)],
      repositories: [{ id: 301, fullName: 'cafe-lume/cardapio-digital', defaultBranch: 'main', private: true }],
      nextSync: [],
    },
    {
      // Ana is a member here: no setup and no admin actions.
      id: 'o_norte',
      slug: 'estudio-norte',
      name: 'Estúdio Norte',
      githubLogin: 'EstudioNorte',
      avatarUrl: null,
      createdAt: ago(30 * DAY),
      installed: true,
      membersPermission: true,
      subscription: 'active',
      connections: [{ id: 'cf_org_2', accountId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', accountName: 'Estúdio Norte' }],
      choosingAccount: false,
      agent: {
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-demo-org-norte-demo-demo-4b2e',
        baseUrl: null,
        model: null,
        effort: null,
      },
      members: [
        orgMember(5550404, 'diegorocha', 'admin', { id: 'u_diego', name: 'Diego Rocha', email: 'diego@aurora.dev' }),
        orgMember(5550101, 'anasouza', 'member', ANA_GITHUB),
      ],
      repositories: [{ id: 401, fullName: 'EstudioNorte/portal', defaultBranch: 'main', private: true }],
      nextSync: [],
    },
  ];
}

/** The production site: its variables, protection and domains. */
export interface DemoSite {
  variables: Variable[];
  protection: Omit<Protection, 'users'> & { users: { username: string; password: string }[] };
  /** The site's Worker in the owner's account; null until its first deploy, and while bohr hosts it. */
  worker: string | null;
  domains: { id: string; hostname: string; status: 'pending' | 'live' }[];
  /** The zones of the owner's Cloudflare account. */
  zones: { name: string; status: string }[];
}

export function demoSite(overrides: Partial<DemoSite> = {}): DemoSite {
  return {
    variables: [],
    protection: { type: 'none', users: [], bypassPaths: [], warning: null },
    worker: null,
    domains: [],
    zones: [
      { name: 'aurora.dev', status: 'active' },
      { name: 'lojaaurora.com.br', status: 'active' },
    ],
    ...overrides,
  };
}

const variable = (key: string, target: Variable['target'], value: string | null, daysAgo: number): Variable => ({
  key,
  target,
  secret: value === null,
  value,
  updatedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
});

export interface DemoProject {
  summary: Omit<ProjectSummary, 'runtime'>;
  /** The organization the project belongs to (its slug); personal projects have none. */
  orgSlug?: string;
  /** The owner's user id: Ana's projects are hers; the others are seen in the admin area. */
  ownerId: string;
  createdAt: string;
  /** null: only deploys (migrated from bohr v1). */
  runtime: (Omit<Runtime, 'previewUrl'> & { readyAt: number }) | null;
  agent: DemoAgent | null;
  /** Projects hosted by bohr that can move to the owner's Cloudflare account. */
  move: { view: MoveView; completions: number } | null;
  site: DemoSite;
  /** The repository's GitHub Actions runs, newest first. */
  builds: DemoBuild[];
  /** What `bohr deploy` published in the owner's account, newest first (projects in their owner's account). */
  cliDeploys?: CliDeploy[];
}

/** The user's agent settings, with the key the instance would keep sealed. */
export type DemoAgentSettings = Required<Omit<AgentSettingsInput, 'apiKey'>> & { apiKey: string };

export interface DemoWorld {
  signedIn: boolean;
  billing: Billing;
  /** The instance's users; Ana's identities (sign-in methods and Telegram) are hers. */
  users: DemoUser[];
  /** GitHub accounts where Ana installed the bohr GitHub App. */
  /** GitHub App installations: GitHub's installation ids are numbers. */
  installations: { id: number; account: string }[];
  /** Codes sent by email, by address. */
  emailCodes: Record<string, { attempts: number; redirect: string; sends: number }>;
  telemetry: { enabled: boolean; lastSentAt: string | null };
  connections: CloudflareConnection[];
  /** resumeStep: where the wizard goes back to after choosing a Cloudflare account. */
  onboarding: { step: OnboardingStep; resumeStep?: OnboardingStep };
  /** null: the agent is not set up, so it is off in every project. */
  agent: DemoAgentSettings | null;
  projects: DemoProject[];
  nextProject: number;
  orgs: DemoOrg[];
}

function agentState(
  project: ProjectState['project'],
  overrides: Partial<Omit<ProjectState, 'project'>> = {},
): ProjectState {
  return {
    project,
    you: { key: ANA.key, role: 'owner' },
    homolog: { status: 'clean', version: 0, headSha: null, changes: [] },
    current: null,
    queue: [],
    releases: [],
    settings: { model: 'claude-opus-5-5', maxBudgetUsd: 5, maxTurns: 200, locale: 'pt-BR' },
    ...overrides,
  };
}

/** A project's conversation right after it is created. */
export function freshAgent(id: string, name: string, repository: string, productionUrl: string | null): DemoAgent {
  const members: MemberView[] = [{ key: ANA.key, name: ANA.name, role: 'owner', joinedAt: ago(0) }];
  const agent = new DemoAgent(
    agentState({
      id,
      name,
      repository,
      productionBranch: 'main',
      productionUrl,
      previewUrl: null,
      agentEnabled: true,
    }),
    members,
    ANA,
  );
  agent.add({ at: ago(0), kind: 'system', requestId: null, author: null, text: `Projeto ${name} criado.` });
  return agent;
}

/** A project where Ana is a member (of its organization), not the owner. */
function memberAgent(agent: DemoAgent): DemoAgent {
  agent.state.you = { key: ANA.key, role: 'member' };
  agent.members = [
    { key: 'gh:diegorocha', name: 'Diego Rocha', role: 'owner', joinedAt: ago(20 * DAY) },
    { key: ANA.key, name: ANA.name, role: 'member', joinedAt: ago(19 * DAY) },
  ];
  return agent;
}

function lojaAurora(): DemoAgent {
  const members: MemberView[] = [
    { key: ANA.key, name: ANA.name, role: 'owner', joinedAt: ago(21 * DAY) },
    { key: BRUNO.key, name: BRUNO.name, role: 'member', joinedAt: ago(9 * DAY) },
  ];
  const agent = new DemoAgent(
    agentState(
      {
        id: 'p1',
        name: 'Loja Aurora',
        repository: 'anasouza/loja-aurora',
        productionBranch: 'main',
        productionUrl: LOJA_AURORA_URL,
        previewUrl: null,
        agentEnabled: true,
      },
      {
        homolog: {
          status: 'pending',
          version: 3,
          headSha: '4c1d9e7a2b8f6035c1e9d7a4b2f80e6c3d5a1b97',
          changes: [
            { requestId: 'r1', summary: 'Banner de frete grátis acima de R$ 199 no topo da página inicial' },
            { requestId: 'r2', summary: 'Botão do WhatsApp nas páginas de produto' },
          ],
        },
        releases: [
          {
            id: 'rel_4',
            status: 'deploying',
            pullRequest: 41,
            commitSha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
            createdAt: ago(4 * MINUTE),
            summary: 'Rodapé novo com os links das redes sociais',
          },
          {
            id: 'rel_3',
            status: 'live',
            pullRequest: 38,
            commitSha: '1a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5',
            createdAt: ago(2 * DAY),
            summary: 'Página de trocas e devoluções',
          },
          {
            id: 'rel_2',
            status: 'failed',
            pullRequest: 35,
            commitSha: 'b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80',
            createdAt: ago(5 * DAY),
            summary: 'Carrossel de produtos em destaque',
          },
          {
            id: 'rel_1',
            status: 'live',
            pullRequest: 31,
            commitSha: 'e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c',
            createdAt: ago(12 * DAY),
            summary: 'Formulário de newsletter na página inicial',
          },
        ],
      },
    ),
    members,
    ANA,
    { nextPullRequest: 42 },
  );

  agent.add({
    at: ago(21 * DAY),
    kind: 'system',
    requestId: null,
    author: null,
    text: 'Projeto Loja Aurora criado. O agente já conhece o repositório anasouza/loja-aurora.',
  });
  agent.add({
    at: ago(3 * HOUR),
    kind: 'user',
    requestId: 'r1',
    author: ANA,
    text: 'Coloque um banner de frete grátis para compras acima de R$ 199 no topo da página inicial.',
  });
  agent.add({
    at: ago(3 * HOUR - MINUTE),
    kind: 'progress',
    requestId: 'r1',
    author: null,
    text: 'Lendo src/pages/Home.vue',
  });
  agent.add({
    at: ago(3 * HOUR - 4 * MINUTE),
    kind: 'agent',
    requestId: 'r1',
    author: null,
    text: 'Pronto! O banner aparece no topo da página inicial, com o texto “Frete grátis acima de R$ 199” nas cores da marca. Está na homologação (versão 1).',
  });
  agent.add({
    at: ago(2 * HOUR),
    kind: 'user',
    requestId: 'r2',
    author: BRUNO,
    text: 'Adiciona o botão do WhatsApp nas páginas de produto, com a mensagem já preenchida com o nome do produto.',
  });
  agent.add({
    at: ago(2 * HOUR - 6 * MINUTE),
    kind: 'agent',
    requestId: 'r2',
    author: null,
    text: 'Pronto! Cada página de produto tem um botão do WhatsApp que abre a conversa com “Olá! Tenho interesse no produto …”. A homologação está na versão 3, com o banner e o botão. Posso publicar?',
    actions: ['approve', 'discard'],
  });
  agent.add({
    at: ago(40 * MINUTE),
    kind: 'user',
    requestId: 'r3',
    author: ANA,
    text: 'Mude a cor do botão Comprar para o verde da marca.',
  });
  agent.add({
    at: ago(25 * MINUTE),
    kind: 'user',
    requestId: 'r4',
    author: BRUNO,
    text: 'Coloca um filtro por tamanho na página de vestidos.',
  });
  agent.add({
    at: ago(12 * MINUTE),
    kind: 'user',
    requestId: 'r5',
    author: ANA,
    text: 'Troque a foto de capa da coleção de verão pela nova que está em public/img/verao-2027.jpg.',
  });
  agent.add({
    at: ago(9 * MINUTE),
    kind: 'agent',
    requestId: 'r3',
    author: null,
    text: 'Encontrei dois verdes na identidade visual da loja. Qual deles devo usar no botão Comprar?',
    actions: ['answer'],
    options: ['Verde-folha (#2E7D32)', 'Verde-água (#00897B)'],
  });
  agent.add({ at: ago(MINUTE), kind: 'progress', requestId: 'r4', author: null, text: 'Lendo src/pages/Vestidos.vue' });

  const r4 = agent.request('r4', 'Coloca um filtro por tamanho na página de vestidos.', BRUNO, {
    status: 'running',
    source: 'telegram',
    createdAt: ago(25 * MINUTE),
    startedAt: ago(9 * MINUTE),
    progress: 'Lendo src/pages/Vestidos.vue',
  });
  const r5 = agent.request(
    'r5',
    'Troque a foto de capa da coleção de verão pela nova que está em public/img/verao-2027.jpg.',
    ANA,
    { createdAt: ago(12 * MINUTE) },
  );
  agent.state.current = r4;
  agent.state.queue.push(r5);
  agent.script('r4', {
    progress: [
      'Lendo src/pages/Vestidos.vue',
      'Criando o componente FiltroTamanho.vue',
      'Testando o filtro no celular',
    ],
    done: 'Pronto! A página de vestidos tem um filtro por tamanho (PP a GG) que funciona também no celular.',
    summary: 'Filtro por tamanho na página de vestidos',
    stepMs: 5_000,
  });
  agent.script('r5', {
    progress: ['Otimizando public/img/verao-2027.jpg', 'Atualizando a capa da coleção de verão'],
    done: 'Pronto! A coleção de verão tem a capa nova, otimizada para carregar rápido.',
    summary: 'Capa nova da coleção de verão',
    stepMs: 2_500,
  });
  return agent;
}

export const PORTFOLIO_HOSTNAMES = {
  partial: [
    { hostname: 'anasouza.com.br', status: 'pending' },
    { hostname: 'portfolio-ana.bohr.io', status: 'redirected' },
  ],
  done: [
    { hostname: 'anasouza.com.br', status: 'moved' },
    { hostname: 'portfolio-ana.bohr.io', status: 'redirected' },
    { hostname: 'novo-layout.portfolio-ana.bohr.io', status: 'dropped' },
  ],
} satisfies Record<string, MovedHostname[]>;

export function createWorld(): DemoWorld {
  return {
    signedIn: true,
    billing: {
      subscription: {
        status: 'active',
        legacy: false,
        currentPeriodEnd: new Date(Date.now() + 18 * DAY).toISOString(),
        priceId: 'price_demo_cloud',
      },
    },
    users: demoUsers(),
    installations: [
      { id: 41001, account: 'anasouza' },
      { id: 41002, account: 'aurora-comercio' },
    ],
    emailCodes: {},
    telemetry: { enabled: false, lastSentAt: null },
    connections: [
      { id: 'cf_1', accountId: '7c3f0a9e5b2d4c18a6e9f1b03d7c2e54', accountName: 'Ana Souza' },
      { id: 'cf_2', accountId: 'b2e81d0c4a6f49e3b7d5c9a1f0e2d3c4', accountName: 'Aurora Comércio' },
    ],
    onboarding: { step: 'done' },
    agent: {
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-demo-demo-demo-demo-demo-7f3a',
      baseUrl: null,
      model: null,
      effort: null,
    },
    nextProject: 4,
    orgs: demoOrgs(),
    projects: [
      {
        ownerId: ANA_ID,
        createdAt: ago(21 * DAY),
        summary: {
          id: 'p1',
          name: 'Loja Aurora',
          repository: 'anasouza/loja-aurora',
          status: 'active',
          mode: 'byo',
          role: 'owner',
          productionUrl: LOJA_AURORA_URL,
        },
        runtime: { status: 'ready', error: null, botUsername: 'loja_aurora_bot', version: '0.9.2', readyAt: 0 },
        agent: lojaAurora(),
        move: null,
        builds: DEMO_BUILDS.loja(),
        cliDeploys: [
          cliDeploy(
            'feature/frete-gratis',
            false,
            'https://feature-frete-gratis-loja-aurora.anasouza.workers.dev',
            40 * MINUTE,
          ),
          cliDeploy('main', true, LOJA_AURORA_URL, 2 * DAY),
          cliDeploy('novo-checkout', false, 'https://novo-checkout-loja-aurora.anasouza.workers.dev', 3 * DAY, false),
        ],
        site: demoSite({
          worker: 'loja-aurora',
          variables: [
            variable('NODE_VERSION', 'build', '22', 20),
            variable('NPM_TOKEN', 'build', null, 20),
            variable('PUBLIC_STORE_NAME', 'build', 'Loja Aurora', 6),
            variable('API_URL', 'runtime', 'https://api.lojaaurora.com.br', 14),
            variable('FRETE_GRATIS_MINIMO', 'runtime', '199', 3),
            variable('MERCADO_PAGO_TOKEN', 'runtime', null, 14),
            variable('RESEND_API_KEY', 'runtime', null, 9),
          ],
          domains: [
            { id: 'dom_1', hostname: 'lojaaurora.com.br', status: 'live' },
            { id: 'dom_2', hostname: 'www.lojaaurora.com.br', status: 'live' },
          ],
        }),
      },
      {
        ownerId: ANA_ID,
        createdAt: ago(300 * DAY),
        summary: {
          id: 'p2',
          name: 'Portfólio Ana',
          repository: 'anasouza/portfolio',
          status: 'active',
          mode: 'managed',
          role: 'owner',
          productionUrl: PORTFOLIO_URL,
        },
        runtime: null,
        agent: null,
        move: { view: { status: 'available' }, completions: 0 },
        builds: DEMO_BUILDS.portfolio(),
        site: demoSite({
          variables: [
            variable('CONTACT_EMAIL', 'runtime', 'contato@anasouza.com.br', 300),
            variable('FORM_SECRET', 'runtime', null, 300),
            variable('HUGO_VERSION', 'build', '0.139.0', 300),
          ],
          protection: {
            type: 'basic',
            users: [{ username: 'cliente', password: 'demo' }],
            bypassPaths: ['/contato'],
            warning: null,
          },
          domains: [
            { id: 'anasouza.com.br', hostname: 'anasouza.com.br', status: 'live' },
            { id: 'portfolio-ana.bohr.io', hostname: 'portfolio-ana.bohr.io', status: 'live' },
          ],
          zones: [{ name: 'anasouza.com.br', status: 'active' }],
        }),
      },
      {
        ownerId: ANA_ID,
        createdAt: ago(1 * DAY),
        summary: {
          id: 'p3',
          name: 'Blog da Aurora',
          repository: 'anasouza/blog-aurora',
          status: 'active',
          mode: 'byo',
          role: 'owner',
          productionUrl: null,
        },
        // Still being set up, for as long as the demo runs.
        runtime: {
          status: 'provisioning',
          error: null,
          botUsername: null,
          version: null,
          readyAt: Number.POSITIVE_INFINITY,
        },
        agent: null,
        move: null,
        builds: [],
        site: demoSite({ variables: [variable('ASTRO_TELEMETRY_DISABLED', 'build', '1', 1)] }),
      },
      // Projects of organizations: Ana is an admin of Aurora Comércio and a member of Estúdio Norte.
      {
        ownerId: 'u_diego',
        orgSlug: 'aurora-comercio',
        createdAt: ago(60 * DAY),
        summary: {
          id: 'p10',
          name: 'Site institucional',
          repository: 'aurora-comercio/site-institucional',
          status: 'active',
          mode: 'byo',
          role: 'owner',
          productionUrl: 'https://auroracomercio.com.br',
        },
        runtime: { status: 'ready', error: null, botUsername: 'aurora_site_bot', version: '0.9.2', readyAt: 0 },
        agent: freshAgent(
          'p10',
          'Site institucional',
          'aurora-comercio/site-institucional',
          'https://auroracomercio.com.br',
        ),
        move: null,
        builds: [],
        site: demoSite({ worker: 'site-institucional', zones: [{ name: 'auroracomercio.com.br', status: 'active' }] }),
      },
      {
        ownerId: 'u_diego',
        orgSlug: 'estudio-norte',
        createdAt: ago(20 * DAY),
        summary: {
          id: 'p11',
          name: 'Portal Norte',
          repository: 'EstudioNorte/portal',
          status: 'active',
          mode: 'byo',
          role: 'member',
          productionUrl: 'https://estudionorte.art.br',
        },
        runtime: { status: 'ready', error: null, botUsername: null, version: '0.9.2', readyAt: 0 },
        agent: memberAgent(freshAgent('p11', 'Portal Norte', 'EstudioNorte/portal', 'https://estudionorte.art.br')),
        move: null,
        builds: [],
        site: demoSite({ worker: 'portal-norte' }),
      },
      // Other users' projects, for the admin area (and the admin banner on their pages).
      {
        ownerId: 'u_bruno',
        createdAt: ago(40 * DAY),
        summary: {
          id: 'p100',
          name: 'Site do Bruno',
          repository: 'brunolima/site',
          status: 'active',
          mode: 'byo',
          role: 'owner',
          productionUrl: 'https://brunolima.dev',
        },
        runtime: { status: 'ready', error: null, botUsername: null, version: '0.9.1', readyAt: 0 },
        agent: freshAgent('p100', 'Site do Bruno', 'brunolima/site', 'https://brunolima.dev'),
        move: null,
        builds: [],
        site: demoSite({ worker: 'site-bruno' }),
      },
      {
        ownerId: 'u_carla',
        createdAt: ago(10 * DAY),
        summary: {
          id: 'p101',
          name: 'Cardápio Café Lume',
          repository: 'cafelume/cardapio',
          status: 'suspended',
          mode: 'byo',
          role: 'owner',
          productionUrl: null,
        },
        runtime: {
          status: 'error',
          error: 'The container did not start: the Workers plan of this Cloudflare account has no Containers.',
          botUsername: null,
          version: '0.9.0',
          readyAt: 0,
        },
        agent: null,
        move: null,
        builds: [],
        site: demoSite(),
      },
    ],
  };
}
