<template>
  <component
    :is="tag"
    class="bohr-button"
    :class="[
      `bohr-button--${variant}`,
      `bohr-button--${size}`,
      `bohr-button--${color}`,
      {
        'bohr-button--danger': danger,
        'bohr-button--full-width': fullWidth,
        'is-disabled': disabled,
      },
    ]"
    v-bind="elementAttrs"
  >
    <span v-if="$slots.iconLeft" class="bohr-button__icon" aria-hidden="true">
      <slot name="iconLeft" />
    </span>
    <span class="bohr-button__text"><slot /></span>
    <span v-if="$slots.iconRight" class="bohr-button__icon" aria-hidden="true">
      <slot name="iconRight" />
    </span>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AsProp, BohrButtonColor, BohrButtonSize, BohrButtonVariant } from '../types';

const props = withDefaults(
  defineProps<{
    size?: BohrButtonSize;
    variant?: BohrButtonVariant;
    color?: BohrButtonColor;
    danger?: boolean;
    fullWidth?: boolean;
    /** Renders an <a> pointing here. */
    href?: string;
    /** Custom root (e.g. RouterLink); extra attributes such as `to` fall through. */
    as?: AsProp;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
  }>(),
  { size: 'md', variant: 'default', color: 'primary', type: 'button' },
);

const tag = computed(() => props.as ?? (props.href !== undefined ? 'a' : 'button'));

const elementAttrs = computed(() => {
  if (tag.value === 'button') return { type: props.type, disabled: props.disabled || undefined };
  if (tag.value === 'a') {
    // A disabled link keeps its look but loses its destination.
    return props.disabled ? { role: 'link', 'aria-disabled': 'true' } : { href: props.href };
  }
  return { 'aria-disabled': props.disabled ? 'true' : undefined };
});
</script>

<style scoped>
.bohr-button {
  --c1: var(--bohr-hsl-orange);
  --c2: var(--bohr-hsl-red);
  --text: var(--bohr-hsl-white);
  --highlight: var(--bohr-hsl-yellow);

  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 0;
  overflow: hidden;
  border: none;
  border-radius: var(--bohr-radius-xs);
  font-family: inherit;
  font-weight: 700;
  letter-spacing: 0.25px;
  text-align: center;
  text-decoration: none;
  text-transform: uppercase;
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--bohr-transition),
    color var(--bohr-transition),
    box-shadow var(--bohr-transition);
}

/* Colors */
.bohr-button--primary {
  --c1: var(--bohr-hsl-orange);
  --c2: var(--bohr-hsl-red);
  --text: var(--bohr-hsl-white);
  --highlight: var(--bohr-hsl-yellow);
}

.bohr-button--secondary {
  --c1: var(--bohr-hsl-cyan);
  --c2: var(--bohr-hsl-green);
  --text: var(--bohr-hsl-black);
  --highlight: 131 89% 59%;
}

.bohr-button--tertiary {
  --c1: 45 91% 52%;
  --c2: 45 91% 52%;
  --text: var(--bohr-hsl-black);
  --highlight: var(--bohr-hsl-yellow);
}

.bohr-button--black {
  --c1: var(--bohr-hsl-black);
  --c2: var(--bohr-hsl-black);
  --text: var(--bohr-hsl-white);
  --highlight: var(--bohr-hsl-white);
}

/* Sizes */
.bohr-button--sm {
  padding: 11px 16px;
  font-size: 12px;
  line-height: 14px;
}

.bohr-button--md {
  padding: 13px 24px;
  font-size: 12px;
  line-height: 14px;
}

.bohr-button--lg {
  padding: 15px 32px;
  font-size: 16px;
  line-height: 18px;
}

.bohr-button--full-width {
  width: 100%;
}

.bohr-button__text,
.bohr-button__icon {
  position: relative;
  z-index: 1;
}

.bohr-button__icon {
  display: grid;
  place-content: center;
  width: 12px;
  height: 12px;
}

.bohr-button--lg .bohr-button__icon {
  width: 16px;
  height: 16px;
}

.bohr-button:not(.is-disabled):hover .bohr-button__icon,
.bohr-button:not(.is-disabled):hover .bohr-button__text {
  filter: drop-shadow(0 0 5px hsl(var(--highlight)));
}

.bohr-button:not(.is-disabled):active {
  box-shadow: var(--bohr-shadow-pressed);
}

.bohr-button:focus-visible {
  outline: 2px solid hsl(var(--highlight));
  outline-offset: 2px;
}

.bohr-button.is-disabled {
  cursor: not-allowed;
}

.bohr-button.is-disabled .bohr-button__icon {
  filter: brightness(0);
}

/* Default variant: vertical gradient fill */
.bohr-button--default {
  color: hsl(var(--text));
  background-image: linear-gradient(180deg, hsl(var(--c1)) 0%, hsl(var(--c2)) 100%);
}

.bohr-button--default:not(.is-disabled):hover,
.bohr-button--default:not(.is-disabled):focus-visible {
  background-image:
    linear-gradient(0deg, hsl(var(--c2) / 0.5), hsl(var(--c2) / 0.5)),
    linear-gradient(180deg, hsl(var(--c1)) 0%, hsl(var(--c2)) 100%);
}

.bohr-button--default.bohr-button--danger {
  color: #fff;
  background: var(--bohr-color-red);
}

.bohr-button--default.bohr-button--danger:not(.is-disabled):hover,
.bohr-button--default.bohr-button--danger:not(.is-disabled):focus-visible {
  background: var(--bohr-color-red-dark);
}

.bohr-button--default.is-disabled {
  color: #000;
  background: #666;
}

/* Ghost variant: gradient hairline border */
.bohr-button--ghost {
  background: none;
}

.bohr-button--ghost::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid;
  border-image-slice: 1;
  border-image-source: linear-gradient(180deg, hsl(var(--c1)) 0%, hsl(var(--c2)) 100%);
  pointer-events: none;
}

.bohr-button--ghost:not(.is-disabled):hover,
.bohr-button--ghost:not(.is-disabled):focus-visible {
  color: hsl(var(--text));
  background-image: linear-gradient(180deg, hsl(var(--c1) / 0.75) 0%, hsl(var(--c2) / 0.75) 100%);
}

.bohr-button--ghost.bohr-button--danger {
  color: var(--bohr-color-red);
}

.bohr-button--ghost.bohr-button--danger::after {
  border-image-source: none;
  border-color: var(--bohr-color-red);
}

.bohr-button--ghost.bohr-button--danger:not(.is-disabled):hover,
.bohr-button--ghost.bohr-button--danger:not(.is-disabled):focus-visible {
  color: #000;
  background: var(--bohr-color-red);
}

/* Text variant */
.bohr-button--text {
  color: inherit;
  background: none;
}

.bohr-button--text:not(.is-disabled):hover,
.bohr-button--text:not(.is-disabled):focus-visible {
  color: hsl(var(--text));
  background-color: hsl(var(--c1));
}

.bohr-button--text.bohr-button--danger {
  color: var(--bohr-color-red);
}

.bohr-button--text.bohr-button--danger:not(.is-disabled):hover,
.bohr-button--text.bohr-button--danger:not(.is-disabled):focus-visible {
  color: #000;
  background-color: var(--bohr-color-red);
}

.bohr-button--ghost.is-disabled,
.bohr-button--text.is-disabled {
  color: #666;
}

.bohr-button--ghost.is-disabled::after,
.bohr-button--text.is-disabled::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid #666;
  border-image-source: none;
}
</style>
