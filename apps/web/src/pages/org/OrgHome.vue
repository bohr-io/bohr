<template>
  <div class="org-home">
    <OrgSetup v-if="isAdmin" />
    <p v-else-if="!ready" class="notice notice--warn org-home__notice" role="status" data-notice="not-ready">
      {{ t('orgs.notReady') }}
    </p>

    <section aria-labelledby="org-projects-title">
      <h2 id="org-projects-title" class="org-home__title">{{ t('orgs.projectsTitle') }}</h2>

      <ErrorState v-if="error !== null" class="org-home__body" :message="errorText(error)" @retry="load" />

      <SettingsCard v-else-if="projects !== null && projects.length === 0" class="org-home__body org-home__empty" data-empty>
        <p class="card-text">{{ ready ? t('orgs.emptyText') : t('orgs.emptyNotReady') }}</p>
        <div v-if="ready" class="actions org-home__actions">
          <BohrButton :as="RouterLink" :to="newProject">{{ t('projects.new') }}</BohrButton>
        </div>
      </SettingsCard>

      <ProjectsView
        v-else
        class="org-home__body"
        :projects="projects"
        :new-to="ready ? newProject : null"
        :caption="t('projects.list.captionOrg', { org: detail?.org.name ?? slug })"
        @deleted="onDeleted"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, SettingsCard } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api, type ProjectSummary } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import OrgSetup from '../../components/org/OrgSetup.vue';
import ProjectsView from '../../components/project/ProjectsView.vue';
import { useErrorText } from '../../composables/useErrorText';
import { useOrg } from '../../composables/useOrg';
import { orgReady } from '../../lib/org';

// The organization's home: its projects, with its setup above them for admins until it is done.
const { t } = useI18n();
const errorText = useErrorText();
const { slug, detail, isAdmin } = useOrg();

const projects = ref<ProjectSummary[] | null>(null);
const error = ref<unknown>(null);

/** Projects need the subscription (bohr.io Cloud), the Cloudflare account and the GitHub App. */
const ready = computed(() => detail.value !== null && orgReady(detail.value));
const newProject = computed(() => ({ name: 'new-project', query: { org: slug } }));

async function load() {
  error.value = null;
  try {
    const { projects: list } = await api.projects(slug);
    projects.value = [...list].sort((a, b) => a.name.localeCompare(b.name));
  } catch (caught) {
    error.value = caught;
  }
}

/** Deleted from the list view: gone from the page at once. */
function onDeleted(projectIds: string[]) {
  projects.value = (projects.value ?? []).filter((project) => !projectIds.includes(project.id));
}

onMounted(load);
</script>

<style scoped>
.org-home__notice {
  margin-bottom: 32px;
}

.org-home__title {
  font-size: 22px;
}

.org-home__body {
  margin-top: 20px;
}

.org-home__empty {
  max-width: 760px;
}

.org-home__actions {
  margin-top: 20px;
}
</style>
