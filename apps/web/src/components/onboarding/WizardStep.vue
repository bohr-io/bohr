<template>
  <section class="wizard-step" :data-step="step" :aria-labelledby="headingId">
    <SettingsCard>
      <h2 :id="headingId" class="card-title wizard-step__title" tabindex="-1">{{ title }}</h2>
      <slot />
    </SettingsCard>
  </section>
</template>

<script setup lang="ts">
import { SettingsCard } from '@bohr/ui';
import { useId } from 'vue';

defineProps<{
  /** Wizard view name, also exposed as data-step. */
  step: string;
  title: string;
}>();

const headingId = `wizard-step-${useId()}`;
</script>

<style scoped>
.wizard-step__title {
  font-size: clamp(22px, 3vw, 28px);
}

.wizard-step__title:focus {
  outline: none;
}

.wizard-step :deep(.wizard-steps) {
  display: grid;
  gap: 14px;
  margin: 20px 0 0;
  padding-left: 22px;
  line-height: 1.55;
}

.wizard-step :deep(.wizard-steps li::marker) {
  font-weight: 700;
  color: var(--bohr-color-amber);
}
</style>
