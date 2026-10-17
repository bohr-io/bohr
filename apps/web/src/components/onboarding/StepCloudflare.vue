<template>
  <WizardStep step="cloudflare" :title="t('wizard.cloudflare.title')">
    <p class="card-text">{{ org ? t('orgs.setup.cloudflareText') : t('wizard.cloudflare.text') }}</p>

    <ol class="wizard-steps">
      <li>
        {{ t('wizard.cloudflare.step1') }}
        <div class="cloudflare__link">
          <BohrButton size="sm" variant="ghost" :href="onboarding.cloudflare.tokenTemplateUrl" target="_blank" rel="noopener noreferrer">
            <template #iconLeft><NewWindowIcon :size="12" /></template>
            {{ t('wizard.cloudflare.openTemplate') }}
          </BohrButton>
        </div>
      </li>
      <li>{{ t('wizard.cloudflare.step2') }}</li>
    </ol>
    <!-- Optional: without Containers the agent runs in bohr's account (Cloud) or waits for the upgrade (self-hosted) -->
    <p class="field-hint cloudflare__agent" data-note="containers">
      <I18nT keypath="wizard.cloudflare.agentNote" scope="global">
        <template #permission>
          <strong class="cloudflare__permission">{{ t('wizard.cloudflare.containersPermission') }}</strong>
        </template>
      </I18nT>
    </p>

    <div v-if="missing !== null" class="notice notice--error cloudflare__missing" role="alert">
      <strong class="notice__title">{{ t('wizard.cloudflare.missingTitle') }}</strong>
      <ul class="cloudflare__missing-list">
        <li v-for="capability in missing.missing" :key="capability">
          {{ t(`wizard.capabilities.${capability}`) }}
          <span v-if="missing.errors[capability]" class="cloudflare__detail">{{ missing.errors[capability] }}</span>
        </li>
      </ul>
      <p>{{ t('wizard.cloudflare.missingHint') }}</p>
    </div>

    <form class="form" novalidate @submit.prevent="submit">
      <div class="form-field">
        <BohrTextField
          ref="field"
          v-model="token"
          type="password"
          :label="t('wizard.cloudflare.tokenLabel')"
          :toggle-label="t('common.toggleVisibility')"
          :has-error="error !== null"
          autocomplete="off"
          spellcheck="false"
          required
          :aria-describedby="error !== null ? `${id}-error` : `${id}-hint`"
        />
        <p v-if="error !== null" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>
        <p :id="`${id}-hint`" class="field-hint">{{ t('wizard.cloudflare.tokenHint') }}</p>
      </div>
      <div class="actions">
        <BohrButton type="submit" :disabled="busy">
          {{ busy ? t('wizard.cloudflare.checking') : t('wizard.cloudflare.connect') }}
        </BohrButton>
      </div>
    </form>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField, NewWindowIcon } from '@bohr/ui';
import { nextTick, ref, useId, useTemplateRef } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { api, type CloudflareResult, type Onboarding } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { CLOUDFLARE_TOKEN_PATTERN } from '../../lib/validation';
import WizardStep from './WizardStep.vue';

const props = defineProps<{
  onboarding: Pick<Onboarding, 'cloudflare'>;
  /** An organization's slug: connects the organization's Cloudflare account instead of the user's. */
  org?: string;
  /** Permissions the last token lacked, kept by the wizard across steps. */
  missing: Extract<CloudflareResult, { status: 'missing' }> | null;
}>();

const emit = defineEmits<{ result: [result: CloudflareResult] }>();

const { t } = useI18n();
const errorText = useErrorText();
const id = `cloudflare-${useId()}`;
const field = useTemplateRef<{ focus: () => void }>('field');
const token = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  const value = token.value.trim();
  error.value = null;
  if (!CLOUDFLARE_TOKEN_PATTERN.test(value)) {
    error.value = t('wizard.cloudflare.invalidFormat');
    await nextTick();
    field.value?.focus();
    return;
  }
  busy.value = true;
  try {
    const result = props.org ? await api.connectOrgCloudflare(props.org, value) : await api.connectCloudflare(value);
    token.value = '';
    emit('result', result);
  } catch (caught) {
    error.value = errorText(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.cloudflare__link {
  margin-top: 10px;
}

.cloudflare__agent {
  margin-top: 12px;
}

.cloudflare__permission {
  color: var(--bohr-color-yellow);
}

.cloudflare__missing {
  margin-top: 24px;
}

.cloudflare__missing-list {
  display: grid;
  gap: 6px;
  margin: 8px 0;
  padding-left: 20px;
}

.cloudflare__detail {
  display: block;
  font-size: 12px;
  color: var(--bohr-color-text-muted);
}
</style>
