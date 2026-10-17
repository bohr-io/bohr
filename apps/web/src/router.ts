import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
  type RouterScrollBehavior,
} from 'vue-router';
import { contextOrg } from './orgs';
import { isAdmin, loadSession } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without signing in. */
    public?: boolean;
    /** Full-screen page without the main bar. */
    bare?: boolean;
    /** i18n key of the document title. */
    title?: string;
    /** Main bar entry to highlight (members and settings: an organization's). */
    section?: 'projects' | 'start' | 'account' | 'admin' | 'members' | 'settings' | 'domains';
    /** Instance admins only; everyone else goes to the projects. */
    admin?: boolean;
    /** i18n key of a project sub-page's name, shown as its title. */
    projectPage?: string;
    /** A page of the project's settings, which have their own menu. */
    projectSettings?: boolean;
    /** i18n key of an organization sub-page's name. */
    orgPage?: string;
    /** A full-screen view over its page: going in and out keeps the page where it was scrolled to. */
    keepScroll?: boolean;
  }
}

/** The project page's old tabs (?tab=) and where they live now. */
const OLD_TABS: Record<string, string> = {
  preview: 'project-preview',
  versions: 'project-versions',
  members: 'project-members',
  settings: 'project-settings-agent',
};

function oldTab(to: RouteLocationNormalized) {
  const tab = typeof to.query.tab === 'string' ? OLD_TABS[to.query.tab] : undefined;
  if (tab === undefined) return true;
  const { tab: _tab, ...query } = to.query;
  return { name: tab, params: to.params, query, replace: true };
}

/**
 * The start (the logo, the sign-in's default): the projects of the scope chosen last in this browser, an
 * organization's or the personal ones.
 */
export async function homeScope() {
  const org = await contextOrg();
  return org === null
    ? { name: 'projects', replace: true }
    : { name: 'org', params: { slug: org.slug }, replace: true };
}

/** The project overview, also the full-screen view of its site (the same page, so the preview stays loaded). */
const projectOverview = () => import('./pages/project/ProjectOverview.vue');

// None of these paths may start with the ones the instance Worker answers itself (build-config.ts).
export const routes: RouteRecordRaw[] = [
  // Never shown: homeScope always redirects.
  { path: '/', name: 'home', component: () => import('./pages/NotFoundPage.vue'), beforeEnter: homeScope },
  {
    path: '/login',
    name: 'login',
    component: () => import('./pages/LoginPage.vue'),
    meta: { public: true, bare: true, title: 'login.title' },
  },
  {
    path: '/start',
    name: 'start',
    component: () => import('./pages/StartPage.vue'),
    meta: { title: 'wizard.title', section: 'start' },
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('./pages/ProjectsPage.vue'),
    meta: { title: 'projects.title', section: 'projects' },
  },
  {
    // After the onboarding: a repository becomes a project.
    path: '/projects/new',
    name: 'new-project',
    component: () => import('./pages/NewProjectPage.vue'),
    meta: { title: 'newProject.title', section: 'start' },
  },
  {
    // Laid out like bohr v1: a header, a menu of sub-pages and the current one.
    path: '/projects/:id',
    component: () => import('./pages/ProjectPage.vue'),
    props: true,
    meta: { title: 'project.title', section: 'projects' },
    children: [
      {
        path: '',
        name: 'project',
        component: projectOverview,
        meta: { projectPage: 'project.nav.overview' },
        beforeEnter: oldTab,
      },
      {
        // The overview's preview in full screen, like bohr v1's preview route (?deploy=preview, ?chat=1).
        path: 'site',
        name: 'project-site',
        component: projectOverview,
        meta: { projectPage: 'project.nav.overview', keepScroll: true },
      },
      {
        path: 'agente',
        name: 'project-agent',
        component: () => import('./pages/project/ProjectAgent.vue'),
        meta: { projectPage: 'project.nav.agent' },
      },
      {
        // The preview's old sub-page: the overview's full-screen view shows it now (links to it keep working).
        path: 'homologacao',
        name: 'project-preview',
        redirect: (to) => ({ name: 'project-site', params: to.params, query: { ...to.query, deploy: 'preview' } }),
      },
      {
        path: 'versoes',
        name: 'project-versions',
        component: () => import('./pages/project/ProjectVersions.vue'),
        meta: { projectPage: 'project.nav.versions' },
      },
      {
        path: 'builds',
        name: 'project-builds',
        component: () => import('./pages/project/ProjectBuilds.vue'),
        meta: { projectPage: 'project.nav.builds' },
      },
      {
        path: 'membros',
        name: 'project-members',
        component: () => import('./pages/project/ProjectMembers.vue'),
        meta: { projectPage: 'project.nav.members' },
      },
      {
        path: 'configuracoes',
        meta: { projectPage: 'project.nav.settings', projectSettings: true },
        children: [
          { path: '', redirect: (to) => ({ name: 'project-settings-general', params: to.params }) },
          {
            path: 'geral',
            name: 'project-settings-general',
            component: () => import('./pages/project/SettingsGeneral.vue'),
          },
          {
            path: 'dominios',
            name: 'project-settings-domains',
            component: () => import('./pages/project/SettingsDomains.vue'),
          },
          {
            path: 'variaveis',
            name: 'project-settings-variables',
            component: () => import('./pages/project/SettingsVariables.vue'),
          },
          {
            path: 'autenticacao',
            name: 'project-settings-auth',
            component: () => import('./pages/project/SettingsAuth.vue'),
          },
          {
            path: 'agente',
            name: 'project-settings-agent',
            component: () => import('./pages/project/SettingsAgent.vue'),
          },
          {
            path: 'hospedagem',
            name: 'project-settings-hosting',
            component: () => import('./pages/project/SettingsHosting.vue'),
          },
        ],
      },
    ],
  },
  {
    // A new organization: the GitHub App installed on a GitHub organization.
    path: '/orgs/new',
    name: 'org-new',
    component: () => import('./pages/OrgNewPage.vue'),
    meta: { title: 'orgs.new.title', section: 'projects' },
  },
  {
    // An organization: its projects (with the setup for admins), members and settings, which the main bar
    // lists while the organization is the scope.
    path: '/orgs/:slug',
    component: () => import('./pages/OrgPage.vue'),
    props: true,
    meta: { title: 'orgs.title', section: 'projects' },
    children: [
      {
        path: '',
        name: 'org',
        component: () => import('./pages/org/OrgHome.vue'),
        meta: { orgPage: 'orgs.nav.projects' },
      },
      {
        path: 'membros',
        name: 'org-members',
        component: () => import('./pages/org/OrgMembers.vue'),
        meta: { orgPage: 'orgs.nav.members', section: 'members' },
      },
      {
        path: 'configuracoes',
        name: 'org-settings',
        component: () => import('./pages/org/OrgSettings.vue'),
        meta: { orgPage: 'orgs.nav.settings', section: 'settings' },
      },
    ],
  },
  {
    // Domains whose DNS bohr hosts (bohr v1 kept its customers' zones in bohr's Cloudflare account).
    path: '/domains',
    name: 'domains',
    component: () => import('./pages/DomainsPage.vue'),
    meta: { title: 'dns.title', section: 'domains' },
  },
  {
    path: '/domains/:name',
    name: 'domain',
    component: () => import('./pages/DnsZonePage.vue'),
    props: true,
    meta: { title: 'dns.zone.title', section: 'domains' },
  },
  {
    // Stripe brings people back here from checkout and from its customer portal (bohr.io Cloud).
    path: '/billing',
    name: 'billing',
    component: () => import('./pages/BillingPage.vue'),
    meta: { title: 'billing.title', section: 'account' },
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('./pages/AccountPage.vue'),
    meta: { title: 'account.title', section: 'account' },
  },
  {
    // The agent's provider, model and effort, for every project the user owns.
    path: '/account/agente',
    name: 'account-agent',
    component: () => import('./pages/AccountAgentPage.vue'),
    meta: { title: 'agentSettings.title', section: 'account' },
  },
  {
    // API tokens for scripts and AI agents (BOHR_TOKEN), and the ones `bohr login` created.
    path: '/account/tokens',
    name: 'account-tokens',
    component: () => import('./pages/AccountTokensPage.vue'),
    meta: { title: 'tokens.title', section: 'account' },
  },
  {
    // `bohr login` sends people here (?code=) to approve the sign-in of the CLI on their computer.
    path: '/cli',
    name: 'cli-login',
    component: () => import('./pages/CliLoginPage.vue'),
    meta: { title: 'cliLogin.title', section: 'account' },
  },
  {
    // The instance's admin area: a menu of sub-pages, like a project.
    path: '/admin',
    component: () => import('./pages/admin/AdminPage.vue'),
    meta: { admin: true, title: 'admin.title', section: 'admin' },
    children: [
      {
        path: '',
        name: 'admin',
        component: () => import('./pages/admin/AdminOverview.vue'),
        meta: { title: 'admin.nav.overview' },
      },
      {
        path: 'usuarios',
        name: 'admin-users',
        component: () => import('./pages/admin/AdminUsers.vue'),
        meta: { title: 'admin.nav.users' },
      },
      {
        path: 'usuarios/:userId',
        name: 'admin-user',
        component: () => import('./pages/admin/AdminUser.vue'),
        props: true,
        meta: { title: 'admin.user.title' },
      },
      {
        path: 'projetos',
        name: 'admin-projects',
        component: () => import('./pages/admin/AdminProjects.vue'),
        meta: { title: 'admin.nav.projects' },
      },
      {
        path: 'orgs',
        name: 'admin-orgs',
        component: () => import('./pages/admin/AdminOrgs.vue'),
        meta: { title: 'admin.nav.orgs' },
      },
      {
        path: 'telemetria',
        name: 'admin-telemetry',
        component: () => import('./pages/admin/AdminTelemetry.vue'),
        meta: { title: 'admin.nav.telemetry' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./pages/NotFoundPage.vue'),
    meta: { public: true, title: 'notFound.title' },
  },
];

/** Signed-out visitors go to the sign-in page, which brings them back here afterwards. */
export async function authGuard(to: RouteLocationNormalized) {
  if (to.meta.public) return true;
  try {
    const me = await loadSession();
    if (me === null) return { name: 'login', query: { redirect: to.fullPath } };
    if (to.meta.admin && !isAdmin(me)) return { name: 'projects' };
  } catch {
    // The instance did not answer; the page shows the error of its own calls.
  }
  return true;
}

export const scrollBehavior: RouterScrollBehavior = (to, from, savedPosition) => {
  if (savedPosition) return savedPosition;
  // Changing only the query keeps the scroll position, and so does a full-screen view over the page.
  if (to.path === from.path || to.meta.keepScroll || from.meta.keepScroll) return false;
  return { top: 0 };
};

/**
 * A page's code that is gone from the server: a deploy replaced the app's files (their names carry a hash)
 * while this tab was open, and asking for an old one answers the app's HTML instead of a module.
 */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|not a valid JavaScript MIME type|Unable to preload CSS/i.test(
    message,
  );
}

const RELOAD_KEY = 'bohr.staleChunkReload';
const RELOAD_WINDOW_MS = 30_000;

/** Loads `path` from the server, once per path in a while, so a page that keeps failing is not reloaded forever. */
function reloadOnce(path: string): void {
  try {
    const last = JSON.parse(window.sessionStorage.getItem(RELOAD_KEY) ?? 'null') as { path: string; at: number } | null;
    if (last !== null && last.path === path && Date.now() - last.at < RELOAD_WINDOW_MS) return;
    window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // No session storage: reload anyway; the new files load the page.
  }
  window.location.assign(path);
}

/**
 * Without this, following a link to a page whose code went stale does nothing at all: the navigation fails
 * quietly and the old page stays. A full load of the destination gets the new files.
 */
export function reloadOnStaleChunks(router: Router, reload: (path: string) => void = reloadOnce): void {
  router.onError((error, to) => {
    if (isStaleChunkError(error)) reload(to.fullPath);
  });
}

export function createAppRouter(history: RouterHistory = createWebHistory('/')) {
  const router = createRouter({ history, routes, scrollBehavior });
  router.beforeEach(authGuard);
  reloadOnStaleChunks(router);
  return router;
}
