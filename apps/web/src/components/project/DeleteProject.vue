<template>
  <SettingsCard danger class="danger-zone" data-card="danger">
    <h2 class="card-title danger-zone__title">{{ t('deleteProject.title') }}</h2>
    <p class="card-text">{{ t('deleteProject.text') }}</p>
    <div class="actions danger-zone__actions">
      <BohrButton danger @click="open">{{ t('deleteProject.button') }}</BohrButton>
    </div>

    <ConfirmDialog
      :open="dialogOpen"
      :title="t('deleteProject.confirmTitle', { name })"
      :confirm-label="t('deleteProject.button')"
      danger
      :busy="deleting"
      :confirm-disabled="typed.trim() !== name"
      @confirm="remove"
      @cancel="dialogOpen = false"
    >
      <div class="delete">
        <p>{{ t('deleteProject.confirmText') }}</p>
        <ul class="delete__points">
          <li>{{ t('deleteProject.repository') }}</li>
          <li>{{ t('deleteProject.telegram') }}</li>
          <li v-if="mode === 'byo' && !deleteSite">{{ t('deleteProject.siteStays') }}</li>
        </ul>
        <label v-if="mode === 'byo'" class="delete__check">
          <input v-model="deleteSite" type="checkbox" name="deleteSite" />
          <span>
            <strong>{{ t('deleteProject.deleteSite') }}</strong>
            <span class="delete__hint">{{ t('deleteProject.deleteSiteHint') }}</span>
          </span>
        </label>
        <label :for="`${id}-name`" class="delete__label">
          <I18nT keypath="deleteProject.typeName" scope="global">
            <template #name><code class="delete__name">{{ name }}</code></template>
          </I18nT>
        </label>
        <input
          :id="`${id}-name`"
          v-model="typed"
          class="delete__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-describedby="error !== null ? `${id}-error` : undefined"
          @keydown.enter.prevent="typed.trim() === name && remove()"
        />
        <p v-if="error !== null" :id="`${id}-error`" class="delete__error" role="alert">{{ error }}</p>
      </div>
    </ConfirmDialog>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, SettingsCard, useToast } from '@bohr/ui';
import { ref, useId } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, type ProjectSummary } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import ConfirmDialog from '../ConfirmDialog.vue';

// The danger zone (owner only): deleting the project removes what bohr created for it, never the repository.
const props = defineProps<{
  projectId: string;
  /** The project's name, typed to confirm. */
  name: string;
  /** byo: the site runs in the owner's own Cloudflare account, so it can go too. */
  mode: ProjectSummary['mode'];
}>();

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const errorText = useErrorText();
const id = `delete-${useId()}`;

const dialogOpen = ref(false);
const typed = ref('');
const deleteSite = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

function open() {
  typed.value = '';
  deleteSite.value = false;
  error.value = null;
  dialogOpen.value = true;
}

async function remove() {
  if (deleting.value || typed.value.trim() !== props.name) return;
  deleting.value = true;
  error.value = null;
  try {
    const { warnings } = await api.deleteProject(props.projectId, {
      confirm: typed.value.trim(),
      deleteSite: props.mode === 'byo' && deleteSite.value,
    });
    dialogOpen.value = false;
    toast.success(t('deleteProject.deleted', { name: props.name }));
    // The project is gone anyway; what could not be removed is left for the owner to clean up.
    if (warnings.length > 0) {
      toast.warn(t('deleteProject.warnings', { list: warnings.join('; ') }), { persistent: true });
    }
    // The projects of the project's scope (its organization's, or the personal ones)
    await router.push({ name: 'home' });
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.danger-zone {
  max-width: 760px;
}

.danger-zone__title {
  color: var(--bohr-color-red);
}

.danger-zone__actions {
  margin-top: 20px;
}

.delete {
  display: grid;
  gap: 12px;
}

.delete__points {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
}

.delete__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid hsl(355 78% 50% / 0.35);
  border-radius: 8px;
  background: hsl(355 78% 50% / 0.06);
  cursor: pointer;
}

.delete__check input {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: hsl(355 78% 50%);
}

.delete__hint {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: hsl(0 0% 35%);
}

.delete__label {
  font-weight: 700;
}

.delete__name {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-family: var(--bohr-font-family-mono);
  background: hsl(0 0% 0% / 0.07);
}

.delete__input {
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid hsl(0 0% 0% / 0.25);
  border-radius: 6px;
  font: inherit;
  color: hsl(0 0% 10%);
  background: #fff;
}

.delete__input:focus-visible {
  outline: 2px solid hsl(355 78% 50%);
  outline-offset: 1px;
}

.delete__error {
  font-size: 13px;
  font-weight: 700;
  color: hsl(355 78% 42%);
}
</style>
