<template>
  <Teleport v-if="open" :to="teleportTo || 'body'" :disabled="teleportTo === false">
    <div class="bohr-modal" @click.self="onBackdropClick">
      <div
        ref="dialog"
        class="bohr-modal__dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        :aria-labelledby="labelledby"
        tabindex="-1"
        :style="{ width, maxWidth, minWidth }"
      >
        <slot />
        <button
          v-if="withCloseButton"
          type="button"
          class="bohr-modal__close"
          :aria-label="closeLabel"
          :title="closeLabel"
          @click="requestClose"
        >
          <XIcon gradient :size="20" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { useScrollLock } from '../composables/useScrollLock';
import { XIcon } from '../icons';

const props = withDefaults(
  defineProps<{
    open?: boolean;
    withCloseButton?: boolean;
    closeLabel?: string;
    /** Accessible name, when there is no visible title to point at. */
    label?: string;
    /** Id of the element that names the dialog. */
    labelledby?: string;
    closeOnBackdrop?: boolean;
    width?: string;
    maxWidth?: string;
    minWidth?: string;
    /** Teleport target, or false to render in place. */
    teleportTo?: string | false;
  }>(),
  {
    closeLabel: 'Close',
    closeOnBackdrop: true,
    width: 'auto',
    maxWidth: 'calc(100vw - 32px)',
    minWidth: '0',
    teleportTo: 'body',
  },
);

const emit = defineEmits<{
  close: [];
  'update:open': [value: boolean];
}>();

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const dialog = useTemplateRef<HTMLElement>('dialog');
const scrollLock = useScrollLock();
let active = false;
let previouslyFocused: HTMLElement | null = null;

function requestClose() {
  emit('close');
  emit('update:open', false);
}

function onBackdropClick() {
  if (props.closeOnBackdrop) requestClose();
}

function focusableElements(): HTMLElement[] {
  return dialog.value ? Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

// Keeps Tab and Shift+Tab inside the dialog.
function trapFocus(event: KeyboardEvent) {
  const elements = focusableElements();
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const current = document.activeElement;
  const outside = !dialog.value?.contains(current);
  if (event.shiftKey && (current === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    requestClose();
  } else if (event.key === 'Tab') {
    trapFocus(event);
  }
}

async function activate() {
  if (active) return;
  active = true;
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  scrollLock.lock();
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  (focusableElements()[0] ?? dialog.value)?.focus();
}

function deactivate() {
  if (!active) return;
  active = false;
  scrollLock.unlock();
  document.removeEventListener('keydown', onKeydown);
  previouslyFocused?.focus();
  previouslyFocused = null;
}

watch(
  () => props.open,
  (open) => (open ? activate() : deactivate()),
);

onMounted(() => {
  if (props.open) activate();
});

onBeforeUnmount(deactivate);
</script>

<style scoped>
.bohr-modal {
  position: fixed;
  inset: 0;
  z-index: var(--bohr-z-modal);
  display: grid;
  place-items: center;
  padding: 16px;
  background-color: hsl(0 0% 0% / 0.72);
}

.bohr-modal__dialog {
  position: relative;
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 24px;
  border-radius: var(--bohr-radius-md);
  color: hsl(0 0% 0%);
  background-color: hsl(0 0% 100%);
}

.bohr-modal__dialog:focus-visible {
  outline: none;
}

@media (min-width: 767px) {
  .bohr-modal__dialog {
    padding: 48px;
  }
}

.bohr-modal__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  padding: 10px;
  border: none;
  border-radius: var(--bohr-radius-full);
  background: transparent;
  transition: background-color var(--bohr-transition);
}

.bohr-modal__close:hover,
.bohr-modal__close:focus-visible {
  background-color: hsl(0 0% 0% / 0.08);
}
</style>
