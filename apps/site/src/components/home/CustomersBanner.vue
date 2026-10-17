<template>
  <section id="customers" class="section customers-section" aria-labelledby="customers-title">
    <div class="container">
      <BohrBox variant="outline-highlight" class="customers">
        <div class="customers__text">
          <h2 id="customers-title" class="customers__title">{{ t('customers.title') }}</h2>
          <p class="customers__body">{{ t('customers.text') }}</p>
        </div>
        <RouterLink :to="pathFor('migration')" class="customers__link">
          {{ t('customers.link') }}
          <ArrowIcon direction="right" :size="16" />
        </RouterLink>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrBox } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { useSiteLocale } from '../../composables/useSiteLocale';

const { t } = useI18n();
const { pathFor } = useSiteLocale();
</script>

<style scoped>
.customers-section {
  padding-block: clamp(24px, 4vw, 48px);
}

.customers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px 48px;
  padding: clamp(24px, 4vw, 40px) clamp(20px, 5vw, 56px);
  background: linear-gradient(90deg, hsl(var(--bohr-hsl-highlight) / 0.08), transparent 70%);
}

.customers__text {
  flex: 1 1 420px;
}

.customers__title {
  font-size: clamp(24px, 3vw, 30px);
  color: var(--bohr-color-cyan);
}

.customers__body {
  max-width: 62ch;
  margin-top: 10px;
  font-size: 17px;
  line-height: 1.55;
  color: hsl(0 0% 100% / 0.82);
}

.customers__link {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--bohr-color-cyan);
  text-decoration: underline;
  text-decoration-color: hsl(var(--bohr-hsl-cyan) / 0.4);
  text-underline-offset: 0.25em;
}

.customers__link:hover {
  text-decoration-color: currentColor;
}

.customers__link :deep(svg) {
  transition: transform var(--bohr-transition);
}

.customers__link:hover :deep(svg) {
  transform: translateX(4px);
}
</style>
