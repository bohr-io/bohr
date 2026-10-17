<template>
  <WizardStep step="github" :title="t('wizard.github.title')">
    <p class="card-text">{{ t('wizard.github.text') }}</p>
    <p class="card-text">{{ t('wizard.github.newTab') }}</p>

    <p v-if="onboarding.github.installUrl === null" class="notice notice--warn github__notice">
      {{ t('wizard.github.unavailable') }}
    </p>
    <div class="actions github__actions">
      <BohrButton
        v-if="onboarding.github.installUrl !== null"
        :href="onboarding.github.installUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <template #iconLeft><GithubIcon :size="12" /></template>
        {{ t('wizard.github.install') }}
      </BohrButton>
      <BohrButton variant="ghost" :disabled="checking" @click="check">
        {{ checking ? t('common.checking') : t('wizard.github.done') }}
      </BohrButton>
    </div>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton, GithubIcon } from '@bohr/ui';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Onboarding } from '../../api';
import WizardStep from './WizardStep.vue';

const props = defineProps<{
  onboarding: Onboarding;
  /** Reloads GET /api/onboarding; the wizard moves on once the installation is known. */
  refresh: () => Promise<void>;
}>();

const { t } = useI18n();
const checking = ref(false);

async function check() {
  checking.value = true;
  try {
    await props.refresh();
  } finally {
    checking.value = false;
  }
}

// The installation happens in another tab: look again when the user comes back to this one.
function onVisibility() {
  if (document.visibilityState === 'visible' && !checking.value) void check();
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility));
</script>

<style scoped>
.github__notice {
  margin-top: 20px;
}

.github__actions {
  margin-top: 24px;
}
</style>
