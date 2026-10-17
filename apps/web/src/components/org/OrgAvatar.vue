<template>
  <span class="org-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` }" aria-hidden="true">
    <img v-if="url && !failed" :src="url" alt="" :width="size" :height="size" class="org-avatar__image" @error="failed = true" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

// The picture of an organization or a GitHub user (decorative: the name is always next to it), or its
// initial when there is none or it does not load.
const props = withDefaults(defineProps<{ name: string; url?: string | null; size?: number }>(), {
  url: null,
  size: 32,
});

const failed = ref(false);
watch(
  () => props.url,
  () => {
    failed.value = false;
  },
);
const initial = computed(() => (props.name.trim()[0] ?? '?').toUpperCase());
</script>

<style scoped>
.org-avatar {
  display: inline-grid;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  font-weight: 700;
  line-height: 1;
  color: #0e171d;
  background: var(--bohr-gradient-secondary);
}

.org-avatar__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
