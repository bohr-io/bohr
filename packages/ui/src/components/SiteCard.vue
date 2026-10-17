<template>
  <BohrBox variant="glass" :interactive="isLink" :as="tag" :href="href" class="bohr-site-card">
    <div class="bohr-site-card__image">
      <img v-if="imageSrc" :src="imageSrc" alt="" loading="lazy" decoding="async" />
    </div>
    <div class="bohr-site-card__info">
      <img
        v-if="faviconSrc && !faviconFailed"
        class="bohr-site-card__favicon"
        :src="faviconSrc"
        width="36"
        height="36"
        alt=""
        @error="faviconFailed = true"
      />
      <BohrLogo v-else icon-only class="bohr-site-card__favicon" />
      <div class="bohr-site-card__text">
        <BohrTypography v-if="org" tag="p" variant="body1" class="bohr-site-card__org">{{ org }}</BohrTypography>
        <BohrTypography tag="p" variant="title3" class="bohr-site-card__name">{{ name }}</BohrTypography>
      </div>
    </div>
  </BohrBox>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AsProp } from '../types';
import BohrBox from './BohrBox.vue';
import BohrLogo from './BohrLogo.vue';
import BohrTypography from './BohrTypography.vue';

const props = defineProps<{
  name: string;
  org?: string;
  /** Screenshot of the site. */
  imageSrc?: string;
  faviconSrc?: string;
  href?: string;
  /** Custom root (e.g. RouterLink); pass `to` as an attribute. */
  as?: AsProp;
}>();

const faviconFailed = ref(false);
const tag = computed(() => props.as ?? (props.href ? 'a' : 'div'));
const isLink = computed(() => Boolean(props.as || props.href));
</script>

<style scoped>
.bohr-site-card {
  position: relative;
  z-index: 0;
  display: block;
  width: 100%;
  aspect-ratio: 1.75;
  color: inherit;
  text-decoration: none;
}

.bohr-site-card__image {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  border-radius: var(--bohr-box-radius);
  background-color: #000;
}

.bohr-site-card__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.bohr-site-card__info {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-content: end;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-radius: var(--bohr-box-radius);
  text-align: left;
  background-image:
    linear-gradient(0deg, rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.2)),
    linear-gradient(180deg, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0.6375) 66.67%);
}

.bohr-site-card__favicon {
  width: 36px;
  height: 36px;
  border-radius: var(--bohr-radius-sm);
}

.bohr-site-card__text {
  min-width: 0;
}

.bohr-site-card__org,
.bohr-site-card__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bohr-site-card__name::before {
  content: "/";
  margin-right: 4px;
  color: #666;
}
</style>
