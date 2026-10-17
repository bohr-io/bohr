<template>
  <div class="page projects-page">
    <BohrPageTitle :title="t('projects.title')" />
    <p class="page-lead">{{ t('projects.lead') }}</p>

    <ErrorState v-if="error !== null" class="projects-page__error" :message="errorText(error)" @retry="load" />

    <SettingsCard v-else-if="!loading && projects.length === 0" class="projects-page__empty" data-empty>
      <h2 class="card-title">{{ t('projects.emptyTitle') }}</h2>
      <p class="card-text">{{ t('projects.emptyText') }}</p>
      <div class="actions projects-page__actions">
        <BohrButton :as="RouterLink" :to="{ name: onboardingDone ? 'new-project' : 'start' }">{{ t('projects.new') }}</BohrButton>
      </div>
      <!-- Members of organizations work on the organizations' projects, without setting up their own account. -->
      <div v-if="memberOf.length > 0" class="projects-page__orgs" data-orgs>
        <p class="card-text">{{ t('orgs.personalEmpty') }}</p>
        <ul class="projects-page__org-list" role="list">
          <li v-for="org in memberOf" :key="org.slug">
            <RouterLink :to="{ name: 'org', params: { slug: org.slug } }" class="projects-page__org" @click="setContext(org.slug)">
              <OrgAvatar :name="org.name" :url="org.avatarUrl" :size="28" />
              <span>{{ org.name }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </SettingsCard>

    <ProjectsView
      v-else
      class="projects-page__grid"
      :projects="loading ? null : projects"
      :new-to="{ name: 'new-project' }"
      :caption="t('projects.list.captionPersonal')"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, SettingsCard } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { api, type OrgSummary, type ProjectSummary } from '../api';
import ErrorState from '../components/ErrorState.vue';
import OrgAvatar from '../components/org/OrgAvatar.vue';
import ProjectsView from '../components/project/ProjectsView.vue';
import { useErrorText } from '../composables/useErrorText';
import { loadOrgs, setContext } from '../orgs';

// The personal scope's projects (not the organizations'; each organization lists its own at /orgs/:slug).
const { t } = useI18n();
const router = useRouter();
const errorText = useErrorText();

const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const error = ref<unknown>(null);
const onboardingDone = ref(true);
const memberOf = ref<OrgSummary[]>([]);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [{ projects: list }, orgList] = await Promise.all([api.personalProjects(), loadOrgs()]);
    if (list.length === 0) {
      onboardingDone.value = (await api.onboarding()).step === 'done';
      memberOf.value = orgList;
      // Nothing here yet: the onboarding comes first, unless the user works in organizations.
      if (!onboardingDone.value && orgList.length === 0) {
        await router.replace({ name: 'start' });
        return;
      }
    }
    projects.value = [...list].sort((a, b) => a.name.localeCompare(b.name));
  } catch (caught) {
    error.value = caught;
  } finally {
    loading.value = false;
  }
}

/** Deleted from the list view: gone from the page at once. */
function onDeleted(projectIds: string[]) {
  projects.value = projects.value.filter((project) => !projectIds.includes(project.id));
  if (projects.value.length === 0) void loadOrgs().then((list) => (memberOf.value = list));
}

onMounted(load);
</script>

<style scoped>
.projects-page__grid {
  margin-top: 40px;
}

.projects-page__error,
.projects-page__empty {
  margin-top: 32px;
}

.projects-page__empty {
  max-width: 760px;
}

.projects-page__actions {
  margin-top: 20px;
}

.projects-page__orgs {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.projects-page__org-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.projects-page__org {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  border: 1px solid hsl(0 0% 100% / 0.14);
  border-radius: var(--bohr-radius-full);
  font-weight: 700;
  color: #fff;
  transition: border-color var(--bohr-transition);
}

.projects-page__org:hover,
.projects-page__org:focus-visible {
  border-color: var(--bohr-color-frame);
}
</style>
