<template>
  <component
    :is="tag"
    class="bohr-box"
    :class="[`bohr-box--${variant}`, color && `bohr-box--${color}`, { 'bohr-box--interactive': interactive }]"
    :type="tag === 'button' ? 'button' : undefined"
  >
    <slot />
    <svg
      v-if="!shadowless"
      class="bohr-box__shadow"
      viewBox="0 0 20 20"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="10" fill="black" />
    </svg>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AsProp, BohrBoxColor, BohrBoxVariant } from '../types';

const props = withDefaults(
  defineProps<{
    variant?: BohrBoxVariant;
    /** Tints the outline (and the glass border) with a section color. */
    color?: BohrBoxColor;
    /** Hover and focus get the red glow and the gradient ring. */
    interactive?: boolean;
    /** Hides the blurred floor shadow under the box. */
    shadowless?: boolean;
    /** Root element; defaults to <button> when interactive, <div> otherwise. */
    as?: AsProp;
  }>(),
  { variant: 'outline' },
);

const tag = computed(() => props.as ?? (props.interactive ? 'button' : 'div'));
</script>

<style scoped>
.bohr-box {
  --bohr-box-radius: var(--bohr-radius-md);
  --box-color: var(--bohr-hsl-white);

  position: relative;
  /* Keeps the glow layers (z-index: -1) inside the box, above any background. */
  isolation: isolate;
  border-radius: var(--bohr-box-radius);
}

.bohr-box--orange {
  --box-color: var(--bohr-hsl-orange);
}

.bohr-box--green {
  --box-color: var(--bohr-hsl-green);
}

.bohr-box--purple {
  --box-color: var(--bohr-hsl-purple);
}

.bohr-box--red,
.bohr-box--outline-danger {
  --box-color: var(--bohr-hsl-red);
}

.bohr-box--outline-highlight {
  --box-color: var(--bohr-hsl-highlight);
}

.bohr-box::before,
.bohr-box::after {
  pointer-events: none;
}

/* Floor shadow */
.bohr-box__shadow {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: -1;
  width: 100%;
  height: 14px;
  border-radius: 100%;
  filter: blur(15px);
  pointer-events: none;
}

/* Outline variants: hairline border, glowing top and bottom edges, faint vertical tint */
.bohr-box--outline,
.bohr-box--outline-danger,
.bohr-box--outline-highlight,
.bohr-box--glass {
  border: 1px solid hsl(var(--box-color) / 0.1);
}

.bohr-box--outline::after,
.bohr-box--outline-danger::after,
.bohr-box--outline-highlight::after {
  --edges:
    radial-gradient(100% 2px at top, #000 0, transparent 60%),
    linear-gradient(180deg, transparent, rgb(0 0 0 / 0.05)),
    radial-gradient(100% 2px at bottom, #000 0, transparent 60%);

  content: "";
  position: absolute;
  inset: -1px;
  z-index: -1;
  border-radius: inherit;
  background-color: hsl(var(--box-color));
  transition: background-color var(--bohr-transition);
  -webkit-mask-image: var(--edges);
  mask-image: var(--edges);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

.bohr-box--outline-danger::after,
.bohr-box--outline-highlight::after {
  --edges:
    radial-gradient(100% 2px at top, #000 0, transparent 60%),
    linear-gradient(180deg, transparent, rgb(0 0 0 / 0.05)),
    radial-gradient(100% 100px at 50% 45.5px, rgb(0 0 0 / 0.2), transparent),
    radial-gradient(100% 2px at bottom, #000 0, transparent 60%);
}

/* Glass variant: diagonal shine and a double inner ring */
.bohr-box--glass::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background-image: var(--bohr-gradient-glass-shine);
  box-shadow: var(--bohr-shadow-glass);
}

/* Interactive: red glow and gradient ring on hover and keyboard focus */
.bohr-box--interactive {
  display: block;
  width: 100%;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: inherit;
  text-decoration: none;
  background: none;
  cursor: pointer;
  transition: box-shadow var(--bohr-transition);
}

.bohr-box--interactive:hover,
.bohr-box--interactive:focus-visible {
  outline: none;
  box-shadow: var(--bohr-shadow-glow);
}

.bohr-box--interactive::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  border: 2px solid transparent;
  border-radius: inherit;
  background: var(--bohr-gradient-ring) border-box;
  -webkit-mask:
    linear-gradient(#fff 0 0) padding-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) padding-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity var(--bohr-transition);
}

.bohr-box--interactive:hover::before,
.bohr-box--interactive:focus-visible::before {
  opacity: 1;
}
</style>
