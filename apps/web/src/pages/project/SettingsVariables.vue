<template>
  <div class="settings-page">
    <div v-if="variables === null && loadError === null" aria-busy="true">
      <BohrSkeleton class="settings-page__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <ErrorState v-else-if="variables === null" :message="errorText(loadError)" @retry="load" />
    <template v-else>
      <p v-if="!canEdit" class="notice">{{ t('variables.readOnly') }}</p>
      <VariablesCard
        v-for="target in TARGETS"
        :key="target"
        :project-id="id"
        :target="target"
        :variables="variables"
        :can-edit="canEdit"
        :hosted-by-bohr="summary?.mode === 'managed'"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrSkeleton } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Variable, type VariableTarget } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import VariablesCard from '../../components/project/VariablesCard.vue';
import { useErrorText } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';

const TARGETS: VariableTarget[] = ['runtime', 'build'];

const { t } = useI18n();
const errorText = useErrorText();
const { id, summary } = useProject();

const variables = ref<Variable[] | null>(null);
const canEdit = ref(false);
const loadError = ref<unknown>(null);

async function load() {
  loadError.value = null;
  try {
    const result = await api.variables(id);
    canEdit.value = result.canEdit;
    variables.value = result.variables;
  } catch (caught) {
    loadError.value = caught;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-page {
  display: grid;
  gap: 24px;
}

.settings-page__skeleton {
  width: 100%;
  height: 280px;
}
</style>
