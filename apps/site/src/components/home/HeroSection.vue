<template>
  <section class="hero" aria-labelledby="hero-title">
    <div class="container">
      <h1 id="hero-title" class="hero__title" :style="{ '--line1-chars': line1.length, '--line2-chars': line2.length }">
        <span class="hero__line1">{{ line1 }}</span>{{ ' ' }}<span class="hero__line2">{{ line2 }}</span>
      </h1>
      <p class="hero__subtitle">{{ t('hero.subtitle') }}</p>
      <div class="hero__actions">
        <BohrButton size="lg" href="#self-hosted">{{ t('hero.ctaInstall') }}</BohrButton>
        <BohrButton size="lg" variant="ghost" :href="CLOUD_URL">{{ t('hero.ctaCloud') }}</BohrButton>
      </div>
      <p class="hero__license">
        <GithubIcon :size="16" />
        <a :href="GITHUB_URL" class="hero__license-link">{{ t('hero.license') }}</a>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrButton, GithubIcon } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CLOUD_URL, GITHUB_URL } from '../../config';

const { t } = useI18n();
const line1 = computed(() => t('hero.line1'));
const line2 = computed(() => t('hero.line2'));
</script>

<style scoped>
.hero {
  padding-block: clamp(40px, 7vw, 85px) clamp(56px, 8vw, 100px);
  text-align: center;
}

/*
 * v1's display type: 240px, bold, -0.1em tracking, two overlapping gradient lines.
 * Each line shrinks with the viewport based on its length, so no locale overflows.
 */
.hero__title {
  --available: calc(100vw - 2 * var(--gutter));
  --size: min(240px, calc(var(--available) / (var(--line1-chars) * 0.52 + 0.2)));

  margin: 0;
  font-size: var(--size);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: var(--bohr-letter-spacing-display);
  /* The tight tracking would otherwise swallow the space between words. */
  word-spacing: 0.08em;
}

.hero__line1,
.hero__line2 {
  display: block;
  width: fit-content;
  margin-inline: auto;
  padding-right: 0.1em;
  padding-bottom: 0.12em;
  white-space: nowrap;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
}

.hero__line1 {
  margin-bottom: -0.12em;
  background-image: var(--bohr-gradient-fire);
}

/* "manage less." in v1: smaller, cool gradient, overlapping the lower half of line 1 */
.hero__line2 {
  position: relative;
  margin-top: -0.62em;
  padding-left: 0.6em;
  font-size: min(0.71em, calc(var(--available) / (var(--line2-chars) * 0.52 + 0.9)));
  background-image: var(--bohr-gradient-cool);
  filter: var(--bohr-shadow-display);
}

.hero__subtitle {
  max-width: 640px;
  margin: clamp(24px, 4vw, 40px) auto 0;
  font-size: clamp(17px, 2vw, 20px);
  line-height: 1.55;
  color: var(--bohr-color-text-muted);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-top: 36px;
}

.hero__license {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  font-size: 14px;
  color: var(--bohr-color-text-muted);
}

.hero__license-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: hsl(0 0% 100% / 0.3);
  text-underline-offset: 0.2em;
}

.hero__license-link:hover {
  color: #fff;
  text-decoration-color: currentColor;
}

@media (max-width: 479px) {
  .hero__actions > * {
    width: 100%;
  }
}
</style>
