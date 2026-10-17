<template>
  <WizardStep step="done" :title="t('wizard.done.title')">
    <p class="card-text">{{ t('wizard.done.text') }}</p>
    <p v-if="!agentConfigured" class="notice notice--warn done__notice" data-notice="agent">
      {{ t('wizard.done.agentMissing') }}
    </p>
    <p v-else class="card-text">{{ t('wizard.done.agentReady') }}</p>
    <div class="actions done__actions">
      <BohrButton :as="RouterLink" :to="{ name: 'new-project' }">{{ t('wizard.done.newProject') }}</BohrButton>
      <BohrButton :as="RouterLink" :to="{ name: 'account-agent' }" variant="ghost">
        {{ agentConfigured ? t('wizard.done.agentSettings') : t('wizard.done.configureAgent') }}
      </BohrButton>
    </div>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import WizardStep from './WizardStep.vue';

defineProps<{
  /** The user's agent settings exist (GET /api/onboarding's agent). */
  agentConfigured: boolean;
}>();

const { t } = useI18n();
</script>

<style scoped>
.done__notice {
  margin-top: 20px;
}

.done__actions {
  margin-top: 28px;
}
</style>
