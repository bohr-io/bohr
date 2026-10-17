<template>
  <section id="get-started" class="section final-cta" aria-labelledby="final-cta-title">
    <div class="container">
      <h2 id="final-cta-title" class="final-cta__title">{{ t('cta.title') }}</h2>
      <div class="final-cta__actions">
        <a class="big-cta" href="#self-hosted">{{ t('hero.ctaInstall') }}</a>
        <a class="big-cta big-cta--ghost" :href="CLOUD_URL">{{ t('hero.ctaCloud') }}</a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { CLOUD_URL } from '../../config';

const { t } = useI18n();
</script>

<style scoped>
.final-cta {
  padding-bottom: clamp(72px, 10vw, 120px);
  text-align: center;
}

.final-cta__title {
  padding-bottom: 0.08em;
  font-size: clamp(48px, 10vw, 117px);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.06em;
  color: transparent;
  background-image: var(--bohr-gradient-fire);
  -webkit-background-clip: text;
  background-clip: text;
  filter: var(--bohr-shadow-display);
}

.final-cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 20px;
  margin-top: clamp(32px, 5vw, 56px);
}

/* v1's "Start creating now": big gradient button with dark text */
.big-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 20px 30px;
  border-radius: var(--bohr-radius-md);
  font-size: 20px;
  font-weight: 700;
  line-height: 30px;
  letter-spacing: -0.5px;
  text-transform: uppercase;
  color: var(--bohr-color-bg);
  background-image: var(--bohr-gradient-primary);
  box-shadow: 0 20px 50px -20px rgb(232 72 85 / 0.7);
  transition:
    filter var(--bohr-transition),
    transform var(--bohr-transition);
}

.big-cta:hover,
.big-cta:focus-visible {
  filter: brightness(1.08) saturate(1.1);
  transform: translateY(-2px);
}

.big-cta--ghost {
  position: relative;
  color: #fff;
  background: none;
  box-shadow: none;
}

.big-cta--ghost::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 2px solid transparent;
  border-radius: inherit;
  background: var(--bohr-gradient-primary) border-box;
  -webkit-mask:
    linear-gradient(#fff 0 0) padding-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) padding-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

@media (min-width: 576px) {
  .big-cta {
    padding-inline: 48px;
    font-size: 24px;
  }
}

@media (min-width: 1280px) {
  .big-cta {
    padding-inline: 72px;
  }
}

@media (max-width: 479px) {
  .big-cta {
    width: 100%;
  }
}
</style>
