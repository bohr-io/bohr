<template>
  <div class="container migration">
    <BohrPageTitle :title="t('migration.title')" :shadow-text="t('migration.shadow')" class="migration__title" />
    <p class="migration__lead">{{ t('migration.lead') }}</p>

    <BohrBox color="orange" class="migration__box">
      <ol class="migration__steps" role="list" :aria-label="t('migration.stepsLabel')">
        <li v-for="(step, index) in STEPS" :key="step" class="migration__step">
          <span class="migration__number gradient-text gradient-text--fire" aria-hidden="true">{{ index + 1 }}</span>
          <p>{{ t(`migration.steps.${step}`) }}</p>
        </li>
      </ol>
    </BohrBox>

    <div class="migration__notes">
      <I18nT keypath="migration.agent" tag="p" scope="global">
        <template #panel>
          <a :href="CLOUD_URL" class="text-link">{{ t('migration.panel') }}</a>
        </template>
      </I18nT>
      <I18nT keypath="migration.questions" tag="p" scope="global">
        <template #discord>
          <a :href="DISCORD_URL" class="text-link">Discord</a>
        </template>
        <template #email>
          <a :href="`mailto:${CONTACT_EMAIL}`" class="text-link">{{ CONTACT_EMAIL }}</a>
        </template>
      </I18nT>
    </div>

    <RouterLink :to="pathFor('home')" class="migration__back">
      <ArrowIcon direction="left" :size="14" />
      {{ t('migration.back') }}
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrBox, BohrPageTitle } from '@bohr/ui';
import { I18nT, useI18n } from 'vue-i18n';
import { usePageHead } from '../composables/usePageHead';
import { useSiteLocale } from '../composables/useSiteLocale';
import { CLOUD_URL, CONTACT_EMAIL, DISCORD_URL } from '../config';

const STEPS = ['workflow', 'infrastructure', 'previous', 'price'] as const;

const { t } = useI18n();
const { pathFor } = useSiteLocale();

usePageHead('migration');
</script>

<style scoped>
/* v1 app page spacing: title with the giant shadow word, then content */
.migration {
  max-width: calc(900px + 2 * var(--gutter));
  padding-top: clamp(64px, 10vw, 120px);
  padding-bottom: clamp(64px, 10vw, 120px);
}

.migration__title :deep(h1) {
  font-size: clamp(34px, 6vw, 48px);
  line-height: 1.15;
}

.migration__lead {
  max-width: 640px;
  margin-top: 24px;
  font-size: clamp(18px, 2.2vw, 22px);
  line-height: 1.55;
  color: hsl(0 0% 100% / 0.85);
}

.migration__box {
  margin-top: clamp(40px, 6vw, 64px);
  padding: clamp(24px, 5vw, 56px);
  background-image: url("/images/shapes-bg.png");
}

.migration__steps {
  display: grid;
  gap: 28px;
}

.migration__step {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 16px;
  align-items: start;
  font-size: 18px;
  line-height: 1.55;
}

.migration__number {
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.06em;
  text-align: center;
}

.migration__notes {
  display: grid;
  gap: 16px;
  margin-top: 48px;
  font-size: 18px;
  line-height: 1.6;
  color: hsl(0 0% 100% / 0.85);
}

.migration__back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-top: 48px;
  font-weight: 700;
  color: var(--bohr-color-cyan);
}

.migration__back:hover {
  text-decoration: underline;
}
</style>
