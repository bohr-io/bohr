<template>
  <section id="plans" class="section" aria-labelledby="plans-title">
    <div class="container">
      <BohrBox color="red" class="plans">
        <h2 id="plans-title" class="plans__title">{{ t('plans.title') }}</h2>
        <ul class="plans__list" role="list">
          <li v-for="plan in PLANS" :key="plan.key">
            <BohrBox color="red" class="plan" :class="{ 'plan--highlight': plan.highlight }">
              <svg class="plan__icon" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
                <g
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <template v-if="plan.icon === 'branch'">
                    <circle cx="26" cy="18" r="7" />
                    <circle cx="26" cy="62" r="7" />
                    <circle cx="56" cy="30" r="7" />
                    <path d="M26 25v30M56 37c0 12-12 13-25 20" />
                  </template>
                  <path
                    v-else-if="plan.icon === 'cloud'"
                    d="M22 58h36a12 12 0 0 0 1.6-23.9A17 17 0 0 0 26.6 31 12.5 12.5 0 0 0 22 58z"
                  />
                  <template v-else>
                    <rect x="14" y="16" width="52" height="14" rx="4" />
                    <rect x="14" y="34" width="52" height="14" rx="4" />
                    <rect x="14" y="52" width="52" height="14" rx="4" />
                    <path d="M22 23h.01M22 41h.01M22 59h.01M34 23h22M34 41h22M34 59h22" />
                  </template>
                </g>
              </svg>
              <h3 class="plan__name">{{ t(`plans.${plan.key}.name`) }}</h3>
              <p class="plan__price">{{ t(`plans.${plan.key}.price`) }}</p>
              <p class="plan__tagline">{{ t(`plans.${plan.key}.tagline`) }}</p>
              <ul class="plan__features" role="list">
                <li v-for="feature in plan.features" :key="feature" class="plan__feature">
                  <span class="plan__check"><CheckIcon :size="12" /></span>
                  <span>{{ t(`plans.${plan.key}.features.${feature}`) }}</span>
                </li>
              </ul>
              <a class="plan__cta" :href="plan.href">{{ t(`plans.${plan.key}.cta`) }}</a>
            </BohrBox>
          </li>
        </ul>
        <p class="plans__note">{{ t('plans.note') }}</p>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrBox, CheckIcon } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { CLOUD_URL } from '../../config';

const PLANS = [
  {
    key: 'openSource',
    icon: 'branch',
    href: '#self-hosted',
    features: ['all', 'unlimited', 'infra'],
    highlight: false,
  },
  { key: 'cloud', icon: 'cloud', href: CLOUD_URL, features: ['noInstall', 'yourAccount', 'infra'], highlight: true },
] as const;

const { t } = useI18n();
</script>

<style scoped>
/* v1 pricing block: red box, red title, red plan cards, corner price tag */
.plans {
  padding: clamp(20px, 4vw, 48px) clamp(16px, 3vw, 32px) clamp(24px, 4vw, 40px);
  background: linear-gradient(180deg, hsl(var(--bohr-hsl-red) / 0.1) 0%, transparent 50%);
}

.plans__title {
  margin-block: clamp(8px, 3vw, 32px) clamp(28px, 4vw, 48px);
  font-size: clamp(28px, 4vw, 35px);
  text-align: center;
  color: var(--bohr-color-red);
}

.plans__list {
  display: grid;
  gap: 24px;
}

.plans__list > li {
  display: flex;
}

.plan {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-height: 320px;
  padding: 24px clamp(20px, 4vw, 40px) 32px;
  text-align: center;
  background-color: rgb(0 0 0 / 0.4);
}

.plan__icon {
  width: 80px;
  height: 80px;
  color: var(--bohr-color-red);
  filter: drop-shadow(0 0 10px rgb(232 72 85 / 0.45));
}

.plan__name {
  margin-block: 8px 6px;
  font-size: 20px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--bohr-color-red);
}

/* v1's bordered price tag, kept in the flow so long prices never cover the icon */
.plan__price {
  margin-bottom: 12px;
  padding: 8px 16px;
  border: 1px solid currentColor;
  border-radius: 5px;
  font-size: 22px;
  letter-spacing: 0.5px;
  color: #fff;
}

.plan__tagline {
  max-width: 28ch;
  font-size: 16px;
  line-height: 1.45;
  color: var(--bohr-color-text-muted);
}

.plan__features {
  display: grid;
  gap: 14px;
  margin: 28px 0 36px;
  text-align: left;
}

.plan__feature {
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 10px;
  align-items: start;
  font-size: 15px;
  line-height: 1.5;
  letter-spacing: 0.3px;
}

.plan__check {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-red);
  background: rgb(0 0 0 / 0.46);
}

.plan__check :deep(svg) {
  filter: drop-shadow(0 0 4px var(--bohr-color-red));
}

.plan__cta {
  margin-top: auto;
  padding: 13px 36px;
  border-radius: var(--bohr-radius-md);
  font-size: 18px;
  font-weight: 700;
  line-height: 18px;
  color: #000;
  background-color: var(--bohr-color-red);
  transition: filter var(--bohr-transition);
}

.plan__cta:hover,
.plan__cta:focus-visible {
  filter: brightness(0.85);
}

.plan--highlight {
  background-color: #3d151a;
}

.plan--highlight .plan__price {
  color: var(--bohr-color-red);
}

.plan--highlight .plan__tagline,
.plan--highlight .plan__feature {
  color: #fff;
}

.plan--highlight .plan__cta {
  color: #b52a37;
  background-color: #fff;
}

.plans__note {
  margin-top: 28px;
  font-size: 14px;
  text-align: center;
  color: var(--bohr-color-text-muted);
}

@media (min-width: 992px) {
  .plans__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 880px;
    margin-inline: auto;
  }
}

@media (min-width: 640px) and (max-width: 991px) {
  .plans__list {
    max-width: 520px;
    margin-inline: auto;
  }
}
</style>
