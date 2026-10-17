<template>
  <div class="terminal">
    <div class="terminal__bar">
      <span class="terminal__dots" aria-hidden="true"><span /><span /><span /></span>
      <h3 class="terminal__title">{{ title }}</h3>
      <button v-if="canCopy" type="button" class="terminal__copy" @click="copy">
        {{ copied ? copiedLabel : copyLabel }}
      </button>
    </div>
    <pre class="terminal__body"><code><template v-for="(line, index) in commands" :key="index"><span class="terminal__prompt" aria-hidden="true">$ </span>{{ line }}
</template></code></pre>
    <span class="bohr-visually-hidden" aria-live="polite">{{ copied ? copiedLabel : '' }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  commands: readonly string[];
  copyLabel: string;
  copiedLabel: string;
}>();

// Rendered only after mount, so the prerendered HTML matches the first client render.
const canCopy = ref(false);
const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  canCopy.value = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
});

onBeforeUnmount(() => clearTimeout(resetTimer));

async function copy() {
  try {
    await navigator.clipboard.writeText(props.commands.join('\n'));
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // Clipboard permission denied: the commands stay selectable.
  }
}
</script>

<style scoped>
/* Glass window, like v1's terminal illustrations */
.terminal {
  position: relative;
  isolation: isolate;
  min-width: 0;
  overflow: hidden;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: var(--bohr-radius-md);
  background: rgb(6 12 15 / 0.88);
  box-shadow: 0 30px 60px -30px rgb(0 0 0 / 0.9);
}

.terminal::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background-image: var(--bohr-gradient-glass-shine);
  box-shadow: var(--bohr-shadow-glass);
  opacity: 0.6;
  pointer-events: none;
}

.terminal__bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.08);
}

.terminal__dots {
  display: flex;
  gap: 6px;
}

.terminal__dots span {
  width: 10px;
  height: 10px;
  border-radius: var(--bohr-radius-full);
  background: hsl(0 0% 100% / 0.3);
}

.terminal__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
}

.terminal__copy {
  flex-shrink: 0;
  padding: 6px 10px;
  border: 1px solid hsl(var(--bohr-hsl-green) / 0.5);
  border-radius: var(--bohr-radius-sm);
  font-size: 12px;
  font-weight: 700;
  color: var(--bohr-color-green);
  background: transparent;
  transition: background-color var(--bohr-transition);
}

.terminal__copy:hover {
  background: hsl(var(--bohr-hsl-green) / 0.12);
}

.terminal__body {
  position: relative;
  z-index: 2;
  margin: 0;
  padding: 20px;
  overflow-x: auto;
  font-size: 15px;
  line-height: 1.9;
  color: #fff;
}

.terminal__prompt {
  color: var(--bohr-color-green);
  user-select: none;
}

@media (max-width: 479px) {
  .terminal__dots {
    display: none;
  }

  /* Long commands wrap instead of hiding behind a scrollbar; copying still yields one line each. */
  .terminal__body {
    padding: 16px;
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
