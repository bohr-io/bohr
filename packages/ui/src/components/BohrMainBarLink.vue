<template>
  <li class="bohr-main-bar-link">
    <component
      :is="as ?? 'a'"
      :href="href"
      class="bohr-main-bar-link__anchor"
      :class="{ 'is-active': active }"
      :aria-current="active ? 'page' : undefined"
      :title="label"
    >
      <span class="bohr-main-bar-link__icon" aria-hidden="true"><slot /></span>
      <span class="bohr-main-bar-link__label">{{ label }}</span>
      <!-- What the icon is, under it; the accessible name stays the full label above. -->
      <span v-if="caption !== ''" class="bohr-main-bar-link__caption" aria-hidden="true">{{ caption ?? label }}</span>
    </component>
  </li>
</template>

<script setup lang="ts">
import type { AsProp } from '../types';

defineProps<{
  /** Accessible name; shown as a tooltip on the thin bar. */
  label: string;
  /** The short text shown under the icon (defaults to the label; an empty string shows none). */
  caption?: string;
  href?: string;
  /** Custom root (e.g. RouterLink); pass `to` as an attribute. */
  as?: AsProp;
  /** Current section: keeps the glow on and sets aria-current. */
  active?: boolean;
}>();
</script>

<style scoped>
.bohr-main-bar-link {
  display: flex;
  justify-content: center;
  width: 100%;
}

.bohr-main-bar-link__anchor {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  /* The bar is 96px wide: a caption gets most of it, with a little air on each side */
  width: calc(var(--bohr-sidebar-width, 96px) - 12px);
  min-height: 40px;
  padding: 8px 0 6px;
  border-radius: var(--bohr-radius-sm);
  color: #fff;
}

.bohr-main-bar-link__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
}

/* v1 NavIcon glow */
.bohr-main-bar-link__icon::before {
  content: "";
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: -1;
  transition: box-shadow var(--bohr-transition);
}

.bohr-main-bar-link__anchor:hover .bohr-main-bar-link__icon::before,
.bohr-main-bar-link__anchor:focus-visible .bohr-main-bar-link__icon::before,
.bohr-main-bar-link__anchor.is-active .bohr-main-bar-link__icon::before {
  box-shadow: 0 0 25px 12px var(--nav-shadow-color, #ffd000);
}

.bohr-main-bar-link__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.bohr-main-bar-link__caption {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: hsl(0 0% 100% / 0.72);
  transition: color var(--bohr-transition);
}

.bohr-main-bar-link__anchor:hover .bohr-main-bar-link__caption,
.bohr-main-bar-link__anchor:focus-visible .bohr-main-bar-link__caption,
.bohr-main-bar-link__anchor.is-active .bohr-main-bar-link__caption {
  color: #fff;
}
</style>
