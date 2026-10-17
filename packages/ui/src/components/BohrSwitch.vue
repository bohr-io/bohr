<template>
  <div class="bohr-switch">
    <label v-if="label" :for="inputId" class="bohr-switch__label">{{ label }}</label>
    <input
      :id="inputId"
      v-model="model"
      v-bind="$attrs"
      class="bohr-switch__input"
      type="checkbox"
      role="switch"
      :disabled="disabled"
      :aria-readonly="readonly || undefined"
      @click="onClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  id?: string;
  label?: string;
  /** Keeps the current value; unlike `disabled`, it stays focusable. */
  readonly?: boolean;
  disabled?: boolean;
}>();

const model = defineModel<boolean>({ default: false });

const fallbackId = useId();
const inputId = computed(() => props.id ?? fallbackId);

function onClick(event: MouseEvent) {
  if (props.readonly) event.preventDefault();
}
</script>

<style scoped>
.bohr-switch {
  display: inline-block;
}

.bohr-switch__label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.bohr-switch__input {
  position: relative;
  display: block;
  width: 40px;
  height: 20px;
  margin-block: 9px;
  border: 1px solid hsl(0 0% 100%);
  border-radius: var(--bohr-radius-full);
  appearance: none;
  cursor: pointer;
}

.bohr-switch__input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bohr-switch__input[aria-readonly="true"] {
  cursor: default;
}

.bohr-switch__input::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-image: var(--bohr-gradient-primary);
  opacity: 0;
  transition: opacity var(--bohr-transition);
}

.bohr-switch__input:checked::before {
  opacity: 1;
}

.bohr-switch__input::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: var(--bohr-radius-full);
  background-color: hsl(0 0% 100%);
  transition: transform var(--bohr-transition);
}

.bohr-switch__input:checked::after {
  transform: translateX(20px);
}
</style>
