<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    :confirm-label="t('deleteAccount.button')"
    danger
    :busy="deleting"
    :confirm-disabled="!confirmed"
    @confirm="confirmDelete"
    @cancel="emit('cancel')"
  >
    <div class="delete" data-dialog="delete-account">
      <p>{{ intro }}</p>
      <ul class="delete__points">
        <li>{{ t('deleteAccount.projects') }}</li>
        <li>{{ t('deleteAccount.github') }}</li>
        <li>{{ t('deleteAccount.cloudflare') }}</li>
        <li>{{ t('deleteAccount.telegram') }}</li>
        <li>{{ t('deleteAccount.agent') }}</li>
        <li>{{ t('deleteAccount.subscription') }}</li>
      </ul>
      <p class="delete__stays">{{ t('deleteAccount.keeps') }}</p>
      <ul class="delete__points">
        <li>{{ t('deleteAccount.repositories') }}</li>
        <li>{{ t('deleteAccount.bots') }}</li>
        <li v-if="!deleteSites">{{ t('deleteAccount.sitesStay') }}</li>
      </ul>
      <label class="delete__check">
        <input v-model="deleteSites" type="checkbox" name="deleteSites" />
        <span>
          <strong>{{ t('deleteAccount.deleteSites') }}</strong>
          <span class="delete__hint">{{ t('deleteAccount.deleteSitesHint') }}</span>
        </span>
      </label>
      <label :for="`${id}-word`" class="delete__label">
        <I18nT keypath="deleteAccount.typeWord" scope="global">
          <template #word><code class="delete__word">{{ word }}</code></template>
        </I18nT>
      </label>
      <input
        :id="`${id}-word`"
        v-model="typed"
        class="delete__input"
        type="text"
        name="confirm"
        autocomplete="off"
        spellcheck="false"
        :aria-describedby="error !== null ? `${id}-error` : undefined"
        @keydown.enter.prevent="confirmDelete"
      />
      <p v-if="error !== null" :id="`${id}-error`" class="delete__error" role="alert">{{ error }}</p>
    </div>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { useErrorText } from '../../composables/useErrorText';
import ConfirmDialog from '../ConfirmDialog.vue';

// Deleting an account (your own, or someone's from the admin area): what goes, what stays, and a typed word.
const props = defineProps<{
  open: boolean;
  title: string;
  /** What happens, in one sentence (yours or theirs). */
  intro: string;
  /** Deletes the account; a rejection is shown in the dialog. */
  remove: (deleteSites: boolean) => Promise<void>;
}>();

const emit = defineEmits<{ cancel: [] }>();

const { t } = useI18n();
const errorText = useErrorText();
const id = `delete-account-${useId()}`;

const typed = ref('');
const deleteSites = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

/** EXCLUIR, DELETE or ELIMINAR, in the interface language. */
const word = computed(() => t('deleteAccount.word'));
const confirmed = computed(() => typed.value.trim().toUpperCase() === word.value.toUpperCase());

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    typed.value = '';
    deleteSites.value = false;
    error.value = null;
  },
);

async function confirmDelete() {
  if (deleting.value || !confirmed.value) return;
  deleting.value = true;
  error.value = null;
  try {
    await props.remove(deleteSites.value);
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
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

.delete__stays {
  font-weight: 700;
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

.delete__word {
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
