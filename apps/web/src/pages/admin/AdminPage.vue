<template>
  <div class="page admin">
    <BohrPageTitle :title="t('admin.title')" />
    <p class="page-lead">{{ t('admin.lead') }}</p>

    <div class="admin__grid">
      <ProjectNav class="admin__nav" :label="t('admin.nav.label')" :links="links" />
      <div class="admin__main">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <component :is="Component" v-if="Component" :key="viewRoute.path" />
        </RouterView>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrPageTitle } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute } from 'vue-router';
import { api } from '../../api';
import ProjectNav, { type NavLink } from '../../components/project/ProjectNav.vue';

// The instance's admin area (admins only, see the router's guard): a menu and the current sub-page.
const { t } = useI18n();
const route = useRoute();

/** Telemetry exists only on self-hosted instances (not on bohr.io Cloud). */
const telemetry = ref(false);

onMounted(async () => {
  try {
    telemetry.value = (await api.telemetry()).available;
  } catch {
    telemetry.value = false;
  }
});

function link(name: string, label: string, current = route.name === name): NavLink {
  return { to: { name }, label, current };
}

const links = computed<NavLink[]>(() => [
  link('admin', t('admin.nav.overview')),
  link('admin-users', t('admin.nav.users'), route.name === 'admin-users' || route.name === 'admin-user'),
  link('admin-projects', t('admin.nav.projects')),
  link('admin-orgs', t('admin.nav.orgs')),
  ...(telemetry.value ? [link('admin-telemetry', t('admin.nav.telemetry'))] : []),
]);
</script>

<style scoped>
.admin {
  max-width: calc(1152px + 2 * var(--gutter));
}

.admin__grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  margin-top: 36px;
}

.admin__main {
  min-width: 0;
}

@media (max-width: 1023px) {
  .admin__grid {
    display: block;
  }

  .admin__main {
    margin-top: 24px;
  }
}
</style>
