<template>
  <div class="diagram">
    <svg
      v-for="layout in layouts"
      :key="layout.name"
      class="diagram__svg"
      :class="`diagram__svg--${layout.name}`"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      role="img"
      :aria-labelledby="`${id}-${layout.name}-title ${id}-${layout.name}-desc`"
      focusable="false"
    >
      <title :id="`${id}-${layout.name}-title`">{{ t('accounts.diagram') }}</title>
      <desc :id="`${id}-${layout.name}-desc`">{{ summary }}</desc>
      <defs>
        <linearGradient :id="`${id}-${layout.name}-panel`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.09" />
          <stop offset="1" stop-color="#fff" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient :id="`${id}-${layout.name}-shine`" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0.3" stop-color="#fff" stop-opacity="0" />
          <stop offset="0.565" stop-color="#fff" stop-opacity="0.14" />
          <stop offset="0.575" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        <!-- User-space gradients: a bounding-box gradient cannot paint a straight line (zero height or width). -->
        <linearGradient
          v-for="(arrow, index) in layout.arrows"
          :id="`${id}-${layout.name}-arrow-${index}`"
          :key="`gradient-${index}`"
          gradientUnits="userSpaceOnUse"
          :x1="arrow.x1"
          :y1="arrow.y1"
          :x2="arrow.x2"
          :y2="arrow.y2"
        >
          <stop offset="0" stop-color="#cc5ab3" stop-opacity="0.5" />
          <stop offset="1" stop-color="#cc5ab3" />
        </linearGradient>
        <linearGradient :id="`${id}-${layout.name}-fire`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4cc3a" />
          <stop offset="0.537" stop-color="#f26419" />
          <stop offset="1" stop-color="#e84855" />
        </linearGradient>
        <marker
          :id="`${id}-${layout.name}-head`"
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="#cc5ab3" />
        </marker>
      </defs>

      <line
        v-for="(arrow, index) in layout.arrows"
        :key="`arrow-${index}`"
        class="diagram__flow"
        :x1="arrow.x1"
        :y1="arrow.y1"
        :x2="arrow.x2"
        :y2="arrow.y2"
        :stroke="`url(#${id}-${layout.name}-arrow-${index})`"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="7 7"
        :marker-end="`url(#${id}-${layout.name}-head)`"
      />

      <g
        v-for="(zone, index) in zones"
        :key="zone.key"
        :transform="`translate(${layout.boxes[index]?.x ?? 0} ${layout.boxes[index]?.y ?? 0})`"
      >
        <clipPath :id="`${id}-${layout.name}-clip-${index}`">
          <rect :width="layout.boxes[index]?.width" :height="layout.boxes[index]?.height" rx="14" />
        </clipPath>
        <!-- Glass panel: soft fill, hairline border, wide inner ring and a diagonal shine -->
        <rect
          :width="layout.boxes[index]?.width"
          :height="layout.boxes[index]?.height"
          rx="14"
          :fill="`url(#${id}-${layout.name}-panel)`"
          stroke="#fff"
          stroke-opacity="0.16"
        />
        <rect
          x="5"
          y="5"
          :width="(layout.boxes[index]?.width ?? 0) - 10"
          :height="(layout.boxes[index]?.height ?? 0) - 10"
          rx="10"
          fill="none"
          stroke="#fff"
          stroke-opacity="0.05"
          stroke-width="8"
        />
        <rect
          :width="layout.boxes[index]?.width"
          :height="layout.boxes[index]?.height"
          :fill="`url(#${id}-${layout.name}-shine)`"
          :clip-path="`url(#${id}-${layout.name}-clip-${index})`"
        />

        <g transform="translate(24 24)">
          <path
            v-if="zone.icon === 'atom'"
            :d="ATOM_PATH"
            :fill="`url(#${id}-${layout.name}-fire)`"
          />
          <path
            v-else-if="zone.icon === 'cloud'"
            d="M9 25h15.5a6.5 6.5 0 0 0 .9-12.94A9 9 0 0 0 8.3 11.6 6.75 6.75 0 0 0 9 25z"
            fill="none"
            :stroke="zone.color"
            stroke-width="2.4"
            stroke-linejoin="round"
          />
          <g v-else fill="none" :stroke="zone.color" stroke-width="2.4">
            <rect x="3" y="4" width="26" height="7" rx="3" />
            <rect x="3" y="13" width="26" height="7" rx="3" />
            <rect x="3" y="22" width="26" height="7" rx="3" />
          </g>
        </g>
        <text class="diagram__title" x="24" y="88" :fill="zone.color">{{ zone.title }}</text>
        <g v-for="(item, itemIndex) in zone.items" :key="item">
          <circle cx="28" :cy="ITEMS_TOP + itemIndex * ITEM_GAP - 5" r="3.5" :fill="zone.color" />
          <text class="diagram__item" x="42" :y="ITEMS_TOP + itemIndex * ITEM_GAP">{{ item }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Layout {
  name: 'horizontal' | 'vertical';
  width: number;
  height: number;
  boxes: Box[];
  arrows: { x1: number; y1: number; x2: number; y2: number }[];
}

const ITEMS_TOP = 130;
const ITEM_GAP = 36;
const OTHER_ACCOUNTS = ['GitHub', 'Anthropic', 'Neon', 'Upstash'];
// bohr's atom (from BohrLogo), drawn at 32px.
const ATOM_PATH =
  'M16.024,32h0a15.937,15.937,0,0,1-5.035-.815A13.378,13.378,0,0,1,6.6,28.963a.3.3,0,0,1-.023-.432,5.487,5.487,0,0,0,.584-.641.3.3,0,0,1,.423-.078,14.537,14.537,0,0,0,16.818.018.292.292,0,0,1,.419.074,2.521,2.521,0,0,0,.532.633.3.3,0,0,1-.021.467A15.876,15.876,0,0,1,16.024,32Zm-.008-3.988H15.99a.751.751,0,0,1,0-1.5h.023a.751.751,0,0,1,0,1.5Zm2.565-.287a.3.3,0,0,1-.3-.324,2.257,2.257,0,0,0-.1-.8.292.292,0,0,1,.221-.369,10.665,10.665,0,0,0,7.033-5.585A10.5,10.5,0,0,0,18.405,5.774a.292.292,0,0,1-.221-.368,2.269,2.269,0,0,0,.1-.789.3.3,0,0,1,.3-.32.292.292,0,0,1,.067.008,11.742,11.742,0,0,1,8.438,7.043A12.005,12.005,0,0,1,18.64,27.719.3.3,0,0,1,18.58,27.725Zm-5.131,0a.3.3,0,0,1-.059-.006A12,12,0,0,1,13.384,4.3a.3.3,0,0,1,.065-.007.3.3,0,0,1,.3.32,2.272,2.272,0,0,0,.1.79.291.291,0,0,1-.22.368A10.547,10.547,0,0,0,6.591,20.649a10.666,10.666,0,0,0,7.033,5.585.292.292,0,0,1,.192.136.3.3,0,0,1,.03.233,2.278,2.278,0,0,0-.1.8.3.3,0,0,1-.1.248A.3.3,0,0,1,13.449,27.725Zm13.336-.178a.75.75,0,0,1-.529-1.283l.013-.014a.751.751,0,0,1,1.062,1.062l-.018.017A.746.746,0,0,1,26.784,27.547Zm-21.579,0a.751.751,0,0,1-.4-.114.742.742,0,0,1-.24-.24.751.751,0,1,1,.637.354ZM3.263,25.5H3.249a.3.3,0,0,1-.211-.1A13.4,13.4,0,0,1,.815,21.011,15.965,15.965,0,0,1,3,6.665a.294.294,0,0,1,.228-.123h.015a.3.3,0,0,1,.225.1,2.526,2.526,0,0,0,.632.533A.29.29,0,0,1,4.17,7.6a14.558,14.558,0,0,0,.018,16.818.3.3,0,0,1,.051.228.3.3,0,0,1-.129.194,5.347,5.347,0,0,0-.641.584A.3.3,0,0,1,3.263,25.5Zm25.5-.041h0a.3.3,0,0,1-.226-.1,2.531,2.531,0,0,0-.632-.532.291.291,0,0,1-.075-.419,14.555,14.555,0,0,0-.018-16.818.3.3,0,0,1,.078-.423,5.487,5.487,0,0,0,.641-.584.3.3,0,0,1,.2-.081h.016a.3.3,0,0,1,.212.1,13.378,13.378,0,0,1,2.222,4.387A15.963,15.963,0,0,1,29,25.335a.3.3,0,0,1-.229.124ZM16,21a5,5,0,1,1,5-5A5.006,5.006,0,0,1,16,21ZM5.2,5.966a.75.75,0,0,1-.533-1.279l.018-.018A.751.751,0,0,1,5.75,5.73l-.014.014A.743.743,0,0,1,5.2,5.966Zm21.579,0a.764.764,0,0,1-.408-.118h0l0,0a1.464,1.464,0,0,0-.1-.11,1.5,1.5,0,0,0-.11-.1h0l0,0a.752.752,0,0,1,.63-1.161.753.753,0,0,1,.726.556.753.753,0,0,1-.194.725A.762.762,0,0,1,26.783,5.961ZM16.016,5.5H16A.75.75,0,1,1,15.99,4h.025a.75.75,0,0,1,0,1.5Zm8.572-1.253h0a.294.294,0,0,1-.174-.056A14.54,14.54,0,0,0,7.6,4.17a.287.287,0,0,1-.176.059.3.3,0,0,1-.05,0A.291.291,0,0,1,7.176,4.1a2.526,2.526,0,0,0-.533-.632.3.3,0,0,1-.1-.239A.294.294,0,0,1,6.665,3,15.964,15.964,0,0,1,21.011.815,13.4,13.4,0,0,1,25.4,3.038a.3.3,0,0,1,.022.432,5.346,5.346,0,0,0-.584.641.3.3,0,0,1-.194.129A.305.305,0,0,1,24.587,4.244Z';

const { t } = useI18n();
const id = `accounts-${useId()}`;

const zones = computed(() => [
  {
    key: 'instance',
    icon: 'atom',
    color: '#f26419',
    title: t('accounts.instance.title'),
    items: [t('accounts.instance.onboarding'), t('accounts.instance.vault'), t('accounts.instance.web')],
  },
  {
    key: 'cloudflare',
    icon: 'cloud',
    color: '#f6ae2d',
    title: t('accounts.cloudflare.title'),
    items: [
      t('accounts.cloudflare.worker'),
      t('accounts.cloudflare.sandbox'),
      t('accounts.cloudflare.staging'),
      t('accounts.cloudflare.production'),
    ],
  },
  {
    key: 'others',
    icon: 'stack',
    color: '#55dde0',
    title: t('accounts.others.title'),
    items: OTHER_ACCOUNTS,
  },
]);

const summary = computed(() => zones.value.map((zone) => `${zone.title}: ${zone.items.join(', ')}`).join(' → '));

const zoneHeight = (items: number) => ITEMS_TOP + (items - 1) * ITEM_GAP + 34;

const layouts = computed<Layout[]>(() => {
  const heights = zones.value.map((zone) => zoneHeight(zone.items.length));
  const tallest = Math.max(...heights);

  // Side by side on wide screens: equal panels, arrows in the gaps.
  const width = 270;
  const gap = 90;
  const horizontalBoxes = zones.value.map((_, index) => ({
    x: 5 + index * (width + gap),
    y: 10,
    width,
    height: tallest,
  }));

  // Stacked on narrow screens.
  const verticalBoxes: Box[] = [];
  let y = 10;
  for (const height of heights) {
    verticalBoxes.push({ x: 20, y, width: 320, height });
    y += height + 70;
  }

  return [
    {
      name: 'horizontal',
      width: 1000,
      height: tallest + 20,
      boxes: horizontalBoxes,
      arrows: horizontalBoxes.slice(1).map((box) => ({
        x1: box.x - gap + 10,
        y1: 10 + tallest / 2,
        x2: box.x - 12,
        y2: 10 + tallest / 2,
      })),
    },
    {
      name: 'vertical',
      width: 360,
      height: y - 60,
      boxes: verticalBoxes,
      arrows: verticalBoxes.slice(1).map((box) => ({ x1: 180, y1: box.y - 60, x2: 180, y2: box.y - 12 })),
    },
  ];
});
</script>

<style scoped>
.diagram__svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.diagram__svg--horizontal {
  display: none;
}

.diagram__svg--vertical {
  max-width: 420px;
  margin-inline: auto;
}

/* Side by side only where the text keeps a readable size. */
@media (min-width: 1100px) {
  .diagram__svg--horizontal {
    display: block;
  }

  .diagram__svg--vertical {
    display: none;
  }
}

.diagram__svg text {
  font-family: var(--bohr-font-family);
}

.diagram__title {
  font-size: 18px;
  font-weight: 700;
}

.diagram__item {
  font-size: 16px;
  fill: hsl(0 0% 100% / 0.85);
}

/* The stacked diagram is drawn narrower and scaled down less, but on smaller screens. */
.diagram__svg--vertical .diagram__title {
  font-size: 20px;
}

.diagram__svg--vertical .diagram__item {
  font-size: 17px;
}

.diagram__flow {
  animation: diagram-flow 1.4s linear infinite;
}

@keyframes diagram-flow {
  to {
    stroke-dashoffset: -28;
  }
}

@media (prefers-reduced-motion: reduce) {
  .diagram__flow {
    animation: none;
  }
}
</style>
