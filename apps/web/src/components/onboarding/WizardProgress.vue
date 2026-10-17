<template>
  <nav class="wizard-progress" :aria-label="t('wizard.progressLabel')">
    <ol role="list" class="wizard-progress__list">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="wizard-progress__item"
        :class="{ 'is-done': isDone(index), 'is-current': step.id === current }"
        :aria-current="step.id === current ? 'step' : undefined"
      >
        <span class="wizard-progress__marker" aria-hidden="true">
          <CheckIcon v-if="isDone(index)" :size="12" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="wizard-progress__label">{{ step.label }}</span>
        <span v-if="isDone(index)" class="bohr-visually-hidden">{{ t('wizard.phaseDone') }}</span>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { CheckIcon } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// The steps of a flow (the onboarding, a new project), the done ones checked.
const props = defineProps<{
  steps: { id: string; label: string }[];
  /** Null when every step is done. */
  current: string | null;
}>();

const { t } = useI18n();
const currentIndex = computed(() =>
  props.current === null ? props.steps.length : props.steps.findIndex((step) => step.id === props.current),
);

function isDone(index: number) {
  return index < currentIndex.value;
}
</script>

<style scoped>
.wizard-progress__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 4px;
}

.wizard-progress__item {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  gap: 10px;
  min-width: 120px;
  padding: 10px 12px;
  border-bottom: 2px solid hsl(0 0% 100% / 0.12);
  font-size: 14px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
}

.wizard-progress__item.is-done {
  border-bottom-color: hsl(var(--bohr-hsl-green) / 0.6);
  color: #fff;
}

.wizard-progress__item.is-current {
  border-bottom-color: var(--bohr-color-frame);
  color: #fff;
}

.wizard-progress__marker {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid hsl(0 0% 100% / 0.3);
  border-radius: var(--bohr-radius-full);
  font-size: 12px;
}

.is-done .wizard-progress__marker {
  border-color: transparent;
  color: #0e171d;
  background: var(--bohr-gradient-secondary);
}

.is-current .wizard-progress__marker {
  border-color: transparent;
  background: var(--bohr-gradient-primary);
}

@media (max-width: 639px) {
  .wizard-progress__list {
    flex-wrap: nowrap;
  }

  .wizard-progress__item {
    flex: 0 0 auto;
    min-width: 0;
    padding-inline: 4px;
  }

  /* The current step takes the room its label needs. */
  .wizard-progress__item.is-current {
    flex: 1 1 auto;
  }

  /* Only the current label on small screens; the markers keep the count. */
  .wizard-progress__item:not(.is-current) .wizard-progress__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
