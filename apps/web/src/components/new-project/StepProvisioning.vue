<template>
  <WizardStep step="provisioning" :title="t('newProject.provisioning.title')">
    <p class="card-text">{{ t('newProject.provisioning.text') }}</p>
    <RuntimeProgress :project-id="projectId" @ready="emit('ready')" />
  </WizardStep>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import WizardStep from '../onboarding/WizardStep.vue';
import RuntimeProgress from '../RuntimeProgress.vue';

defineProps<{ projectId: string }>();
const emit = defineEmits<{ ready: [] }>();

const { t } = useI18n();
</script>
