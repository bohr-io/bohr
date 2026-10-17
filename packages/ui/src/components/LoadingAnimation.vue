<template>
  <section class="bohr-loading" aria-busy="true">
    <div class="bohr-loading__displays">
      <div class="bohr-loading__update" aria-live="polite">
        <Transition name="bohr-loading-text" mode="out-in">
          <span v-if="currentStep" :key="stepIndex" class="bohr-loading__step">{{ currentStep }}</span>
        </Transition>
      </div>
      <div class="bohr-loading__detail">
        <Transition name="bohr-loading-text" mode="out-in">
          <span v-if="currentDetail && detailVisible" :key="detailIndex" class="bohr-loading__details">
            {{ currentDetail }}
          </span>
        </Transition>
      </div>
    </div>
    <div class="bohr-loading__logo">
      <BohrAnimatedLogo :style="{ width: logoSize, height: logoSize }" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BohrAnimatedLogo from './BohrAnimatedLogo.vue';

const props = withDefaults(
  defineProps<{
    /** Shown one after another; the last one stays. */
    steps?: string[];
    /** Secondary lines on the right; each fades out after a while. */
    details?: string[];
    stepInterval?: number;
    detailInterval?: number;
    detailDuration?: number;
    logoSize?: string;
  }>(),
  {
    steps: () => [],
    details: () => [],
    stepInterval: 3500,
    detailInterval: 4500,
    detailDuration: 3000,
    logoSize: '300px',
  },
);

const stepIndex = ref(0);
const detailIndex = ref(0);
const detailVisible = ref(true);
const currentStep = computed(() => props.steps[stepIndex.value]);
const currentDetail = computed(() => props.details[detailIndex.value]);

const timers: ReturnType<typeof setTimeout>[] = [];
const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

onMounted(() => {
  for (let i = 1; i < props.steps.length; i++) {
    later(() => {
      stepIndex.value = i;
    }, i * props.stepInterval);
  }

  props.details.forEach((_, i) => {
    later(() => {
      detailIndex.value = i;
      detailVisible.value = true;
    }, i * props.detailInterval);
    later(
      () => {
        detailVisible.value = false;
      },
      i * props.detailInterval + props.detailDuration,
    );
  });
});

onBeforeUnmount(() => {
  for (const timer of timers) clearTimeout(timer);
});
</script>

<style scoped>
.bohr-loading {
  position: relative;
  display: block;
  padding: 16px 0;
}

.bohr-loading__displays {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.bohr-loading__update,
.bohr-loading__detail {
  position: relative;
  flex: 1 1 auto;
  min-height: 1.5em;
}

.bohr-loading__detail {
  text-align: right;
}

.bohr-loading__step {
  display: block;
  margin: 8px 0;
  font-size: 36px;
  font-weight: 700;
  color: var(--bohr-color-yellow);
}

.bohr-loading__step::after {
  content: " . ";
  animation: bohr-loading-dots 1s steps(5, end) infinite;
}

.bohr-loading__details {
  display: block;
  margin-top: 16px;
  font-size: 24px;
  font-weight: 700;
  white-space: pre-line;
  color: var(--bohr-color-cyan);
}

.bohr-loading__logo {
  display: flex;
  justify-content: center;
  margin-top: 120px;
}

@media (max-width: 630px) {
  .bohr-loading__detail {
    text-align: center;
  }

  .bohr-loading__details {
    font-size: 18px;
  }

  .bohr-loading__logo {
    margin-top: 64px;
  }
}

/* v1's fade-in-bottom / fade-out-top */
.bohr-loading-text-enter-active {
  animation: bohr-loading-in 0.6s cubic-bezier(0.39, 0.575, 0.565, 1) both;
}

.bohr-loading-text-leave-active {
  animation: bohr-loading-out 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

@keyframes bohr-loading-in {
  from {
    transform: translateY(50px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes bohr-loading-out {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(-50px);
    opacity: 0;
  }
}

@keyframes bohr-loading-dots {
  0%,
  20% {
    color: transparent;
    text-shadow:
      0.25em 0 0 transparent,
      0.5em 0 0 transparent;
  }
  40% {
    color: var(--bohr-color-yellow);
    text-shadow:
      0.25em 0 0 transparent,
      0.5em 0 0 transparent;
  }
  60% {
    text-shadow:
      0.25em 0 0 var(--bohr-color-yellow),
      0.5em 0 0 transparent;
  }
  80%,
  100% {
    text-shadow:
      0.25em 0 0 var(--bohr-color-yellow),
      0.5em 0 0 var(--bohr-color-yellow);
  }
}
</style>
