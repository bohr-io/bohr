<template>
  <div class="projects-view">
    <div v-if="projects !== null && projects.length > 0" class="projects-view__toolbar">
      <div class="projects-view__toggle" role="group" :aria-label="t('projects.view.label')" data-view-toggle>
        <button
          type="button"
          class="projects-view__mode"
          :aria-pressed="view === 'cards'"
          data-view="cards"
          @click="choose('cards')"
        >
          <GridIcon :size="16" />
          <span>{{ t('projects.view.cards') }}</span>
        </button>
        <button
          type="button"
          class="projects-view__mode"
          :aria-pressed="view === 'list'"
          data-view="list"
          @click="choose('list')"
        >
          <ListIcon :size="16" />
          <span>{{ t('projects.view.list') }}</span>
        </button>
      </div>

      <div v-if="view === 'list'" class="projects-view__batch" data-batch>
        <span class="projects-view__count" role="status" aria-live="polite">
          {{ t('projects.list.selected', { count: selected.length }, selected.length) }}
        </span>
        <BohrButton
          size="sm"
          variant="ghost"
          danger
          :disabled="selected.length === 0"
          data-action="batch-delete"
          @click="dialogOpen = true"
        >
          <template #iconLeft><TrashIcon :size="14" /></template>
          {{ t('projects.list.delete') }}
        </BohrButton>
        <BohrButton v-if="newTo !== null" size="sm" :as="RouterLink" :to="newTo">{{ t('projects.new') }}</BohrButton>
      </div>
    </div>

    <ProjectTable
      v-if="view === 'list' && projects !== null && projects.length > 0"
      v-model:selected="selected"
      :projects="projects"
      :caption="caption"
    />
    <ProjectGrid v-else :projects="projects" :new-to="newTo" />

    <BatchDeleteDialog
      :open="dialogOpen"
      :projects="selectedProjects"
      @close="dialogOpen = false"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { type RouteLocationRaw, RouterLink } from 'vue-router';
import type { ProjectSummary } from '../../api';
import { canDeleteProject, type ProjectsView, readProjectsView, writeProjectsView } from '../../lib/projects-view';
import { session } from '../../session';
import { GridIcon, ListIcon, TrashIcon } from '../icons';
import BatchDeleteDialog from './BatchDeleteDialog.vue';
import ProjectGrid from './ProjectGrid.vue';
import ProjectTable from './ProjectTable.vue';

// A scope's projects (the personal account's or an organization's) as cards or as a list, the list with deleting
// several at once. The view is remembered per user in this browser.
const props = defineProps<{
  /** null while loading. */
  projects: ProjectSummary[] | null;
  /** The new project page; null hides the way there. */
  newTo: RouteLocationRaw | null;
  /** What the list is, for screen readers (the table's caption). */
  caption: string;
}>();
const emit = defineEmits<{ deleted: [projectIds: string[]] }>();

const { t } = useI18n();
const userId = computed(() => session.me?.user.id ?? null);

const view = ref<ProjectsView>(readProjectsView(userId.value));
const selected = ref<string[]>([]);
const dialogOpen = ref(false);

watch(userId, (id) => {
  view.value = readProjectsView(id);
});

// Only projects still listed (and still deletable) stay selected.
watch(
  () => props.projects,
  (list) => {
    const ids = new Set((list ?? []).filter(canDeleteProject).map((project) => project.id));
    selected.value = selected.value.filter((id) => ids.has(id));
  },
);

const selectedProjects = computed(() =>
  (props.projects ?? []).filter((project) => selected.value.includes(project.id)),
);

function choose(next: ProjectsView) {
  view.value = next;
  writeProjectsView(userId.value, next);
}

function onDeleted(projectIds: string[]) {
  selected.value = selected.value.filter((id) => !projectIds.includes(id));
  emit('deleted', projectIds);
}
</script>

<style scoped>
.projects-view__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 20px;
}

.projects-view__toggle {
  display: inline-flex;
  padding: 3px;
  border: 1px solid hsl(0 0% 100% / 0.14);
  border-radius: var(--bohr-radius-full);
  background: hsl(0 0% 0% / 0.2);
}

.projects-view__mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 14px;
  border: 0;
  border-radius: var(--bohr-radius-full);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    color var(--bohr-transition),
    background-color var(--bohr-transition);
}

.projects-view__mode:hover {
  color: #fff;
}

.projects-view__mode[aria-pressed="true"] {
  color: #fff;
  background: hsl(var(--bohr-hsl-orange) / 0.25);
}

.projects-view__mode:focus-visible {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

.projects-view__batch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

.projects-view__count {
  font-size: 14px;
  color: var(--bohr-color-text-muted);
}
</style>
