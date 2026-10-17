<template>
  <section id="faq" class="section" aria-labelledby="faq-title">
    <div class="container container--narrow">
      <h2 id="faq-title" class="section-title">{{ t('faq.title') }}</h2>
      <div class="faq">
        <details v-for="item in ITEMS" :key="item" class="faq__item">
          <summary class="faq__question">
            <span>{{ t(`faq.${item}.question`) }}</span>
            <ArrowIcon class="faq__chevron" direction="bottom" :size="14" gradient />
          </summary>
          <I18nT :keypath="`faq.${item}.answer`" tag="p" scope="global" class="faq__answer">
            <template #command><code class="inline-code">/rollback</code></template>
          </I18nT>
        </details>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ArrowIcon } from '@bohr/ui';
import { I18nT, useI18n } from 'vue-i18n';

const ITEMS = ['needCode', 'cost', 'data', 'telegram', 'model', 'mistakes', 'difference'] as const;

const { t } = useI18n();
</script>

<style scoped>
.faq {
  margin-top: clamp(32px, 5vw, 48px);
  border-top: 1px solid hsl(0 0% 100% / 0.12);
}

.faq__item {
  border-bottom: 1px solid hsl(0 0% 100% / 0.12);
}

.faq__question {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 4px;
  font-size: clamp(17px, 2vw, 20px);
  font-weight: 700;
  list-style: none;
  cursor: pointer;
  transition: color var(--bohr-transition);
}

.faq__question::-webkit-details-marker {
  display: none;
}

.faq__question:hover {
  color: var(--bohr-color-yellow);
}

.faq__question:focus-visible {
  outline-offset: -2px;
}

.faq__chevron {
  flex-shrink: 0;
  transition: transform var(--bohr-transition);
}

.faq__item[open] .faq__chevron {
  transform: rotate(180deg);
}

.faq__answer {
  max-width: 68ch;
  padding: 0 4px 24px;
  font-size: 17px;
  line-height: 1.6;
  color: hsl(0 0% 100% / 0.78);
}
</style>
