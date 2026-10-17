<template>
  <figure class="demo">
    <div ref="frame" class="demo__frame">
      <div class="demo__header">
        <span class="demo__avatar"><BohrLogo icon-only /></span>
        <span class="demo__identity">
          <span class="demo__name">bohr</span>
          <span class="demo__status">{{ t('demo.status') }}</span>
        </span>
        <button
          v-if="animated"
          type="button"
          class="demo__toggle"
          :title="paused ? t('demo.play') : t('demo.pause')"
          @click="togglePause"
        >
          <svg v-if="paused" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 2.5h3v11H4zm5 0h3v11H9z" fill="currentColor" />
          </svg>
          <span class="bohr-visually-hidden">{{ paused ? t('demo.play') : t('demo.pause') }}</span>
        </button>
      </div>

      <!-- The animated chat is decorative; the transcript below carries the content. -->
      <ol class="demo__messages" aria-hidden="true">
        <li class="demo__row demo__row--user" :class="shown(1)">
          <p class="demo__bubble demo__bubble--user">{{ t('demo.user') }}</p>
        </li>
        <li class="demo__row" :class="shown(2)">
          <div class="demo__bubble demo__bubble--working">
            <BohrAnimatedLogo class="demo__spinner" :paused="step > 2 || paused" />
            <p>{{ t('demo.working') }}</p>
          </div>
        </li>
        <li class="demo__row" :class="shown(3)">
          <div class="demo__bubble demo__bubble--preview">
            <p>{{ t('demo.ready') }}</p>
            <span class="demo__chip">
              <NewWindowIcon :size="12" />
              {{ t('demo.previewUrl') }}
            </span>
            <SitePreview class="demo__preview" shadowless>
              <StoreMock />
            </SitePreview>
          </div>
          <div class="demo__keyboard">
            <span class="demo__key demo__key--approve" :class="{ 'is-tapped': step >= 4 }">
              <CheckIcon v-if="step >= 4" :size="12" />
              {{ t('demo.approve') }}
            </span>
            <span class="demo__key">{{ t('demo.adjust') }}</span>
            <span class="demo__key">{{ t('demo.discard') }}</span>
          </div>
        </li>
        <li class="demo__row" :class="shown(5)">
          <I18nT keypath="demo.published" tag="p" scope="global" class="demo__bubble">
            <template #command><code class="inline-code">/rollback</code></template>
          </I18nT>
        </li>
      </ol>

      <div class="demo__transcript bohr-visually-hidden">
        <h3>{{ t('demo.transcript') }}</h3>
        <ol>
          <li>{{ t('demo.you') }}: {{ t('demo.user') }}</li>
          <li>bohr: {{ t('demo.working') }}</li>
          <li>bohr: {{ t('demo.ready') }} {{ t('demo.previewLabel') }}: {{ t('demo.previewUrl') }}</li>
          <li>{{ t('demo.tapped') }}</li>
          <li>
            bohr:
            <I18nT keypath="demo.published" scope="global">
              <template #command>/rollback</template>
            </I18nT>
          </li>
        </ol>
      </div>
    </div>
    <figcaption class="demo__caption">{{ t('demo.caption') }}</figcaption>
  </figure>
</template>

<script setup lang="ts">
import { BohrAnimatedLogo, BohrLogo, CheckIcon, NewWindowIcon, SitePreview, usePrefersReducedMotion } from '@bohr/ui';
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { FINAL_STEP, STEP_DELAYS } from './demoTimeline';
import StoreMock from './StoreMock.vue';

const { t } = useI18n();
const reducedMotion = usePrefersReducedMotion();
const frame = useTemplateRef<HTMLElement>('frame');

const step = ref(FINAL_STEP);
const animated = ref(false);
const paused = ref(false);
let inView = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | undefined;

const shown = (target: number) => ({ 'is-visible': step.value >= target });

function clearTimer() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
}

function schedule() {
  clearTimer();
  if (!animated.value || paused.value || !inView) return;
  timer = setTimeout(() => {
    step.value = step.value >= FINAL_STEP ? 0 : step.value + 1;
    schedule();
  }, STEP_DELAYS[step.value] ?? 1000);
}

function start() {
  animated.value = true;
  paused.value = false;
  step.value = 0;
  schedule();
}

function stop() {
  clearTimer();
  animated.value = false;
  paused.value = false;
  step.value = FINAL_STEP;
}

function togglePause() {
  paused.value = !paused.value;
  schedule();
}

onMounted(() => {
  // Only play while the chat is on screen.
  if (typeof IntersectionObserver === 'function' && frame.value) {
    inView = false;
    observer = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        schedule();
      },
      { threshold: 0.2 },
    );
    observer.observe(frame.value);
  }

  watch(reducedMotion, (reduce) => (reduce ? stop() : start()), { immediate: true });
});

onBeforeUnmount(() => {
  clearTimer();
  observer?.disconnect();
});
</script>

<style scoped>
.demo {
  margin: clamp(32px, 5vw, 56px) auto 0;
  max-width: 860px;
}

/* v1's framed media: 2px orange border, 8px radius */
.demo__frame {
  position: relative;
  overflow: hidden;
  border: 2px solid var(--bohr-color-frame);
  border-radius: var(--bohr-radius-md);
  background:
    radial-gradient(120% 70% at 50% 0%, hsl(203 30% 16%) 0%, transparent 70%),
    #0a1116;
  box-shadow: 0 40px 100px -40px rgb(241 105 35 / 0.45);
}

.demo__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.08);
  background: rgb(0 0 0 / 0.35);
}

.demo__avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--bohr-radius-full);
  background: #050a0d;
  box-shadow: inset 0 0 0 1px hsl(0 0% 100% / 0.12);
}

.demo__avatar :deep(svg) {
  width: 22px;
  height: 22px;
}

.demo__identity {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.demo__name {
  font-weight: 700;
}

.demo__status {
  font-size: 13px;
  color: var(--bohr-color-green);
}

.demo__toggle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-left: auto;
  padding: 0;
  border: 1px solid hsl(0 0% 100% / 0.25);
  border-radius: var(--bohr-radius-full);
  color: #fff;
  background: transparent;
  transition: background-color var(--bohr-transition);
}

.demo__toggle:hover {
  background-color: hsl(0 0% 100% / 0.1);
}

.demo__toggle svg {
  width: 14px;
  height: 14px;
}

.demo__messages {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: clamp(16px, 4vw, 32px);
  list-style: none;
}

/* Every message keeps its space, so the frame never changes height while the chat plays. */
.demo__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  opacity: 0;
  visibility: hidden;
  transform: translateY(10px);
  transition:
    opacity 350ms ease,
    transform 350ms ease,
    visibility 0s linear 350ms;
}

.demo__row.is-visible {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition:
    opacity 350ms ease,
    transform 350ms ease;
}

.demo__row--user {
  align-items: flex-end;
}

.demo__bubble {
  max-width: min(520px, 88%);
  padding: 12px 16px;
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 18px 18px 18px 6px;
  font-size: 15px;
  line-height: 1.45;
  background: hsl(0 0% 100% / 0.07);
}

.demo__bubble--user {
  border: none;
  border-radius: 18px 18px 6px;
  background: linear-gradient(180deg, #3b6680 0%, #2b4a5d 100%);
}

.demo__bubble--working {
  display: flex;
  align-items: center;
  gap: 12px;
}

.demo__spinner {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.demo__bubble--preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: min(420px, 88%);
}

.demo__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--bohr-radius-full);
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-cyan);
  background: hsl(var(--bohr-hsl-cyan) / 0.12);
  overflow-wrap: anywhere;
}

.demo__preview {
  width: 100%;
  margin-top: 4px;
}

.demo__keyboard {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  width: min(420px, 88%);
  margin-top: 6px;
}

.demo__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 6px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  background: hsl(0 0% 100% / 0.09);
  transition:
    background-color var(--bohr-transition),
    color var(--bohr-transition),
    box-shadow var(--bohr-transition);
}

.demo__key--approve.is-tapped {
  color: #0e171d;
  background: var(--bohr-gradient-secondary);
  box-shadow:
    0 0 0 2px hsl(var(--bohr-hsl-green) / 0.35),
    0 8px 24px -6px hsl(var(--bohr-hsl-green) / 0.7);
  animation: demo-tap 450ms ease-out;
}

.demo__caption {
  margin-top: 20px;
  font-size: 16px;
  text-align: center;
  color: var(--bohr-color-text-muted);
}

@keyframes demo-tap {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(0.92);
  }
  100% {
    transform: scale(1);
  }
}

@media (max-width: 479px) {
  .demo__bubble {
    max-width: 92%;
  }

  .demo__bubble--preview,
  .demo__keyboard {
    width: 100%;
    max-width: 100%;
  }

  .demo__bubble {
    font-size: 14px;
  }

  .demo__key {
    font-size: 13px;
  }
}
</style>
