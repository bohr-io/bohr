<template>
  <SettingsCard v-if="items.length > 0" class="checklist" data-card="checklist">
    <h2 class="checklist__title">{{ t('checklist.title') }}</h2>
    <ul class="checklist__items" role="list">
      <li v-for="item in items" :key="item" class="checklist__item" :data-item="item">
        <StatusIndicator :status="item === 'noBuilds' ? 'off' : item === 'runtimeError' ? 'error' : 'warning'" />
        <div class="checklist__text">
          <template v-if="item === 'agentMissing'">
            <p class="checklist__name">{{ t('checklist.agentMissing') }}</p>
            <p class="card-text">{{ org ? t('checklist.agentMissingOrgText') : t('checklist.agentMissingText') }}</p>
            <div class="actions checklist__actions">
              <BohrButton size="sm" :as="RouterLink" :to="agentSettingsRoute">{{ t('checklist.agentLink') }}</BohrButton>
            </div>
          </template>
          <template v-else-if="item === 'agentOff'">
            <p class="checklist__name">{{ t('checklist.agentMissing') }}</p>
            <p class="card-text">{{ org ? t('orgs.newProject.agentMissing') : t('checklist.agentOffMember') }}</p>
          </template>
          <template v-else-if="item === 'runtimeError'">
            <p class="checklist__name">{{ t('checklist.runtimeError') }}</p>
            <p v-if="runtimeError" class="card-text">{{ runtimeError }}</p>
            <p v-if="!isOwner" class="card-text">{{ t('checklist.runtimeErrorMember') }}</p>
            <div v-else class="actions checklist__actions">
              <BohrButton size="sm" :disabled="retrying" @click="retry">
                {{ retrying ? t('common.working') : t('common.retry') }}
              </BohrButton>
            </div>
          </template>
          <template v-else-if="item === 'preparing'">
            <p class="checklist__name">{{ t('checklist.preparing') }}</p>
            <p class="card-text">{{ t('checklist.preparingText') }}</p>
            <div class="actions checklist__actions">
              <BohrButton size="sm" variant="ghost" :as="RouterLink" :to="{ name: 'project-agent', params: { id } }">
                {{ t('checklist.preparingLink') }}
              </BohrButton>
            </div>
          </template>
          <template v-else-if="item === 'notPrepared'">
            <p class="checklist__name">{{ t('checklist.notPrepared') }}</p>
            <p class="card-text">{{ t('checklist.notPreparedText') }}</p>
            <p v-if="state?.project.importStatus === 'failed'" class="card-text">{{ t('checklist.notPreparedFailed') }}</p>
            <p v-if="!isOwner" class="card-text">{{ t('checklist.notPreparedMember') }}</p>
            <div v-else class="actions checklist__actions">
              <BohrButton size="sm" :disabled="preparing" @click="prepare">
                {{ preparing ? t('common.working') : t('checklist.prepare') }}
              </BohrButton>
            </div>
          </template>
          <template v-else>
            <p class="checklist__name">{{ t('checklist.noBuilds') }}</p>
            <p class="card-text">{{ t('checklist.noBuildsText') }}</p>
            <div class="actions checklist__actions">
              <BohrButton size="sm" variant="ghost" :as="RouterLink" :to="{ name: 'project-builds', params: { id } }">
                {{ t('checklist.buildsLink') }}
              </BohrButton>
            </div>
          </template>
        </div>
      </li>
    </ul>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, SettingsCard, StatusIndicator } from '@bohr/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api } from '../../api';
import { useErrorToast } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';

// What keeps the project from working, on its overview: the owner's agent is not set up (the organization's, for an
// organization's project), its runtime failed to set up, the agent never prepared the repository (the import), or
// nothing was deployed yet.
type Item = 'agentMissing' | 'agentOff' | 'runtimeError' | 'preparing' | 'notPrepared' | 'noBuilds';

const props = defineProps<{
  /** The repository has GitHub Actions runs (the overview reads them); null until known or when GitHub did not answer. */
  hasBuilds: boolean | null;
}>();
const emit = defineEmits<{ retried: [] }>();

const { t } = useI18n();
const showError = useErrorToast();
const { id, summary, state, isOwner, loadSummary, prepareRepository: prepare, preparing } = useProject();

/** The organization the project belongs to (its agent settings are the organization's); null for a personal one. */
const org = computed(() => summary.value?.org ?? null);
const agentSettingsRoute = computed(() =>
  org.value === null ? { name: 'account-agent' } : { name: 'org-settings', params: { slug: org.value.slug } },
);

/** The owner's agent settings exist; null until known (or for members, who cannot read them). */
const agentConfigured = ref<boolean | null>(null);
const runtimeError = ref<string | null>(null);
const retrying = ref(false);

const items = computed<Item[]>(() => {
  const list: Item[] = [];
  const runtime = summary.value?.runtime ?? null;
  if (runtime !== null) {
    if (isOwner.value && agentConfigured.value === false) list.push('agentMissing');
    else if (!isOwner.value && state.value?.project.agentEnabled === false) list.push('agentOff');
    if (runtime.status === 'error') list.push('runtimeError');
    // Without the import there is no preview config: the preview would only say it is starting
    const imported = state.value?.project.importStatus;
    // While the agent prepares it, say so (and where to follow it) instead of leaving nothing behind
    if (imported === 'running' || preparing.value) list.push('preparing');
    else if (state.value?.project.agentEnabled && (imported === 'never' || imported === 'failed')) {
      list.push('notPrepared');
    }
  }
  if (props.hasBuilds === false && !list.includes('preparing')) list.push('noBuilds');
  return list;
});

async function loadAgent() {
  if (!isOwner.value || summary.value?.runtime == null) return;
  try {
    const slug = org.value?.slug;
    agentConfigured.value = (await (slug ? api.orgAgentSettings(slug) : api.agentSettings())).agent.configured;
  } catch {
    agentConfigured.value = null;
  }
}

async function loadRuntimeError() {
  if (summary.value?.runtime?.status !== 'error' || !isOwner.value) return;
  try {
    runtimeError.value = (await api.runtime(id)).error;
  } catch {
    runtimeError.value = null;
  }
}

async function retry() {
  retrying.value = true;
  try {
    await api.retryRuntime(id);
    runtimeError.value = null;
    emit('retried');
    await loadSummary();
  } catch (caught) {
    showError(caught);
  } finally {
    retrying.value = false;
  }
}

watch(
  () => [summary.value?.runtime?.status, isOwner.value] as const,
  () => {
    void loadAgent();
    void loadRuntimeError();
  },
);

onMounted(() => {
  void loadAgent();
  void loadRuntimeError();
});
</script>

<style scoped>
.checklist :deep(.bohr-settings-card__content) {
  padding: 28px;
}

.checklist__title {
  font-size: 18px;
}

.checklist__items {
  display: grid;
  margin-top: 8px;
}

.checklist__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  padding: 14px 0;
}

.checklist__item + .checklist__item {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.checklist__item > :first-child {
  margin-top: 6px;
}

.checklist__name {
  font-weight: 700;
}

.checklist__text .card-text {
  margin-top: 4px;
}

.checklist__actions {
  margin-top: 12px;
}
</style>
