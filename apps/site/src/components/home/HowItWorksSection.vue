<template>
  <section id="how-it-works" class="section" aria-labelledby="how-title">
    <div class="container">
      <BohrBox color="orange" class="how">
        <img
          class="how__atom"
          src="/images/bohr-logo-texture.png"
          alt=""
          width="409"
          height="409"
          loading="lazy"
          decoding="async"
        />
        <div class="how__content">
          <h2 id="how-title" class="box-title gradient-text gradient-text--fire">{{ t('how.title') }}</h2>
          <ol class="how__steps" role="list">
            <li v-for="(step, index) in STEPS" :key="step" class="how__step">
              <span class="how__number gradient-text gradient-text--fire" aria-hidden="true">{{ index + 1 }}</span>
              <div>
                <h3 class="how__step-title">{{ t(`how.${step}.title`) }}</h3>
                <I18nT :keypath="`how.${step}.text`" tag="p" scope="global" class="how__step-text">
                  <template #command><code class="inline-code">/rollback</code></template>
                </I18nT>
              </div>
            </li>
          </ol>
        </div>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrBox } from '@bohr/ui';
import { I18nT, useI18n } from 'vue-i18n';

const STEPS = ['connect', 'ask', 'review', 'approve'] as const;

const { t } = useI18n();
</script>

<style scoped>
/* v1's orange box with the low-poly texture and the low-poly atom */
.how {
  display: grid;
  gap: clamp(24px, 6vw, 80px);
  align-items: center;
  padding: clamp(24px, 7vw, 100px);
  background-image: url("/images/shapes-bg.png");
}

.how__atom {
  width: 100%;
  max-width: 200px;
  margin-inline: auto;
}

.how__steps {
  display: grid;
  gap: 28px;
  margin-top: 32px;
}

.how__step {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 16px;
  align-items: start;
}

.how__number {
  font-size: 52px;
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: -0.06em;
  text-align: center;
}

.how__step-title {
  font-size: clamp(20px, 2.4vw, 24px);
}

.how__step-text {
  margin-top: 6px;
  font-size: 17px;
  line-height: 1.55;
  color: hsl(0 0% 100% / 0.78);
}

@media (min-width: 900px) {
  .how {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  }

  .how__atom {
    max-width: 409px;
  }
}
</style>
