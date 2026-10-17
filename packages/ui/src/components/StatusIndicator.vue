<template>
  <span class="bohr-status" :class="`bohr-status--${status}`" role="img" :aria-label="name" :title="name">
    <span class="bohr-status__dot" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DeployStatus } from '../types';

const props = withDefaults(
  defineProps<{
    status?: DeployStatus;
    /** Accessible name and tooltip; defaults to "Status: <status>". */
    label?: string;
  }>(),
  { status: 'off' },
);

const name = computed(() => props.label ?? `Status: ${props.status}`);
</script>

<style scoped>
.bohr-status {
  --background: #000;
  --shadow-color: #000;

  position: relative;
  display: inline-grid;
  place-items: center;
  width: 17px;
  height: 17px;
}

.bohr-status__dot {
  width: 15px;
  height: 15px;
  border: 1px solid rgb(255 255 255 / 0.5);
  border-radius: 100%;
  background: var(--background);
  box-shadow: 0 0 25px 1px var(--shadow-color);
}

.bohr-status--success {
  --background: var(--bohr-gradient-secondary);
  --shadow-color: var(--bohr-color-green);
}

.bohr-status--warning {
  --background: var(--bohr-gradient-warn);
  --shadow-color: var(--bohr-color-amber);
}

.bohr-status--error {
  --background: var(--bohr-gradient-primary);
  --shadow-color: var(--bohr-color-orange);
}
</style>
