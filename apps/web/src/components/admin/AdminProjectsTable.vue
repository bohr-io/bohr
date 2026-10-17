<template>
  <div class="admin-table-wrap">
    <table class="admin-table" data-table="projects">
      <thead>
        <tr>
          <th scope="col">{{ t('admin.projects.project') }}</th>
          <th v-if="showOwner" scope="col">{{ t('admin.projects.owner') }}</th>
          <th scope="col">{{ t('admin.projects.status') }}</th>
          <th scope="col">{{ t('admin.projects.runtime') }}</th>
          <th scope="col">{{ t('admin.projects.created') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in projects" :key="project.id" :data-project="project.id">
          <td>
            <RouterLink :to="{ name: 'project', params: { id: project.id } }" class="admin-table__strong text-link">
              {{ project.name }}
            </RouterLink>
            <span v-if="project.org" class="badge badge--cyan admin-projects__org" data-org-badge>
              <span class="bohr-visually-hidden">{{ t('orgs.badge') }}</span>
              {{ project.org.name }}
            </span>
            <span class="admin-table__muted">{{ project.repository }}</span>
            <a
              v-if="project.productionUrl"
              :href="project.productionUrl"
              class="admin-table__muted text-link"
              target="_blank"
              rel="noopener noreferrer"
            >{{ project.productionUrl.replace(/^https?:\/\//, '') }}</a>
          </td>
          <td v-if="showOwner">
            <RouterLink :to="{ name: 'admin-user', params: { userId: project.owner.id } }" class="text-link">
              {{ project.owner.name ?? project.owner.email ?? project.owner.id }}
            </RouterLink>
            <span v-if="project.owner.name && project.owner.email" class="admin-table__muted">{{ project.owner.email }}</span>
          </td>
          <td>
            <span class="badge" :class="PROJECT_BADGE[project.status]">{{ t(`admin.status.${project.status}`) }}</span>
            <span class="admin-table__muted">{{ t(`admin.mode.${project.mode}`) }}</span>
          </td>
          <td>
            <template v-if="project.runtime !== null">
              <span class="badge" :class="RUNTIME_BADGE[project.runtime.status]" :title="project.runtime.error ?? undefined">
                {{ t(`admin.runtime.${project.runtime.status}`) }}
              </span>
              <span v-if="project.runtime.version" class="admin-table__muted">v{{ project.runtime.version }}</span>
              <span v-if="project.runtime.error" class="admin-table__error">{{ project.runtime.error }}</span>
            </template>
            <span v-else class="badge">{{ t('admin.runtime.none') }}</span>
          </td>
          <td class="admin-table__nowrap">{{ formatDate(project.createdAt, locale) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { ProjectRow } from '../../api';
import { formatDate } from '../../lib/format';
import { PROJECT_BADGE, RUNTIME_BADGE } from '../../lib/status';

withDefaults(defineProps<{ projects: ProjectRow[]; showOwner?: boolean }>(), { showOwner: true });

const { t, locale } = useI18n();
</script>

<style scoped>
.admin-projects__org {
  margin-left: 8px;
}
</style>
