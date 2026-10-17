<template>
  <div class="general-page">
    <SettingsCard class="general">
      <h2 class="card-title">{{ t('project.general.title') }}</h2>
      <p class="card-text">{{ t('project.general.text') }}</p>
      <dl class="facts general__facts">
        <div>
          <dt>{{ t('project.general.name') }}</dt>
          <dd>{{ name }}</dd>
        </div>
        <div v-if="repository">
          <dt>{{ t('project.general.repository') }}</dt>
          <dd>
            <a :href="`https://github.com/${repository}`" target="_blank" rel="noopener noreferrer" class="text-link">{{ repository }}</a>
          </dd>
        </div>
        <div>
          <dt>{{ t('project.general.branch') }}</dt>
          <dd>{{ state?.project.productionBranch ?? '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('project.general.production') }}</dt>
          <dd>
            <a v-if="productionUrl" :href="productionUrl" target="_blank" rel="noopener noreferrer" class="text-link">{{ productionUrl }}</a>
            <template v-else>{{ t('project.general.noProduction') }}</template>
          </dd>
        </div>
        <div>
          <dt>{{ t('project.general.hosting') }}</dt>
          <dd>{{ summary?.mode === 'managed' ? t('project.general.hostedByBohr') : t('project.general.ownAccount') }}</dd>
        </div>
        <div>
          <dt>{{ t('project.general.agent') }}</dt>
          <dd>{{ t(agentIndicator.label) }}</dd>
        </div>
        <div>
          <dt>{{ t('project.general.id') }}</dt>
          <dd class="general__id">
            <code>{{ id }}</code>
            <CopyButton :value="id" />
          </dd>
        </div>
      </dl>
    </SettingsCard>

    <DeleteProject v-if="isOwner && summary !== null" :project-id="id" :name="summary.name" :mode="summary.mode" />
  </div>
</template>

<script setup lang="ts">
import { SettingsCard } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CopyButton from '../../components/CopyButton.vue';
import DeleteProject from '../../components/project/DeleteProject.vue';
import { useProject } from '../../composables/useProject';
import { type Indicator, projectIndicator } from '../../lib/status';

const { t } = useI18n();
const { id, summary, state, productionUrl, isOwner } = useProject();

const name = computed(() => state.value?.project.name ?? summary.value?.name ?? id);
const repository = computed(() => state.value?.project.repository ?? summary.value?.repository ?? '');
const agentIndicator = computed<Indicator>(() =>
  summary.value === null ? { status: 'success', label: 'projects.state.ready' } : projectIndicator(summary.value),
);
</script>

<style scoped>
.general-page {
  display: grid;
  gap: 24px;
}

.general {
  max-width: 760px;
}

.general__facts {
  margin-top: 24px;
}

.general__id {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
