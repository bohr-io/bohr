<template>
  <div class="bohr-page-title">
    <BohrTypography v-if="path" variant="title3" color="hsl(47 62% 47%)" class="bohr-page-title__path">
      {{ path }}
    </BohrTypography>
    <BohrTypography
      :tag="tag"
      variant="title1"
      color="var(--bohr-color-yellow)"
      class="bohr-page-title__title"
      :class="{ 'is-capitalized': capitalize }"
    >
      {{ title }}<slot />
    </BohrTypography>
    <span class="bohr-page-title__shadow" :style="shadowStyle" aria-hidden="true">{{ shadowText ?? title }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BohrTypography from './BohrTypography.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    /** Breadcrumb shown above the title, prefixed with a slash. */
    path?: string;
    /** Giant word behind the title; defaults to the title. Always lowercase. */
    shadowText?: string;
    /** Extra vertical offset for the shadow word, e.g. "20px". */
    shadowOffset?: string;
    capitalize?: boolean;
    tag?: string;
  }>(),
  { tag: 'h1' },
);

const shadowStyle = computed(() => ({
  top: props.shadowOffset ? `calc(-0.3em + ${props.shadowOffset})` : '-0.3em',
}));
</script>

<style scoped>
.bohr-page-title {
  position: relative;
  z-index: 0;
}

.bohr-page-title__path::before {
  content: "/";
  margin-right: 4px;
  font-size: 18px;
  color: #625217;
}

.bohr-page-title__title.is-capitalized {
  text-transform: capitalize;
}

.bohr-page-title__shadow {
  position: absolute;
  left: 0.02em;
  z-index: -1;
  font-size: clamp(120px, 26vw, 240px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.1em;
  text-transform: lowercase;
  white-space: nowrap;
  color: #000;
  opacity: 0.1;
  pointer-events: none;
  user-select: none;
}
</style>
