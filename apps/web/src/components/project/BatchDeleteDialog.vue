<template>
  <ModalBase
    :open="open"
    :labelledby="titleId"
    with-close-button
    :close-label="t('common.close')"
    :close-on-backdrop="phase !== 'running'"
    max-width="min(560px, calc(100vw - 32px))"
    @close="close"
  >
    <div class="batch" data-batch-delete>
      <h2 :id="titleId" class="batch__title">{{ t('projects.batch.title', { count: batch.length }, batch.length) }}</h2>

      <template v-if="phase === 'confirm'">
        <p>{{ t('projects.batch.text') }}</p>
        <ul class="batch__projects" role="list" :aria-label="t('projects.batch.listLabel')">
          <li v-for="project in batch" :key="project.id" :data-batch-project="project.id">
            <code class="batch__name">{{ project.name }}</code>
            <span class="batch__repo">{{ project.repository }}</span>
          </li>
        </ul>
        <ul class="batch__points">
          <li>{{ t('deleteProject.repository') }}</li>
          <li>{{ t('deleteProject.telegram') }}</li>
          <li v-if="anyByo && !deleteSite">{{ t('projects.batch.sitesStay') }}</li>
        </ul>
        <label v-if="anyByo" class="batch__check">
          <input v-model="deleteSite" type="checkbox" name="deleteSite" />
          <span>
            <strong>{{ t('projects.batch.deleteSites') }}</strong>
            <span class="batch__hint">{{ t('deleteProject.deleteSiteHint') }}</span>
          </span>
        </label>
        <label :for="`${titleId}-word`" class="batch__label">
          <I18nT keypath="projects.batch.typeWord" scope="global">
            <template #word><code class="batch__name">{{ word }}</code></template>
          </I18nT>
        </label>
        <input
          :id="`${titleId}-word`"
          v-model="typed"
          class="batch__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter.prevent="confirmed && run()"
        />
      </template>

      <template v-else>
        <p class="batch__progress" role="status" aria-live="polite" data-progress>
          {{
            phase === 'running'
              ? t('projects.batch.progress', { done: finished, total: batch.length })
              : t('projects.batch.summary', { deleted: deletedIds.length, failed: failedCount })
          }}
        </p>
        <ul class="batch__results" role="list">
          <li
            v-for="project in batch"
            :key="project.id"
            class="batch__result"
            :data-result="outcomes[project.id]?.status ?? 'pending'"
            :data-batch-project="project.id"
          >
            <span class="batch__result-name">{{ project.name }}</span>
            <span class="batch__result-status">{{ statusText(project.id) }}</span>
            <span v-if="failure(project.id) !== null" class="batch__error">{{ failure(project.id) }}</span>
          </li>
        </ul>
      </template>

      <div class="batch__actions">
        <template v-if="phase === 'confirm'">
          <BohrButton variant="text" color="black" @click="close">{{ t('common.cancel') }}</BohrButton>
          <BohrButton danger :disabled="!confirmed" data-action="confirm-batch-delete" @click="run">
            {{ t('projects.batch.confirm', { count: batch.length }, batch.length) }}
          </BohrButton>
        </template>
        <BohrButton v-else :disabled="phase === 'running'" data-action="close-batch-delete" @click="close">
          {{ phase === 'running' ? t('common.working') : t('common.close') }}
        </BohrButton>
      </div>
    </div>
  </ModalBase>
</template>

<script setup lang="ts">
import { BohrButton, ModalBase, useToast } from '@bohr/ui';
import { computed, ref, useId, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import type { ProjectSummary } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { type DeleteOutcome, deleteProjects } from '../../lib/projects-view';

// Deleting several projects at once: the danger zone's options and confirmation (a word to type, as the list
// has many names), then each project's result as it goes; failures stay listed with their reason.
const props = defineProps<{ open: boolean; projects: ProjectSummary[] }>();
const emit = defineEmits<{ close: []; deleted: [projectIds: string[]] }>();

const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const titleId = `batch-delete-${useId()}`;

const phase = ref<'confirm' | 'running' | 'done'>('confirm');
const typed = ref('');
const deleteSite = ref(false);
const outcomes = ref<Record<string, DeleteOutcome>>({});
/** The projects as they were when the dialog opened: the page drops the deleted ones from its list meanwhile. */
const batch = ref<ProjectSummary[]>([]);

const word = computed(() => t('projects.batch.word'));
const confirmed = computed(() => typed.value.trim().toLocaleLowerCase() === word.value.toLocaleLowerCase());
/** Projects whose site runs in their owner's Cloudflare account, which can go too. */
const anyByo = computed(() => batch.value.some((project) => project.mode === 'byo'));
const deletedIds = computed(() =>
  batch.value.filter((project) => outcomes.value[project.id]?.status === 'deleted').map((project) => project.id),
);
const failedCount = computed(
  () => batch.value.filter((project) => outcomes.value[project.id]?.status === 'failed').length,
);
const finished = computed(() => deletedIds.value.length + failedCount.value);

// Each opening starts over.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    batch.value = [...props.projects];
    phase.value = 'confirm';
    typed.value = '';
    deleteSite.value = false;
    outcomes.value = {};
  },
);

function statusText(projectId: string): string {
  const status = outcomes.value[projectId]?.status ?? 'pending';
  return t(`projects.batch.status.${status}`);
}

function failure(projectId: string): string | null {
  const outcome = outcomes.value[projectId];
  return outcome?.status === 'failed' ? errorText(outcome.error) : null;
}

async function run() {
  if (!confirmed.value || phase.value !== 'confirm') return;
  phase.value = 'running';
  await deleteProjects(batch.value, { deleteSite: deleteSite.value }, (projectId, outcome) => {
    outcomes.value = { ...outcomes.value, [projectId]: outcome };
  });
  phase.value = 'done';

  const deleted = deletedIds.value;
  if (deleted.length > 0) {
    toast.success(t('projects.batch.deleted', { count: deleted.length }, deleted.length));
    emit('deleted', deleted);
  }
  // The projects are gone anyway; what could not be removed is left for the owner to clean up.
  const warnings = batch.value.flatMap((project) => {
    const outcome = outcomes.value[project.id];
    return outcome?.status === 'deleted' ? outcome.warnings.map((warning) => `${project.name}: ${warning}`) : [];
  });
  if (warnings.length > 0) toast.warn(t('deleteProject.warnings', { list: warnings.join('; ') }), { persistent: true });
  // Everything went: nothing left to read here. Failures stay on screen with their reasons.
  if (failedCount.value === 0) emit('close');
}

function close() {
  if (phase.value !== 'running') emit('close');
}
</script>

<style scoped>
.batch {
  display: grid;
  gap: 14px;
  max-width: 480px;
  font-size: 15px;
  line-height: 1.55;
  color: hsl(0 0% 20%);
}

.batch__title {
  padding-right: 32px;
  font-size: 22px;
  line-height: 1.25;
  color: hsl(0 0% 8%);
}

.batch__projects,
.batch__results {
  display: grid;
  gap: 6px;
  max-height: 220px;
  margin: 0;
  padding: 10px 12px;
  overflow-y: auto;
  border: 1px solid hsl(0 0% 0% / 0.12);
  border-radius: 8px;
  background: hsl(0 0% 0% / 0.03);
}

.batch__projects li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.batch__repo {
  font-size: 13px;
  color: hsl(0 0% 40%);
}

.batch__points {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
}

.batch__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid hsl(355 78% 50% / 0.35);
  border-radius: 8px;
  background: hsl(355 78% 50% / 0.06);
  cursor: pointer;
}

.batch__check input {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: hsl(355 78% 50%);
}

.batch__hint {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: hsl(0 0% 35%);
}

.batch__label {
  font-weight: 700;
}

.batch__name {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-family: var(--bohr-font-family-mono);
  background: hsl(0 0% 0% / 0.07);
}

.batch__input {
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid hsl(0 0% 0% / 0.25);
  border-radius: 6px;
  font: inherit;
  color: hsl(0 0% 10%);
  background: #fff;
}

.batch__input:focus-visible {
  outline: 2px solid hsl(355 78% 50%);
  outline-offset: 1px;
}

.batch__progress {
  font-weight: 700;
}

.batch__result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 12px;
}

.batch__result-name {
  overflow: hidden;
  font-family: var(--bohr-font-family-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch__result-status {
  font-size: 13px;
  font-weight: 700;
  color: hsl(0 0% 35%);
}

.batch__result[data-result="deleted"] .batch__result-status {
  color: hsl(145 63% 28%);
}

.batch__result[data-result="failed"] .batch__result-status,
.batch__error {
  color: hsl(355 78% 42%);
}

.batch__error {
  grid-column: 1 / -1;
  font-size: 13px;
}

.batch__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
