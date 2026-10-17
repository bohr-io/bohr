<template>
  <WizardStep step="cloudflare_account" :title="t('wizard.account.title')">
    <p class="card-text">{{ t('wizard.account.text') }}</p>

    <form class="form" @submit.prevent="submit">
      <fieldset class="accounts">
        <legend class="field-label">{{ t('wizard.account.legend') }}</legend>
        <label v-for="account in onboarding.pendingAccounts" :key="account.id" class="accounts__option">
          <input v-model="selected" type="radio" name="cloudflare-account" :value="account.id" class="accounts__radio" />
          <span class="accounts__name">{{ account.name }}</span>
          <span class="accounts__id">{{ account.id }}</span>
        </label>
      </fieldset>
      <p v-if="error !== null" class="field-error" role="alert">{{ error }}</p>
      <div class="actions">
        <BohrButton type="submit" :disabled="busy || selected === null">
          {{ busy ? t('wizard.cloudflare.checking') : t('wizard.account.use') }}
        </BohrButton>
        <BohrButton variant="text" @click="emit('pasteToken')">{{ t('wizard.account.otherToken') }}</BohrButton>
      </div>
    </form>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type CloudflareResult, type Onboarding } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import WizardStep from './WizardStep.vue';

const props = defineProps<{
  onboarding: Pick<Onboarding, 'pendingAccounts'>;
  /** An organization's slug: the account becomes the organization's. */
  org?: string;
}>();
const emit = defineEmits<{ result: [result: CloudflareResult]; pasteToken: [] }>();

const { t } = useI18n();
const errorText = useErrorText();
const selected = ref<string | null>(props.onboarding.pendingAccounts[0]?.id ?? null);
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  if (selected.value === null) return;
  busy.value = true;
  error.value = null;
  try {
    emit(
      'result',
      props.org
        ? await api.chooseOrgCloudflareAccount(props.org, selected.value)
        : await api.chooseCloudflareAccount(selected.value),
    );
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.accounts {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
}

.accounts__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 2px 12px;
  padding: 12px 14px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: var(--bohr-radius-md);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.accounts__option:hover,
.accounts__option:has(:checked) {
  border-color: var(--bohr-color-frame);
}

.accounts__radio {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.accounts__name {
  font-weight: 700;
}

.accounts__id {
  overflow: hidden;
  font-family: var(--bohr-font-family-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  color: var(--bohr-color-text-muted);
}
</style>
