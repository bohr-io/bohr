<template>
  <component :is="as ?? 'a'" :href="href" class="bohr-new-site" :aria-label="withText ? undefined : label">
    <PlusIcon gradient :size="32" />
    <BohrTypography v-if="withText" variant="title3" class="bohr-new-site__text">{{ label }}</BohrTypography>
  </component>
</template>

<script setup lang="ts">
import { PlusIcon } from '../icons';
import type { AsProp } from '../types';
import BohrTypography from './BohrTypography.vue';

withDefaults(
  defineProps<{
    label?: string;
    /** Shows the label next to the plus sign; otherwise it is only the accessible name. */
    withText?: boolean;
    href?: string;
    /** Custom root (e.g. RouterLink); pass `to` as an attribute. */
    as?: AsProp;
  }>(),
  { label: 'New project' },
);
</script>

<style scoped>
.bohr-new-site {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1.75;
  border: 2px dashed hsl(0 0% 100% / 0.2);
  border-radius: var(--bohr-radius-sm);
  color: inherit;
  text-decoration: none;
  background-color: hsl(0 0% 0% / 0.2);
  cursor: pointer;
  transition: box-shadow var(--bohr-transition);
}

.bohr-new-site:hover,
.bohr-new-site:focus-visible {
  outline: none;
  box-shadow: 0 12px 36px 0 rgb(255 0 13 / 0.3);
}

/* Gradient ring over the dashed border */
.bohr-new-site::before {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: 2;
  border: 2px solid transparent;
  border-radius: var(--bohr-radius-sm);
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
  pointer-events: none;
  transition: opacity var(--bohr-transition);
}

.bohr-new-site:hover::before,
.bohr-new-site:focus-visible::before {
  opacity: 1;
}

.bohr-new-site__text {
  margin-left: 24px;
}
</style>
