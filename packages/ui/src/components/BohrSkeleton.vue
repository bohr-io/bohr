<template>
  <span
    class="bohr-skeleton"
    :class="{ 'is-loading': loading, 'is-inline': inline }"
    :style="loading ? { width, height, borderRadius: radius === 'circle' ? '9999px' : radius } : undefined"
    :aria-hidden="loading || undefined"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Covers the slot content with a shimmer; the content still gives the placeholder its size. */
    loading?: boolean;
    inline?: boolean;
    width?: string;
    height?: string;
    /** CSS radius, or "circle". */
    radius?: string;
  }>(),
  { loading: true, radius: '2px' },
);
</script>

<style scoped>
.bohr-skeleton {
  display: contents;
}

.bohr-skeleton.is-loading {
  position: relative;
  display: block;
  overflow: hidden;
  isolation: isolate;
}

.bohr-skeleton.is-loading.is-inline {
  display: inline-block;
  vertical-align: top;
}

.bohr-skeleton.is-loading::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background-image: linear-gradient(90deg, hsl(203 18% 60%), hsl(203 36% 33%), hsl(203 18% 60%));
  background-size: 300% 100%;
  animation: bohr-skeleton-shimmer 3s linear infinite;
}

@keyframes bohr-skeleton-shimmer {
  from {
    background-position: 0% 0%;
  }
  to {
    background-position: -300% 0%;
  }
}
</style>
