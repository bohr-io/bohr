<template>
  <section class="bohr-toasts" :aria-label="regionLabel">
    <TransitionGroup name="bohr-toast" tag="ol" class="bohr-toasts__list" role="list" aria-live="polite">
      <li
        v-for="toast in toasts"
        :key="toast.id"
        class="bohr-toast"
        :class="`bohr-toast--${toast.type}`"
      >
        <component :is="ICONS[toast.type]" :size="24" class="bohr-toast__icon" />
        <span class="bohr-toast__type">{{ typeLabels[toast.type] }}</span>
        <span class="bohr-toast__message">{{ toast.message }}</span>
        <button v-if="toast.action" type="button" class="bohr-toast__action" @click="toast.action.onClick">
          {{ toast.action.text }}
        </button>
        <button
          type="button"
          class="bohr-toast__dismiss"
          :aria-label="dismissLabel"
          :title="dismissLabel"
          @click="dismiss(toast.id)"
        >
          <XIcon :size="12" />
        </button>
        <div class="bohr-toast__stripes" aria-hidden="true">
          <svg width="320" height="72" viewBox="0 0 320 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient
                :id="`${idPrefix}-${toast.id}`"
                x1="328"
                y1="36"
                x2="0"
                y2="36"
                gradientUnits="userSpaceOnUse"
              >
                <stop :stop-color="STRIPE_COLORS[toast.type]" stop-opacity="0.5" />
                <stop offset="1" :stop-color="STRIPE_COLORS[toast.type]" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M16 72L40 0H24L0 72H16ZM56 0L32 72H48L72 0H56ZM64 72L88 0H104L80 72H64ZM120 0L96 72H112L136 0H120ZM128 72L152 0H168L144 72H128ZM184 0L160 72H176L200 0H184ZM192 72L216 0H232L208 72H192ZM248 0L224 72H240L264 0H248ZM256 72L280 0H296L272 72H256ZM328 0H312L288 72H304L328 0Z"
              :fill="`url(#${idPrefix}-${toast.id})`"
            />
          </svg>
        </div>
      </li>
    </TransitionGroup>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { type ToastType, useToast } from '../composables/useToast';
import { CheckIcon, ExclamationIcon, LightbulbIcon, XIcon } from '../icons';

const props = withDefaults(
  defineProps<{
    /** Visible name of each toast type. */
    labels?: Partial<Record<ToastType, string>>;
    dismissLabel?: string;
    regionLabel?: string;
  }>(),
  { labels: () => ({}), dismissLabel: 'Dismiss', regionLabel: 'Notifications' },
);

const ICONS = { success: CheckIcon, warn: ExclamationIcon, error: XIcon, tip: LightbulbIcon } as const;
const STRIPE_COLORS: Record<ToastType, string> = {
  success: 'hsl(0 0% 100%)',
  tip: 'hsl(0 0% 100%)',
  warn: 'hsl(0 0% 0%)',
  error: 'hsl(45 89% 59%)',
};
const DEFAULT_LABELS: Record<ToastType, string> = { success: 'Success', warn: 'Warning', error: 'Error', tip: 'Tip' };

const { toasts, dismiss } = useToast();
const idPrefix = `bohr-toast-${useId()}`;
const typeLabels = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }));
</script>

<style scoped>
.bohr-toasts {
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: var(--bohr-z-toast);
  width: calc(100% - var(--bohr-toast-offset-left, 0px));
  pointer-events: none;
}

.bohr-toasts__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bohr-toast {
  --action-text-color: hsl(203 37% 20%);

  position: relative;
  display: flex;
  align-items: center;
  gap: 24px;
  width: 100%;
  min-height: 72px;
  padding: 12px 0 12px 36px;
  overflow: hidden;
  background: linear-gradient(180deg, hsl(181 69% 61%), hsl(203 36% 33%));
  pointer-events: auto;
}

.bohr-toast--success {
  --action-text-color: hsl(131 45% 36%);
  background: linear-gradient(180deg, hsl(181 69% 61%), hsl(131 67% 60%));
}

.bohr-toast--warn {
  --action-text-color: hsl(355 53% 36%);
  background: linear-gradient(180deg, hsl(47 89% 59%) 0%, hsl(39 92% 57%) 100%);
}

.bohr-toast--error {
  --action-text-color: hsl(355 53% 36%);
  background: linear-gradient(180deg, hsl(21 89% 52%) 0%, hsl(355 78% 60%) 100%);
}

.bohr-toast__icon {
  flex-shrink: 0;
  color: #fff;
  filter: drop-shadow(0 0 2px hsl(0 0% 0% / 0.5));
}

.bohr-toast__type {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.04em;
  text-transform: capitalize;
  color: #fff;
  text-shadow: 0 0 6px hsl(0 0% 0% / 0.25);
}

.bohr-toast__message {
  margin-right: auto;
  font-size: 16px;
  font-weight: 700;
  color: #000;
}

.bohr-toast__action {
  flex-shrink: 0;
  padding: 11px;
  border: none;
  border-radius: var(--bohr-radius-sm);
  font-size: 12px;
  font-weight: 700;
  color: var(--action-text-color);
  background-color: #fff;
  box-shadow: 0 0 6px rgb(0 0 0 / 0.25);
}

.bohr-toast__action:active {
  background-color: hsl(0 0% 100% / 0.95);
}

.bohr-toast__dismiss {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--bohr-radius-full);
  color: #000;
  background: hsl(0 0% 100% / 0.35);
}

.bohr-toast__dismiss:hover,
.bohr-toast__dismiss:focus-visible {
  background: hsl(0 0% 100% / 0.7);
}

.bohr-toast__stripes {
  flex-shrink: 0;
  width: 6vw;
  min-width: 36px;
  max-width: 320px;
  margin-left: -12px;
  overflow: hidden;
  align-self: stretch;
  font-size: 0;
}

.bohr-toast__stripes svg {
  max-width: none;
  height: 100%;
}

@media (min-width: 767px) {
  .bohr-toast__stripes {
    width: 22.22vw;
    min-width: 96px;
  }
}

@media (min-width: 1280px) {
  .bohr-toast {
    padding-left: 96px;
  }
}

@media (max-width: 560px) {
  .bohr-toast {
    gap: 12px;
    padding-left: 16px;
  }

  .bohr-toast__type {
    display: none;
  }
}

.bohr-toast-move,
.bohr-toast-enter-active,
.bohr-toast-leave-active {
  transition-property: opacity, transform;
  transition-duration: 300ms;
  transition-timing-function: linear;
}

.bohr-toast-enter-from,
.bohr-toast-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
