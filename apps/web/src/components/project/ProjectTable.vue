<template>
  <div class="admin-table-wrap project-table-wrap">
    <table class="admin-table project-table" data-table="projects">
      <caption class="bohr-visually-hidden">{{ caption }}</caption>
      <thead>
        <tr>
          <th scope="col" class="project-table__check">
            <input
              ref="selectAll"
              type="checkbox"
              :checked="allSelected"
              :disabled="selectable.length === 0"
              :aria-label="t('projects.list.selectAll')"
              data-select="all"
              @change="toggleAll"
            />
          </th>
          <th scope="col">{{ t('projects.list.name') }}</th>
          <th scope="col">{{ t('projects.repository') }}</th>
          <th scope="col">{{ t('projects.list.status') }}</th>
          <th scope="col">{{ t('projects.list.updated') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="project in projects"
          :key="project.id"
          :data-project="project.id"
          :class="{ 'is-selected': selected.includes(project.id) }"
        >
          <td class="project-table__check">
            <input
              type="checkbox"
              :checked="selected.includes(project.id)"
              :disabled="!canDeleteProject(project)"
              :aria-label="
                canDeleteProject(project)
                  ? t('projects.list.select', { name: project.name })
                  : t('projects.list.cannotSelect', { name: project.name })
              "
              :title="canDeleteProject(project) ? undefined : t('projects.list.ownersOnly')"
              :data-select="project.id"
              @change="toggle(project.id)"
            />
          </td>
          <td>
            <div class="project-table__name">
              <ProjectScreenshot :project="project" variant="thumb" />
              <div class="project-table__name-text">
                <RouterLink :to="{ name: 'project', params: { id: project.id } }" class="admin-table__strong text-link">
                  {{ project.name }}
                </RouterLink>
                <span v-if="project.role === 'member'" class="badge project-table__badge">{{ t('projects.role.member') }}</span>
                <a
                  v-if="project.productionUrl"
                  :href="project.productionUrl"
                  class="admin-table__muted text-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ project.productionUrl.replace(/^https?:\/\//, '') }}</a>
              </div>
            </div>
          </td>
          <td><span class="project-table__repo">{{ project.repository }}</span></td>
          <td>
            <span class="project-table__status">
              <StatusIndicator :status="projectIndicator(project).status" :label="t(projectIndicator(project).label)" />
              <span aria-hidden="true">{{ t(projectIndicator(project).label) }}</span>
            </span>
            <span v-if="project.lastDeploy" class="admin-table__muted" data-last-deploy>
              {{
                t('projects.list.lastDeploy', {
                  status: t(`projects.list.deploy.${project.lastDeploy.status}`),
                  branch: project.lastDeploy.branch,
                  when: formatRelative(project.lastDeploy.createdAt, locale),
                })
              }}
            </span>
            <span v-else-if="project.lastDeploy === null" class="admin-table__muted" data-last-deploy>
              {{ t('projects.list.noDeploy') }}
            </span>
          </td>
          <td class="admin-table__nowrap">
            <time v-if="project.updatedAt" :datetime="project.updatedAt" :title="formatDateTime(project.updatedAt, locale)">
              {{ formatRelative(project.updatedAt, locale) }}
            </time>
            <span v-else aria-hidden="true">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { StatusIndicator } from '@bohr/ui';
import { computed, useTemplateRef, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { ProjectSummary } from '../../api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { canDeleteProject } from '../../lib/projects-view';
import { projectIndicator } from '../../lib/status';
import ProjectScreenshot from './ProjectScreenshot.vue';

// The projects as a table, with a checkbox on each project its owners can delete (for deleting several at once).
const props = defineProps<{ projects: ProjectSummary[]; caption: string }>();
/** The ids of the selected projects. */
const selected = defineModel<string[]>('selected', { required: true });

const { t, locale } = useI18n();
const selectAll = useTemplateRef<HTMLInputElement>('selectAll');

const selectable = computed(() => props.projects.filter(canDeleteProject).map((project) => project.id));
const allSelected = computed(
  () => selectable.value.length > 0 && selectable.value.every((id) => selected.value.includes(id)),
);

// Some selected: the "select all" box shows a dash (mixed), which only the DOM property can set.
watchEffect(() => {
  if (selectAll.value !== null) selectAll.value.indeterminate = selected.value.length > 0 && !allSelected.value;
});

function toggle(projectId: string) {
  selected.value = selected.value.includes(projectId)
    ? selected.value.filter((id) => id !== projectId)
    : [...selected.value, projectId];
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...selectable.value];
}
</script>

<style scoped>
.project-table__check {
  width: 44px;
  padding-right: 0;
}

.project-table__check input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--bohr-color-amber);
  cursor: pointer;
}

.project-table__check input:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.project-table__check input:focus-visible {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

.project-table tr.is-selected td {
  background: hsl(var(--bohr-hsl-orange) / 0.08);
}

.project-table__name {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.project-table__name-text {
  min-width: 0;
}

.project-table__name-text > * + * {
  margin-top: 4px;
}

.project-table__badge {
  margin-left: 8px;
}

.project-table__repo {
  font-family: var(--bohr-font-family-mono);
  font-size: 13px;
  color: var(--bohr-color-text-subtle);
  overflow-wrap: anywhere;
}

.project-table__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
</style>
