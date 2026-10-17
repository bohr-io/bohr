<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="bohr-animated-logo"
    :class="{ 'is-paused': paused }"
    viewBox="0 0 64 64"
    focusable="false"
    :role="title ? 'img' : undefined"
    :aria-hidden="title ? undefined : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <defs>
      <linearGradient :id="gradientId" gradientUnits="userSpaceOnUse" x1="31.9912" y1="0" x2="31.9912" y2="63.9824">
        <stop offset="0" stop-color="#f4cd3b" />
        <stop offset="0.54" stop-color="#f16622" />
        <stop offset="1" stop-color="#e84856" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="10" :fill="fill" />
    <!-- Inner ring turns counterclockwise, outer ring clockwise; the gradient turns with them, as in v1. -->
    <path class="bohr-animated-logo__ring is-reverse" :fill="fill" :d="INNER_RING" />
    <path class="bohr-animated-logo__ring" :fill="fill" :d="OUTER_RING" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

defineProps<{
  /** Freezes the rings. */
  paused?: boolean;
  /** Accessible name. Without it the logo is decorative. */
  title?: string;
}>();

const gradientId = `bohr-animated-logo-${useId()}`;
const fill = `url(#${gradientId})`;

const INNER_RING =
  'M32,8c0.8,0,1.5,0.7,1.5,1.5S32.8,11,32,11s-1.5-0.7-1.5-1.5S31.2,8,32,8z M32.1,53L32.1,53c-0.9,0-1.5,0.7-1.5,1.5S31.2,56,32,56l0,0c0.8,0,1.5-0.7,1.5-1.5S32.9,53,32.1,53z M27.3,52.4C27.3,52.4,27.2,52.4,27.3,52.4c-6.1-1.5-11.3-5.6-14.1-11.2c-2.8-5.9-2.8-12.7,0-18.6l0,0c2.8-5.6,8-9.7,14.1-11.2c0.3-0.1,0.5-0.4,0.4-0.7l0,0c-0.2-0.5-0.2-1-0.2-1.6c0-0.3-0.2-0.6-0.6-0.6c-0.1,0-0.1,0-0.2,0c-0.8,0.2-1.6,0.4-2.4,0.6c-6.5,2.2-11.7,7.1-14.5,13.4C4.7,34.9,10.5,49,22.7,54.1c1.3,0.6,2.7,1,4.1,1.3c0.3,0.1,0.6-0.1,0.7-0.5c0-0.1,0-0.1,0-0.2c0-0.5,0-1.1,0.2-1.6C27.8,52.9,27.6,52.5,27.3,52.4z M55.4,26.8c-0.3-1.4-0.7-2.7-1.3-4.1c-1.3-3.1-3.3-5.9-5.8-8.2s-5.4-4.1-8.7-5.2C38.8,9,38,8.8,37.2,8.7c-0.3-0.1-0.6,0.1-0.7,0.4c0,0.1,0,0.1,0,0.2c0,0.5,0,1.1-0.2,1.6c-0.1,0.3,0.1,0.6,0.4,0.7l0,0c6.1,1.5,11.2,5.6,14.1,11.2c1.4,2.9,2.1,6.1,2.1,9.3s-0.7,6.4-2.1,9.3c-2.8,5.6-8,9.7-14.1,11.2c-0.3,0.1-0.5,0.4-0.5,0.7l0,0c0.2,0.5,0.2,1.1,0.2,1.6c0,0.3,0.2,0.6,0.5,0.6c0.1,0,0.1,0,0.2,0C50.2,52.6,58.3,39.7,55.4,26.8z';

const OUTER_RING =
  'M52.5,52.4c-0.5,0.6-0.5,1.5,0,2c0.6,0.6,1.5,0.6,2.1,0.1c0.6-0.6,0.6-1.5,0-2.1C54,51.9,53.1,51.9,52.5,52.4z M9.3,9.3c-0.6,0.6-0.6,1.5,0,2.1c0.6,0.6,1.5,0.6,2.1,0c0.6-0.6,0.6-1.5,0-2.1C10.9,8.7,9.9,8.7,9.3,9.3z M11.2,52.3c-0.6-0.4-1.4-0.3-1.9,0.2s-0.6,1.3-0.2,1.9c0.1,0.1,0.1,0.2,0.2,0.3c0.1,0.1,0.2,0.2,0.3,0.2c0.7,0.4,1.6,0.2,2.1-0.5C12.1,53.6,11.9,52.7,11.2,52.3z M52.5,9.4L52.5,9.4c-0.5,0.5-0.6,1.3-0.2,1.9c0.1,0.1,0.1,0.2,0.2,0.2c0.1,0.1,0.1,0.1,0.2,0.2c0.6,0.4,1.4,0.3,1.9-0.2c0.6-0.6,0.6-1.5,0-2.1C54,8.8,53.1,8.8,52.5,9.4z M50.6,57.1c-0.4-0.4-0.8-0.8-1.1-1.3c-0.2-0.2-0.5-0.3-0.8-0.2c-10.1,7.2-23.6,7.2-33.6,0c-0.3-0.2-0.6-0.1-0.8,0.2l0,0c-0.4,0.5-0.7,0.9-1.2,1.3c-0.2,0.2-0.2,0.6,0,0.8l0,0c2.6,2,5.6,3.5,8.8,4.5c9.7,3.2,20.4,1.6,28.7-4.4c0.3-0.2,0.3-0.6,0.1-0.8C50.7,57.1,50.6,57.1,50.6,57.1z M62.3,22c-0.9-3.2-2.4-6.1-4.4-8.8c-0.2-0.2-0.6-0.2-0.9,0l0,0c-0.4,0.4-0.8,0.8-1.3,1.2c-0.3,0.2-0.3,0.5-0.2,0.8l0,0c7.2,10.1,7.2,23.5,0,33.6c-0.2,0.3-0.1,0.6,0.2,0.8v0.1c0.5,0.3,0.9,0.6,1.3,1.1c0.2,0.3,0.6,0.3,0.8,0.1l0.1-0.1C64,42.4,65.6,31.7,62.3,22z M8.4,48.8c-7.1-10.1-7.1-23.5,0-33.6c0.2-0.3,0.1-0.6-0.1-0.8l0,0l0,0c-0.5-0.3-0.9-0.7-1.3-1.1c-0.2-0.2-0.6-0.3-0.8-0.1l-0.1,0.1c-3.9,5.4-6,12-6,18.7c0,3.4,0.6,6.8,1.6,10c0.9,3.2,2.4,6.1,4.4,8.8c0.2,0.2,0.6,0.2,0.8,0l0,0c0.4-0.4,0.8-0.8,1.3-1.2C8.5,49.5,8.6,49.1,8.4,48.8L8.4,48.8z M50.8,6.1c-2.6-2-5.6-3.5-8.8-4.5C32.3-1.6,21.6,0.1,13.3,6C13,6.2,13,6.6,13.2,6.8l0.1,0.1c0.4,0.4,0.8,0.8,1.1,1.3c0.2,0.2,0.5,0.3,0.8,0.1v0.1c10.1-7.2,23.5-7.2,33.6,0c0.3,0.2,0.7,0.1,0.8-0.2l0,0c0.4-0.5,0.7-0.9,1.2-1.3C51,6.7,51,6.3,50.8,6.1L50.8,6.1z';
</script>

<style scoped>
.bohr-animated-logo {
  display: block;
  width: 64px;
  height: 64px;
}

.bohr-animated-logo__ring {
  transform-box: view-box;
  transform-origin: 50% 50%;
  animation: bohr-animated-logo-spin 5000ms linear infinite;
}

.bohr-animated-logo__ring.is-reverse {
  animation-direction: reverse;
}

.bohr-animated-logo.is-paused .bohr-animated-logo__ring {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .bohr-animated-logo__ring {
    animation: none;
  }
}

@keyframes bohr-animated-logo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
