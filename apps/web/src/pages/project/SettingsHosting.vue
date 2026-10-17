<template>
  <MoveToCloudflare v-if="canMove" :project-id="id" @moved="loadSummary" />
  <SettingsCard v-else class="hosting">
    <h2 class="card-title">{{ t('project.hosting.ownTitle') }}</h2>
    <p class="card-text">{{ t('project.hosting.own') }}</p>
  </SettingsCard>
</template>

<script setup lang="ts">
import { SettingsCard } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import MoveToCloudflare from '../../components/project/MoveToCloudflare.vue';
import { useProject } from '../../composables/useProject';

// Where the site runs; projects bohr still hosts (migrated from v1) can move to the owner's account here.
const { t } = useI18n();
const { id, canMove, loadSummary } = useProject();
</script>

<style scoped>
.hosting {
  max-width: 760px;
}
</style>
