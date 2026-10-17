<template>
  <ul class="projects" role="list" :aria-busy="projects === null">
    <template v-if="projects === null">
      <li v-for="index in 3" :key="`skeleton-${index}`" class="projects__item">
        <BohrSkeleton class="projects__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </li>
    </template>
    <template v-else>
      <li v-for="project in projects" :key="project.id" class="projects__item">
        <ProjectCard :project="project" />
      </li>
    </template>
    <li v-if="newTo !== null" class="projects__item">
      <NewSiteLink :as="AppLink" :href="router.resolve(newTo).href" with-text :label="t('projects.new')" class="projects__new" />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { BohrSkeleton, NewSiteLink } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { type RouteLocationRaw, useRouter } from 'vue-router';
import type { ProjectSummary } from '../../api';
import AppLink from '../AppLink.vue';
import ProjectCard from './ProjectCard.vue';

// The project cards of the personal account or of an organization, and the way to a new one.
defineProps<{
  /** null while loading. */
  projects: ProjectSummary[] | null;
  /** The new project page; null hides the link. */
  newTo: RouteLocationRaw | null;
}>();

const { t } = useI18n();
// NewSiteLink gives its root an href, so an anchor that navigates inside the app (RouterLink would lose its href).
const router = useRouter();
</script>

<style scoped>
.projects {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 28px;
}

.projects__item {
  min-width: 0;
}

.projects__skeleton {
  width: 100%;
  height: 190px;
}

.projects .projects__new {
  height: 100%;
  min-height: 190px;
  aspect-ratio: auto;
}
</style>
