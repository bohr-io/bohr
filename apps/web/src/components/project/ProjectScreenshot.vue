<template>
  <!-- Shown once the picture loaded: until then (and for a project without one) the card keeps its usual look. -->
  <div
    v-if="src !== null && !failed"
    v-show="loaded"
    class="project-screenshot"
    :class="`project-screenshot--${variant}`"
    data-screenshot
    aria-hidden="true"
  >
    <img :src="src" alt="" decoding="async" @load="loaded = true" @error="failed = true" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ProjectSummary } from '../../api';
import { screenshotUrl } from '../../lib/screenshots';

// The picture of the project's production site that the instance takes (GET /api/projects/:id/screenshot). It is
// decorative: the card or row around it names the project.
const props = withDefaults(defineProps<{ project: ProjectSummary; variant?: 'card' | 'thumb' }>(), {
  variant: 'card',
});

const src = computed(() => screenshotUrl(props.project));
const loaded = ref(false);
const failed = ref(false);

watch(src, () => {
  loaded.value = false;
  failed.value = false;
});
</script>

<style scoped>
.project-screenshot {
  overflow: hidden;
  border: 1px solid hsl(0 0% 100% / 0.1);
  background: #0b1217;
}

.project-screenshot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  animation: project-screenshot-in var(--bohr-transition) both;
}

/* The card's background (bohr v1's site cards): the whole card, under a shade that keeps the text readable */
.project-screenshot--card {
  position: absolute;
  inset: 0;
  z-index: 0;
  border: none;
  border-radius: inherit;
  pointer-events: none;
}

.project-screenshot--card::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(0deg, rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.2)),
    linear-gradient(180deg, rgb(0 0 0 / 0.15) 0%, rgb(0 0 0 / 0.7) 60%, rgb(0 0 0 / 0.85) 100%);
}

.project-screenshot--thumb {
  flex-shrink: 0;
  width: 64px;
  height: 40px;
  border-radius: 4px;
}

@keyframes project-screenshot-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .project-screenshot img {
    animation: none;
  }
}
</style>
