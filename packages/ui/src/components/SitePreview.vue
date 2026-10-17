<template>
  <div
    class="bohr-site-preview"
    :class="[`bohr-site-preview--${device}`, { 'is-tilted': tilted, 'has-shadow': !shadowless }]"
  >
    <div class="bohr-site-preview__device">
      <div class="bohr-site-preview__screen">
        <slot>
          <iframe
            v-if="src"
            class="bohr-site-preview__iframe"
            :class="{ 'is-interactive': interactive }"
            :src="src"
            :title="title"
            :tabindex="interactive ? undefined : -1"
            loading="lazy"
          />
        </slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SitePreviewDevice } from '../types';

withDefaults(
  defineProps<{
    device?: SitePreviewDevice;
    /** Page shown in an iframe when no slot content is given. */
    src?: string;
    /** Iframe title, required for assistive technology when `src` is set. */
    title?: string;
    /** Lets the iframe receive clicks and focus. */
    interactive?: boolean;
    /** v1's perspective tilt. */
    tilted?: boolean;
    shadowless?: boolean;
  }>(),
  { device: 'desktop' },
);
</script>

<style scoped>
.bohr-site-preview {
  position: relative;
  isolation: isolate;
  container-type: inline-size;
}

/* Blurred floor shadow (v1 .preview__container::before) */
.bohr-site-preview.has-shadow::before {
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

.bohr-site-preview__device {
  /* Bezel thickness follows the component width. */
  --bezel: clamp(5px, 2.2cqi, 18px);
  --rim: calc(var(--bezel) * 1.28 + 6px);
  --frame-dark: hsl(180 8% 8%);
  --frame-edge: hsl(196 9% 25%);
  --radius: var(--bohr-radius-md);

  position: relative;
  width: var(--bohr-site-preview-width, 100%);
  margin-inline: auto;
  aspect-ratio: 16 / 10;
  border-radius: var(--radius);
  transition:
    transform 800ms linear,
    width 800ms linear;
}

.bohr-site-preview__screen {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background-color: #fff;
}

/* Glass shine on the desktop window */
.bohr-site-preview--desktop .bohr-site-preview__device::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background-image: linear-gradient(200deg, transparent 29.08%, hsl(0 0% 100% / 0.2) 56.83%, transparent 57.84%);
  box-shadow: var(--bohr-shadow-glass);
  pointer-events: none;
}

/* Tablets and phones: dark bezel with a lighter edge, and side buttons */
.bohr-site-preview:not(.bohr-site-preview--desktop) .bohr-site-preview__device {
  --radius: calc(var(--bezel) * 2.1);

  margin-block: var(--rim);
  box-shadow:
    0 0 0 var(--bezel) var(--frame-dark),
    0 0 0 calc(var(--bezel) * 1.28) var(--frame-edge);
}

.bohr-site-preview--tabletLandscape .bohr-site-preview__device {
  width: var(--bohr-site-preview-width, calc(100% - 2 * var(--rim)));
  aspect-ratio: 4 / 3;
}

.bohr-site-preview--tabletPortrait .bohr-site-preview__device {
  width: var(--bohr-site-preview-width, min(60%, calc(100% - 2 * var(--rim))));
  aspect-ratio: 3 / 4;
}

.bohr-site-preview--phoneLandscape .bohr-site-preview__device {
  width: var(--bohr-site-preview-width, calc(100% - 2 * var(--rim)));
  aspect-ratio: 2 / 1;
}

.bohr-site-preview--phonePortrait .bohr-site-preview__device {
  width: var(--bohr-site-preview-width, min(42%, calc(100% - 2 * var(--rim))));
  aspect-ratio: 1 / 2;
}

.bohr-site-preview:not(.bohr-site-preview--desktop) .bohr-site-preview__device::before,
.bohr-site-preview:not(.bohr-site-preview--desktop) .bohr-site-preview__device::after {
  content: "";
  position: absolute;
  background-color: var(--frame-dark);
}

/* Power button */
.bohr-site-preview--tabletPortrait .bohr-site-preview__device::after,
.bohr-site-preview--phonePortrait .bohr-site-preview__device::after {
  top: 15%;
  right: calc(-1 * (var(--bezel) * 1.28 + 3px));
  width: 3px;
  height: 10%;
}

.bohr-site-preview--tabletLandscape .bohr-site-preview__device::after,
.bohr-site-preview--phoneLandscape .bohr-site-preview__device::after {
  top: calc(-1 * (var(--bezel) * 1.28 + 3px));
  left: 15%;
  width: 10%;
  height: 3px;
}

/* Volume buttons */
.bohr-site-preview--tabletPortrait .bohr-site-preview__device::before,
.bohr-site-preview--phonePortrait .bohr-site-preview__device::before {
  top: 15%;
  left: calc(-1 * (var(--bezel) * 1.28 + 3px));
  width: 3px;
  height: 20%;
  background: linear-gradient(var(--frame-dark) 16%, transparent 16% 30%, var(--frame-dark) 30% 61%, transparent 61% 69%, var(--frame-dark) 69%);
}

.bohr-site-preview--tabletLandscape .bohr-site-preview__device::before,
.bohr-site-preview--phoneLandscape .bohr-site-preview__device::before {
  bottom: calc(-1 * (var(--bezel) * 1.28 + 3px));
  left: 15%;
  width: 20%;
  height: 3px;
  background: linear-gradient(90deg, var(--frame-dark) 16%, transparent 16% 30%, var(--frame-dark) 30% 61%, transparent 61% 69%, var(--frame-dark) 69%);
}

.bohr-site-preview.is-tilted .bohr-site-preview__device {
  transform: perspective(1200px) rotate3d(-30, 75, -18, -24deg) rotateX(6deg);
}

.bohr-site-preview__iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  pointer-events: none;
}

.bohr-site-preview__iframe.is-interactive {
  pointer-events: auto;
}
</style>
