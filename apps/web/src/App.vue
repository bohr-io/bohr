<template>
  <div class="app bohr-spotlight" :class="{ 'app--with-bar': withBar }">
    <a class="skip-link" href="#main">{{ t('common.skipToContent') }}</a>
    <BohrMainBar
      v-if="withBar"
      v-model:open="menuOpen"
      :logo-as="RouterLink"
      logo-to="/"
      :logo-label="t('nav.home')"
      :label="t('nav.sidebar')"
      :nav-label="t('nav.main')"
      :open-label="t('nav.open')"
      :close-label="t('nav.close')"
    >
      <ContextSwitcher />
      <!-- New projects start from the Projects page (its "New project" button) -->
      <BohrMainBarLink
        :as="AppLink"
        :href="projectsHref"
        :label="t('nav.projects')"
        :active="section === 'projects' || section === 'start'"
      >
        <GridIcon :size="24" />
      </BohrMainBarLink>
      <!-- An organization's scope: its members and (for its admins) its settings: billing, Cloudflare, agent. -->
      <template v-if="currentOrg !== null">
        <BohrMainBarLink :as="AppLink" :href="orgHref('membros')" :label="t('nav.members')" :active="section === 'members'">
          <UsersIcon :size="24" />
        </BohrMainBarLink>
        <BohrMainBarLink
          v-if="currentOrg.role === 'admin'"
          :as="AppLink"
          :href="orgHref('configuracoes')"
          :label="t('nav.orgSettings')"
          :caption="t('nav.orgSettingsShort')"
          :active="section === 'settings'"
        >
          <SlidersIcon :size="24" />
        </BohrMainBarLink>
      </template>
      <!-- Domains whose DNS bohr hosts: only people who have one see it -->
      <BohrMainBarLink
        v-if="hasDnsZones"
        :as="AppLink"
        href="/domains"
        :label="t('nav.domains')"
        :active="section === 'domains'"
      >
        <GlobeIcon :size="24" />
      </BohrMainBarLink>
      <BohrMainBarLink :as="AppLink" href="/account" :label="t('nav.account')" :active="section === 'account'">
        <UserIcon :size="24" />
      </BohrMainBarLink>
      <BohrMainBarLink
        v-if="admin"
        :as="AppLink"
        href="/admin"
        :label="t('nav.admin')"
        :caption="t('nav.adminShort')"
        :active="section === 'admin'"
      >
        <ShieldIcon :size="24" />
      </BohrMainBarLink>
    </BohrMainBar>
    <main id="main" ref="main" class="app__main" tabindex="-1">
      <RouterView v-slot="{ Component, route: viewRoute }">
        <component :is="Component" v-if="Component" :key="pageKey(viewRoute)" />
      </RouterView>
    </main>
    <ToastDisplay :labels="toastLabels" :dismiss-label="t('toast.dismiss')" :region-label="t('toast.region')" />
  </div>
</template>

<script setup lang="ts">
import { BohrMainBar, BohrMainBarLink, ToastDisplay } from '@bohr/ui';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { type RouteLocationNormalizedLoaded, RouterLink, useRoute } from 'vue-router';
import AppLink from './components/AppLink.vue';
import { GlobeIcon, GridIcon, ShieldIcon, SlidersIcon, UserIcon, UsersIcon } from './components/icons';
import ContextSwitcher from './components/org/ContextSwitcher.vue';
import { urlContext, useCurrentOrg } from './composables/useCurrentOrg';
import { useDocumentTitle } from './composables/usePageTitle';
import { dnsZones, loadDnsZones } from './dns-zones';
import { orgs, setContext } from './orgs';
import { isAdmin, session } from './session';

const { t } = useI18n();
const route = useRoute();
const main = useTemplateRef<HTMLElement>('main');
const menuOpen = ref(false);

useDocumentTitle();

/** A new page for every path, except inside a page with sub-pages (a project, an organization), which stays mounted. */
function pageKey(viewRoute: RouteLocationNormalizedLoaded): string {
  const top = viewRoute.matched[0];
  return top !== undefined && top.children.length > 0
    ? `${top.path}|${String(viewRoute.params.id ?? viewRoute.params.slug ?? '')}`
    : viewRoute.path;
}

// The main bar follows the scope (the personal account or an organization): the scope's projects and new
// project, and an organization's members and settings.
const currentOrg = useCurrentOrg();
const orgHref = (page = '') =>
  currentOrg.value === null
    ? '/projects'
    : `/orgs/${encodeURIComponent(currentOrg.value.slug)}${page ? `/${page}` : ''}`;
const projectsHref = computed(() => orgHref());

// The scope a URL sets (an organization's pages, the personal projects) is remembered, so a reload, the logo and
// the pages without a scope of their own (the account, a project) keep it.
watch(
  () => urlContext(route),
  (scope) => {
    if (scope !== undefined && scope !== orgs.context) setContext(scope);
  },
  { immediate: true },
);

const withBar = computed(() => !route.meta.bare && session.status === 'signed-in');
const hasDnsZones = computed(() => (dnsZones.list?.length ?? 0) > 0);
watch(
  () => session.status,
  (status) => {
    if (status === 'signed-in') void loadDnsZones();
  },
  { immediate: true },
);
const section = computed(() => route.meta.section);
const admin = computed(() => isAdmin(session.me));
const toastLabels = computed(() => ({
  success: t('toast.success'),
  warn: t('toast.warn'),
  error: t('toast.error'),
  tip: t('toast.tip'),
}));

// A new page: close the off-canvas menu and move focus to the content, so screen readers start there.
watch(
  () => route.path,
  async (path, previous) => {
    menuOpen.value = false;
    if (previous === undefined || path === previous) return;
    await nextTick();
    main.value?.focus({ preventScroll: true });
  },
);
</script>

<style scoped>
.app {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  /* Decorative overflow (giant titles, glows) never causes horizontal scrolling. */
  overflow-x: clip;
}

.app__main {
  flex: 1;
  min-width: 0;
}

.app__main:focus {
  outline: none;
}

@media (min-width: 1280px) {
  .app--with-bar {
    --bohr-toast-offset-left: var(--bohr-sidebar-width);
  }
}

/* The main bar is off-canvas below 1280px, with its menu button in the top-left corner. */
@media (max-width: 1279px) {
  .app--with-bar .app__main {
    padding-top: 40px;
  }
}
</style>
