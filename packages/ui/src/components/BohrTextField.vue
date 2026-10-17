<template>
  <div class="bohr-text-field" :style="{ '--validation-color': validationColor }">
    <label v-if="label" :for="inputId" class="bohr-text-field__label">
      {{ label }}<span v-if="required" class="bohr-text-field__required" aria-hidden="true">*</span>
    </label>
    <BohrSkeleton :loading="loading">
      <div class="bohr-text-field__control">
        <input
          :id="inputId"
          ref="input"
          v-bind="$attrs"
          class="bohr-text-field__input"
          :class="{
            'has-toggle': type === 'password' && !hideVisibilityToggle,
            'has-validation': Boolean(validationStatus),
            'has-error': invalid,
          }"
          :type="inputType"
          :value="model"
          :required="required"
          :aria-invalid="invalid || undefined"
          @input="model = ($event.target as HTMLInputElement).value"
        />
        <div class="bohr-text-field__addons">
          <component :is="validationIcon" v-if="validationIcon" :size="14" :color="validationColor" />
          <button
            v-if="type === 'password' && !hideVisibilityToggle"
            type="button"
            class="bohr-text-field__toggle"
            :aria-label="toggleLabel"
            :title="toggleLabel"
            :aria-pressed="isTextVisible"
            @click="isTextVisible = !isTextVisible"
          >
            <EyeIcon :slashed="isTextVisible" />
          </button>
        </div>
      </div>
    </BohrSkeleton>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from 'vue';
import { CheckIcon, EyeIcon, WaitIcon, XIcon } from '../icons';
import type { ValidationStatus } from '../types';
import BohrSkeleton from './BohrSkeleton.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    id?: string;
    type?: 'text' | 'password' | 'email' | 'number';
    validationStatus?: ValidationStatus;
    hasError?: boolean;
    autoFocus?: boolean;
    loading?: boolean;
    required?: boolean;
    hideVisibilityToggle?: boolean;
    toggleLabel?: string;
  }>(),
  { type: 'text', validationStatus: '', toggleLabel: 'Toggle visibility' },
);

const model = defineModel<string | number>();

const VALIDATION_COLORS: Record<ValidationStatus, string> = {
  '': 'hsl(0 0% 100%)',
  error: 'hsl(355 78% 60%)',
  warn: 'hsl(47 89% 59%)',
  success: 'hsl(131 67% 60%)',
};
const VALIDATION_ICONS = { error: XIcon, warn: WaitIcon, success: CheckIcon } as const;

const fallbackId = useId();
const inputId = computed(() => props.id ?? fallbackId);
const input = useTemplateRef<HTMLInputElement>('input');
const isTextVisible = ref(false);

const inputType = computed(() => (props.type === 'password' && isTextVisible.value ? 'text' : props.type));
const validationColor = computed(() => VALIDATION_COLORS[props.validationStatus]);
const validationIcon = computed(() => (props.validationStatus ? VALIDATION_ICONS[props.validationStatus] : null));
const invalid = computed(() => props.hasError || props.validationStatus === 'error');

function focus() {
  input.value?.focus();
}

onMounted(() => {
  if (props.autoFocus) nextTick(focus);
});

defineExpose({ focus });
</script>

<style scoped>
.bohr-text-field {
  position: relative;
  display: inline-block;
  font-size: 12px;
}

.bohr-text-field__label {
  display: block;
  margin-bottom: 8px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--validation-color);
}

.bohr-text-field__required {
  margin-left: 2px;
  color: var(--bohr-color-red);
}

.bohr-text-field__control {
  position: relative;
}

.bohr-text-field__input {
  width: 100%;
  height: 40px;
  padding: 13px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-sm);
  color: inherit;
  background: linear-gradient(180deg, transparent 0%, hsl(0 0% 100% / 0.05) 100%);
  outline-offset: 2px;
}

.bohr-text-field__input.has-toggle {
  padding-right: 44px;
}

.bohr-text-field__input.has-validation {
  border-color: var(--validation-color);
}

.bohr-text-field__input.has-error {
  border: 1px solid hsl(355 78% 60% / 0.5);
  background: linear-gradient(180deg, transparent 0%, hsl(355 78% 60% / 0.1) 100%);
}

.bohr-text-field__addons {
  position: absolute;
  top: 50%;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  transform: translateY(-50%);
}

.bohr-text-field__toggle {
  padding: 0;
  font-size: 0;
  background: none;
  border: none;
  opacity: 0.3;
  transition: opacity var(--bohr-transition);
}

.bohr-text-field__toggle:hover,
.bohr-text-field__toggle:focus-visible {
  opacity: 0.7;
}
</style>
