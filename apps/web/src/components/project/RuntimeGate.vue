<template>
  <div v-if="mode === 'loading' || (mode === 'agent' && feed.state.status === 'loading')" class="gate" aria-busy="true">
    <BohrSkeleton class="gate__skeleton" radius="8px" />
    <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
  </div>

  <!-- No runtime yet (migrated from bohr v1), or the owner's is being set up -->
  <div v-else-if="mode === 'deploy-only' || mode === 'activating'" class="gate">
    <AgentActivation
      v-if="canActivate"
      :project-id="id"
      :initial-phase="mode === 'activating' ? 'provisioning' : 'intro'"
      @activated="loadSummary"
    />
    <SettingsCard v-else class="gate__card">
      <h2 class="card-title">{{ t('activation.deployOnlyTitle') }}</h2>
      <p class="card-text">{{ t('activation.deployOnly') }}</p>
      <p class="card-text">{{ isOwner ? t('activation.unavailable') : t('activation.askOwner') }}</p>
    </SettingsCard>
  </div>

  <p v-else-if="feed.state.status === 'not_ready'" class="notice notice--warn gate" role="status">
    {{ t('project.notReady') }}
  </p>

  <ErrorState
    v-else-if="feed.state.status === 'error' || state === null"
    class="gate"
    :message="errorText(feed.state.error)"
    @retry="feed.restart()"
  />

  <slot v-else :state="state" />
</template>

<script setup lang="ts">
import type { ProjectState } from '@bohr/shared';
import { BohrSkeleton, SettingsCard } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { useErrorText } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';
import ErrorState from '../ErrorState.vue';
import AgentActivation from './AgentActivation.vue';

// The sub-pages that need the project runtime (agent, preview, versions, members, agent settings) show its
// state until it answers: loading, the activation of a project that only deploys, or what went wrong.
defineSlots<{ default(props: { state: ProjectState }): unknown }>();

const { t } = useI18n();
const errorText = useErrorText();
const { id, feed, state, mode, isOwner, canActivate, loadSummary } = useProject();
</script>

<style scoped>
.gate__skeleton {
  width: 100%;
  height: 320px;
}

.gate__card {
  max-width: 760px;
}
</style>
