<template>
  <div class="bohr-main-bar" :class="{ 'is-open': open }">
    <button
      type="button"
      class="bohr-main-bar__toggle"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-label="open ? closeLabel : openLabel"
      @click="open = !open"
    >
      <svg v-if="!open" width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true" focusable="false">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0 1C0 0.447715 0.447715 0 1 0H15C15.5523 0 16 0.447715 16 1C16 1.55228 15.5523 2 15 2H1C0.447715 2 0 1.55228 0 1ZM0 11C0 10.4477 0.447715 10 1 10H15C15.5523 10 16 10.4477 16 11C16 11.5523 15.5523 12 15 12H1C0.447715 12 0 11.5523 0 11ZM1 5C0.447715 5 0 5.44772 0 6C0 6.55228 0.447715 7 1 7H15C15.5523 7 16 6.55228 16 6C16 5.44772 15.5523 5 15 5H1Z"
          fill="white"
        />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M15 0C14.4477 0 14 0.447715 14 1V15C14 15.5523 14.4477 16 15 16C15.5523 16 16 15.5523 16 15V1C16 0.447715 15.5523 0 15 0ZM10.9497 8.0498C10.9497 7.49752 10.502 7.0498 9.94967 7.0498H3.36452L5.94975 4.46458C6.34027 4.07406 6.34027 3.44089 5.94975 3.05037C5.55922 2.65984 4.92606 2.65984 4.53553 3.05037L0.292893 7.29301C-0.0976311 7.68353 -0.0976311 8.3167 0.292893 8.70722L0.310467 8.72438L4.53599 12.9499C4.92651 13.3404 5.55968 13.3404 5.9502 12.9499C6.34072 12.5594 6.34072 11.9262 5.9502 11.5357L3.46432 9.0498H9.94967C10.502 9.0498 10.9497 8.60209 10.9497 8.0498Z"
          fill="white"
        />
      </svg>
    </button>
    <div class="bohr-main-bar__backdrop" aria-hidden="true" @click="open = false" />
    <aside :id="panelId" class="bohr-main-bar__panel" :aria-label="label">
      <component :is="logoAs ?? 'a'" :href="logoHref" :to="logoTo" class="bohr-main-bar__logo" :aria-label="logoLabel">
        <slot name="logo">
          <img :src="logoIcon" alt="" width="40" height="40" />
        </slot>
      </component>
      <nav class="bohr-main-bar__nav" :aria-label="navLabel">
        <ul role="list">
          <slot />
        </ul>
      </nav>
      <div v-if="$slots.footer" class="bohr-main-bar__footer">
        <slot name="footer" />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId } from 'vue';
import logoIcon from '../assets/main-bar/bohr-logo-icon.svg';
import type { AsProp } from '../types';

withDefaults(
  defineProps<{
    logoHref?: string;
    /** Custom root for the logo link, e.g. RouterLink together with `logoTo`. */
    logoAs?: AsProp;
    logoTo?: string | Record<string, unknown>;
    logoLabel?: string;
    label?: string;
    navLabel?: string;
    openLabel?: string;
    closeLabel?: string;
  }>(),
  {
    logoHref: '/',
    logoLabel: 'bohr.io',
    label: 'Sidebar',
    navLabel: 'Main',
    openLabel: 'Open menu',
    closeLabel: 'Close menu',
  },
);

/** Off-canvas state below 1280px. */
const open = defineModel<boolean>('open', { default: false });

const panelId = `bohr-main-bar-${useId()}`;

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) open.value = false;
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.bohr-main-bar {
  --nav-shadow-color: hsl(191 100% 50% / 0.5);

  position: sticky;
  top: 0;
  z-index: var(--bohr-z-sidebar);
  flex-shrink: 0;
  width: var(--bohr-sidebar-width);
  height: 100vh;
}

.bohr-main-bar__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-image: var(--bohr-gradient-sidebar);
}

/* Logo area with the curved bottom edge */
.bohr-main-bar__logo {
  position: relative;
  z-index: 0;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 100%;
  height: 99px;
  background: url("../assets/main-bar/logo-bg-96.svg") no-repeat top center / 100% 100%;
}

.bohr-main-bar__logo::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: -1;
  transition: box-shadow var(--bohr-transition);
}

.bohr-main-bar__logo:hover::before,
.bohr-main-bar__logo:focus-visible::before {
  box-shadow: 0 0 25px 12px var(--nav-shadow-color);
}

.bohr-main-bar__logo:focus-visible {
  outline-offset: -4px;
}

.bohr-main-bar__nav {
  flex: 1;
  margin-top: 32px;
  overflow-y: auto;
}

.bohr-main-bar__nav ul {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Each link carries its caption under the icon */
  gap: 18px;
  margin: 0;
  padding: 12px 0;
  list-style: none;
}

/* Footer with a concave top edge, matching the logo curve */
.bohr-main-bar__footer {
  flex-shrink: 0;
  min-height: 86px;
  padding: 20px 8px 16px;
  background-image: linear-gradient(180deg, #20333e 0%, #0e171d 100%);
  -webkit-mask-image: radial-gradient(50% 5px at 50% 0, transparent 98%, #000 100%);
  mask-image: radial-gradient(50% 5px at 50% 0, transparent 98%, #000 100%);
}

.bohr-main-bar__toggle,
.bohr-main-bar__backdrop {
  display: none;
}

/* Off-canvas below 1280px */
@media (max-width: 1279px) {
  .bohr-main-bar {
    position: static;
    width: 0;
    height: 0;
  }

  .bohr-main-bar__panel {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2;
    width: var(--bohr-sidebar-width);
    height: 100vh;
    height: 100dvh;
    visibility: hidden;
    transform: translateX(-100%);
    transition:
      transform var(--bohr-transition),
      visibility 0s linear var(--bohr-transition);
  }

  .bohr-main-bar.is-open .bohr-main-bar__panel {
    visibility: visible;
    transform: none;
    transition: transform var(--bohr-transition);
  }

  .bohr-main-bar__toggle {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 0;
    background: none;
    transition: transform var(--bohr-transition);
  }

  .bohr-main-bar.is-open .bohr-main-bar__toggle {
    transform: translateX(var(--bohr-sidebar-width));
  }

  .bohr-main-bar.is-open .bohr-main-bar__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
    display: block;
    background: #000;
    opacity: 0.5;
  }
}
</style>
