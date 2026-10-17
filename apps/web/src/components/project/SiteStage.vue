<template>
  <div
    ref="column"
    class="site-stage"
    :class="{ 'is-full': open, 'has-chat': chat, 'is-instant': instant }"
    :style="[offsets, { '--frame-scrollbar': `${frameScrollbar}px` }]"
  >
    <div class="site-stage__container">
      <div v-if="src" ref="screen" class="site-stage__screen">
        <div class="site-stage__device" :class="`is-${shownDevice}`" :style="fit">
          <iframe
            :key="reloadKey"
            ref="frame"
            class="site-stage__frame"
            :src="src"
            :title="title"
            :tabindex="open ? undefined : -1"
          />
        </div>
        <button v-if="!open" ref="opener" type="button" class="site-stage__open" :aria-label="openLabel" :title="openLabel" @click="emit('open')">
          <!-- v1's "expand" illustration -->
          <svg width="480" height="296" viewBox="0 0 240 148" fill="none" aria-hidden="true" focusable="false">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M80 5C80 2.23858 82.2386 0 85 0H235C237.761 0 240 2.23858 240 5C240 7.76142 237.761 10 235 10H85C82.2386 10 80 7.76142 80 5ZM80 28C80 23.5817 83.5817 20 88 20H232C236.418 20 240 23.5817 240 28V82C240 86.4183 236.418 90 232 90H88C83.5817 90 80 86.4183 80 82V28ZM8 80C3.58172 80 0 83.5817 0 88V140C0 144.418 3.58172 148 8 148H112C116.418 148 120 144.418 120 140V110C120 107.239 117.761 105 115 105C112.239 105 110 107.239 110 110V134C110 136.209 108.209 138 106 138H14C11.7909 138 10 136.209 10 134V94C10 91.7909 11.7909 90 14 90H60C62.7614 90 65 87.7614 65 85C65 82.2386 62.7614 80 60 80H8Z"
              fill="white"
            />
          </svg>
        </button>
      </div>

      <!-- Nothing deployed yet: an empty screen that says so -->
      <div v-else class="site-stage__empty" data-site-empty>
        <BohrLogo icon-only class="site-stage__empty-logo" />
        <p class="site-stage__empty-title">{{ emptyTitle }}</p>
        <p class="site-stage__empty-text">{{ emptyText }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrLogo, type SitePreviewDevice, useScrollLock } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';

// bohr v1's SitePreview: the site, tilted next to the production card, that becomes the full-screen view on a
// click. Both are the same iframe, so the site stays loaded: opening only drops the tilt and the scale (a 1s
// transition) until it fills the screen under the bar, beside the chat when it is open. Deep links open it at
// once. v1's editor (the flip to the code, the CMS, the presence of others) is not here.
const props = defineProps<{
  /** The page shown; null when nothing is deployed yet. */
  src: string | null;
  /** The iframe's accessible name. */
  title: string;
  /** The button over the tilted preview that opens it. */
  openLabel: string;
  emptyTitle: string;
  emptyText: string;
  /** Full screen. */
  open: boolean;
  /** The chat is open beside the full-screen view, which leaves it --site-chat-width. */
  chat?: boolean;
  /** In full screen; the tilted preview is always a desktop. */
  device?: SitePreviewDevice;
  /** Changing it loads the page again (a new iframe). */
  reloadKey?: string | number;
}>();

const emit = defineEmits<{ open: []; close: [] }>();

/** v1's device sizes; tablets and phones are scaled down when the screen is smaller. */
const DEVICE_SIZES: Record<Exclude<SitePreviewDevice, 'desktop'>, [number, number]> = {
  tabletLandscape: [1024, 768],
  tabletPortrait: [768, 1024],
  phoneLandscape: [720, 360],
  phonePortrait: [360, 720],
};
/** Room around a device: its bezel (23px) and some air. */
const DEVICE_MARGIN = 48;

const column = useTemplateRef<HTMLElement>('column');
const screen = useTemplateRef<HTMLElement>('screen');
const frame = useTemplateRef<HTMLIFrameElement>('frame');
const opener = useTemplateRef<HTMLButtonElement>('opener');
// The full-screen view covers the page: no padding for the vanished scrollbar, which would cut the view short
const scrollLock = useScrollLock({ keepLayout: false });

/** Transitions off: a deep link opens the full-screen view at once. */
const instant = ref(false);
/** Where the full-screen view starts, from the column it hangs from (the page scroll is locked meanwhile). */
const offsets = ref<Record<string, string>>({});
const screenSize = ref<{ width: number; height: number } | null>(null);
/** Pushes the site's scrollbar outside the tilted preview, which is a picture of the site, not a window to scroll. */
const frameScrollbar = ref(0);

const shownDevice = computed<SitePreviewDevice>(() => (props.open ? (props.device ?? 'desktop') : 'desktop'));

const fit = computed(() => {
  const device = shownDevice.value;
  if (device === 'desktop') return undefined;
  const [width, height] = DEVICE_SIZES[device];
  const size = screenSize.value;
  const room =
    size === null ? 1 : Math.min((size.width - DEVICE_MARGIN * 2) / width, (size.height - DEVICE_MARGIN * 2) / height);
  const scale = Math.max(0.1, Math.min(1, room));
  return { width: `${width}px`, height: `${height}px`, '--fit': String(scale) };
});

/**
 * The width of the browser's classic scrollbars (0 with overlay scrollbars): the tilted preview's frame is this much
 * wider than its screen, so the site's own scrollbar falls outside it.
 */
function scrollbarWidth(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

function place() {
  const rect = column.value?.getBoundingClientRect();
  if (rect === undefined) return;
  offsets.value = {
    '--full-top': `${-rect.top}px`,
    '--full-left': `${-rect.left}px`,
  };
}

function onKeydown(event: KeyboardEvent) {
  // A dialog over the view (discarding the preview) stops its own Escape.
  if (event.key === 'Escape' && !event.defaultPrevented) emit('close');
}

/** Sites with v1's bohr script tell the panel about Escape pressed inside them. */
function onMessage(event: MessageEvent) {
  const data: unknown = event.data;
  if (event.source !== frame.value?.contentWindow || typeof data !== 'object' || data === null) return;
  if ((data as { type?: unknown }).type === 'escPress') emit('close');
}

// Anything that moves the column (content above it loading, a resize) moves the full-screen view with it.
let pageObserver: ResizeObserver | null = null;
let screenObserver: ResizeObserver | null = null;

function observeScreen() {
  screenObserver?.disconnect();
  screenObserver = null;
  if (!props.open || screen.value === null || typeof ResizeObserver === 'undefined') return;
  screenObserver = new ResizeObserver(([entry]) => {
    if (entry) screenSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  screenObserver.observe(screen.value);
}

function enter() {
  scrollLock.lock();
  place();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', place);
  if (typeof ResizeObserver !== 'undefined') {
    pageObserver = new ResizeObserver(() => place());
    pageObserver.observe(document.body);
  }
}

function leave() {
  scrollLock.unlock();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', place);
  pageObserver?.disconnect();
  pageObserver = null;
}

watch(
  () => props.open,
  (open) => (open ? enter() : leave()),
);
watch([() => props.open, screen], () => nextTick(observeScreen));

let instantTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  frameScrollbar.value = scrollbarWidth();
  window.addEventListener('message', onMessage);
  if (!props.open) return;
  instant.value = true;
  instantTimer = setTimeout(() => {
    instant.value = false;
  }, 1000);
  enter();
  void nextTick(observeScreen);
});

onBeforeUnmount(() => {
  clearTimeout(instantTimer);
  window.removeEventListener('message', onMessage);
  screenObserver?.disconnect();
  leave();
});

defineExpose({
  /** Back to the tilted preview's button, after the full-screen view closes. */
  focus: () => opener.value?.focus({ preventScroll: true }),
});
</script>

<style scoped>
/* v1's .preview__column: the tilted preview hangs from it, over the card's right side. */
.site-stage {
  --chat-space: 0px;
  --transition: 1s linear;

  position: relative;
  box-sizing: border-box;
  width: 468px;
  max-width: 100%;
  margin-left: auto;
  padding-right: 36px;
}

.site-stage.is-full.has-chat {
  --chat-space: var(--site-chat-width, 0px);
}

.site-stage__container {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  width: 470px;
  aspect-ratio: 16 / 9;
  transform: translate(-40px, -50px) perspective(530px) rotate3d(-30, 75, -18, -44deg) rotateX(10deg);
  /* Back above the main bar at once on the way in; below it only once the way out is over. */
  transition:
    var(--transition),
    z-index 0s linear 1s;
}

/* Floor shadow */
.site-stage__container::before {
  content: "";
  position: absolute;
  bottom: -20px;
  left: 12%;
  z-index: -1;
  width: 85%;
  height: 50px;
  border-radius: 100% 75% 75% 100%;
  background-color: #000;
  filter: blur(20px);
  transform: rotate(3deg);
  pointer-events: none;
}

/* The page, laid out at three times the size and scaled down: a desktop layout in a small frame. */
.site-stage__screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 300%;
  height: 300%;
  overflow: hidden;
  border-radius: 12px;
  background-color: var(--bohr-color-bg);
  transform: scale(0.334) translate(-100%, -100%);
  transition: var(--transition);
}

/* Glass */
.site-stage__screen::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background-image: linear-gradient(200deg, transparent 29.08%, hsl(0 0% 100% / 0.2) 56.83%, transparent 57.84%);
  box-shadow: var(--bohr-shadow-glass);
  transition: opacity var(--transition);
  pointer-events: none;
}

.site-stage__device {
  --fit: 1;

  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #fff;
  transform: translate(-50%, -50%) scale(var(--fit));
  transition: 800ms linear;
  transition-property: width, height, transform, border-radius, box-shadow;
}

/* v1's tablet and phone frames */
.site-stage__device:not(.is-desktop) {
  border-radius: 38px;
  box-shadow:
    0 0 0 18px hsl(180 8% 8%),
    0 0 0 23px hsl(196 9% 25%);
}

.site-stage__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  pointer-events: none;
}

/* Hover layer, also the keyboard's way in */
.site-stage__open {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: inherit;
  background-color: hsl(0 0% 0% / 0.72);
  opacity: 0;
  cursor: pointer;
  transition: opacity 300ms linear;
}

.site-stage__open:hover,
.site-stage__open:focus-visible {
  opacity: 1;
}

/* Drawn at three times the size, like the page */
.site-stage__open:focus-visible {
  outline: 6px solid var(--bohr-color-yellow);
  outline-offset: -6px;
}

.site-stage__open svg {
  filter: blur(2px) drop-shadow(0 0 8px hsl(0 0% 0% / 0.64)) drop-shadow(0 0 128px hsl(0 0% 100% / 0.72));
}

.site-stage__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  padding: 24px;
  overflow: hidden;
  border-radius: 4px;
  text-align: center;
  background: radial-gradient(120% 90% at 50% 0%, hsl(203 30% 16%) 0%, transparent 70%), #0a1116;
  box-shadow: var(--bohr-shadow-glass);
}

.site-stage__empty-logo {
  width: 32px;
  height: 32px;
  opacity: 0.6;
}

.site-stage__empty-title {
  font-weight: 700;
}

.site-stage__empty-text {
  max-width: 300px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--bohr-color-text-muted);
}

/* Full screen: centered in the viewport (beside the chat), under the 64px bar */
.site-stage.is-full .site-stage__container {
  top: calc(var(--full-top, 0px) + 50vh);
  left: calc(var(--full-left, 0px) + (100vw - var(--chat-space)) / 2);
  z-index: 200;
  cursor: auto;
  transform: translate(-50%, -50%) perspective(530px) rotate3d(-30, 75, -18, 0deg) rotateX(0deg);
  transition:
    var(--transition),
    z-index 0s;
}

.site-stage.is-full .site-stage__screen {
  /* From 1px under the 64px bar (which stays on top), so rounding never leaves a gap between them */
  top: calc(50% + 31.5px);
  left: 50%;
  width: calc(100vw - var(--chat-space));
  height: calc(100vh - 63px);
  border-radius: 0;
  transform: scale(1) translate(-50%, -50%);
}

.site-stage.is-full .site-stage__screen::after {
  opacity: 0;
}

.site-stage.is-full .site-stage__frame {
  pointer-events: auto;
}

/* Tilted, the site's own scrollbar falls just outside the screen (which clips it); in full screen the site
   scrolls like a window, with its scrollbar on the right */
.site-stage:not(.is-full) .site-stage__device.is-desktop .site-stage__frame {
  width: calc(100% + var(--frame-scrollbar, 0px));
}

/* A deep link: no transition for the first second (v1's transitions__disabled) */
.site-stage.is-instant .site-stage__container,
.site-stage.is-instant .site-stage__container * {
  transition-duration: 0s;
  transition-delay: 0s;
}

@media (prefers-reduced-motion: reduce) {
  .site-stage__container,
  .site-stage__container * {
    transition: none;
  }
}

/* Phones: no tilt, the preview spans the card */
@media (max-width: 767px) {
  .site-stage {
    width: 100%;
    padding-right: 0;
  }

  .site-stage:not(.is-full) .site-stage__container {
    position: relative;
    top: 16px;
    width: 100%;
    transform: none;
  }
}
</style>
