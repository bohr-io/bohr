<template>
  <WizardStep step="bot" :title="t('newProject.bot.title')">
    <p class="card-text">{{ t('newProject.bot.text') }}</p>
    <BotTokenForm class="bot__form" :project-id="projectId" with-instructions primary @connected="emit('connected', $event)">
      <template #actions>
        <BohrButton variant="text" @click="emit('skip')">{{ t('newProject.bot.skip') }}</BohrButton>
      </template>
    </BotTokenForm>
    <p class="field-hint">{{ t('newProject.bot.skipHint') }}</p>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import BotTokenForm from '../BotTokenForm.vue';
import WizardStep from '../onboarding/WizardStep.vue';

// Optional: a Telegram bot for the project, from BotFather. The web chat works without it.
defineProps<{ projectId: string }>();
const emit = defineEmits<{ connected: [username: string]; skip: [] }>();

const { t } = useI18n();
</script>

<style scoped>
.bot__form {
  margin-top: 8px;
}
</style>
