<template>
  <SettingsCard danger class="org-danger" data-card="danger">
    <h2 class="card-title org-danger__title">{{ t('orgs.delete.title') }}</h2>
    <p class="card-text">{{ t('orgs.delete.text') }}</p>
    <div class="actions org-danger__actions">
      <BohrButton danger data-action="delete-org" @click="open">{{ t('orgs.delete.button') }}</BohrButton>
    </div>

    <ConfirmDialog
      :open="dialogOpen"
      :title="t('orgs.delete.confirmTitle', { name })"
      :confirm-label="t('orgs.delete.button')"
      danger
      :busy="deleting"
      :confirm-disabled="typed.trim() !== slug"
      @confirm="remove"
      @cancel="dialogOpen = false"
    >
      <div class="org-delete" data-dialog="delete-org">
        <p>{{ t('orgs.delete.confirmText') }}</p>
        <ul class="org-delete__points">
          <li>{{ t('orgs.delete.projects') }}</li>
          <li>{{ t('orgs.delete.subscription') }}</li>
          <li>{{ t('orgs.delete.github') }}</li>
          <li v-if="!deleteSites">{{ t('orgs.delete.sitesStay') }}</li>
        </ul>
        <label class="org-delete__check">
          <input v-model="deleteSites" type="checkbox" name="deleteSites" />
          <span>
            <strong>{{ t('orgs.delete.deleteSites') }}</strong>
            <span class="org-delete__hint">{{ t('orgs.delete.deleteSitesHint') }}</span>
          </span>
        </label>
        <label :for="`${id}-slug`" class="org-delete__label">
          <I18nT keypath="orgs.delete.typeSlug" scope="global">
            <template #slug><code class="org-delete__slug">{{ slug }}</code></template>
          </I18nT>
        </label>
        <input
          :id="`${id}-slug`"
          v-model="typed"
          class="org-delete__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-describedby="error !== null ? `${id}-error` : undefined"
          @keydown.enter.prevent="typed.trim() === slug && remove()"
        />
        <p v-if="error !== null" :id="`${id}-error`" class="org-delete__error" role="alert">{{ error }}</p>
      </div>
    </ConfirmDialog>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, SettingsCard, useToast } from '@bohr/ui';
import { ref, useId } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { loadOrgs, orgs, setContext } from '../../orgs';
import ConfirmDialog from '../ConfirmDialog.vue';

// Deleting an organization (admins): its projects, subscription, Cloudflare connections and agent settings go,
// and the GitHub App is uninstalled from the GitHub organization. The repositories stay on GitHub.
const props = defineProps<{
  /** Typed to confirm. */
  slug: string;
  name: string;
}>();

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const errorText = useErrorText();
const id = `delete-org-${useId()}`;

const dialogOpen = ref(false);
const typed = ref('');
const deleteSites = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

function open() {
  typed.value = '';
  deleteSites.value = false;
  error.value = null;
  dialogOpen.value = true;
}

async function remove() {
  if (deleting.value || typed.value.trim() !== props.slug) return;
  deleting.value = true;
  error.value = null;
  try {
    const result = await api.deleteOrg(props.slug, { deleteSites: deleteSites.value });
    dialogOpen.value = false;
    toast.success(t('orgs.delete.deleted', { name: props.name }));
    const warnings = result?.warnings ?? [];
    if (warnings.length > 0) toast.warn(t('orgs.delete.warnings', { list: warnings.join('; ') }), { persistent: true });
    if (orgs.context === props.slug) setContext(null);
    void loadOrgs(true);
    await router.push({ name: 'projects' });
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.org-danger__title {
  color: var(--bohr-color-red);
}

.org-danger__actions {
  margin-top: 20px;
}

.org-delete {
  display: grid;
  gap: 12px;
}

.org-delete__points {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
}

.org-delete__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid hsl(355 78% 50% / 0.35);
  border-radius: 8px;
  background: hsl(355 78% 50% / 0.06);
  cursor: pointer;
}

.org-delete__check input {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: hsl(355 78% 50%);
}

.org-delete__hint {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: hsl(0 0% 35%);
}

.org-delete__label {
  font-weight: 700;
}

.org-delete__slug {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-family: var(--bohr-font-family-mono);
  background: hsl(0 0% 0% / 0.07);
}

.org-delete__input {
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid hsl(0 0% 0% / 0.25);
  border-radius: 6px;
  font: inherit;
  color: hsl(0 0% 10%);
  background: #fff;
}

.org-delete__input:focus-visible {
  outline: 2px solid hsl(355 78% 50%);
  outline-offset: 1px;
}

.org-delete__error {
  font-size: 13px;
  font-weight: 700;
  color: hsl(355 78% 42%);
}
</style>
