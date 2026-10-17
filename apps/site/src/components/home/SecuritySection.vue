<template>
  <section id="security" class="section" aria-labelledby="security-title">
    <div class="container">
      <BohrBox color="red" class="security">
        <div class="security__head">
          <h2 id="security-title" class="box-title gradient-text gradient-text--primary">{{ t('security.title') }}</h2>
          <svg class="security__shield" viewBox="0 0 120 140" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient :id="`${id}-stroke`" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#f26419" />
                <stop offset="1" stop-color="#e84855" />
              </linearGradient>
              <linearGradient :id="`${id}-shine`" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0.3" stop-color="#fff" stop-opacity="0.02" />
                <stop offset="0.56" stop-color="#fff" stop-opacity="0.16" />
                <stop offset="0.57" stop-color="#fff" stop-opacity="0.03" />
              </linearGradient>
            </defs>
            <path
              d="M60 6 108 24v40c0 32-21 58-48 70C33 122 12 96 12 64V24z"
              :fill="`url(#${id}-shine)`"
              :stroke="`url(#${id}-stroke)`"
              stroke-width="3"
              stroke-linejoin="round"
            />
            <path
              d="M40 70l14 14 28-30"
              fill="none"
              stroke="#e84855"
              stroke-width="7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <ul class="security__list" role="list">
          <li v-for="item in ITEMS" :key="item" class="security__item">
            <span class="security__check"><CheckIcon :size="14" /></span>
            <span>{{ t(`security.${item}`) }}</span>
          </li>
        </ul>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrBox, CheckIcon } from '@bohr/ui';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const ITEMS = ['approval', 'members', 'sandbox', 'tokens', 'rollback'] as const;

const { t } = useI18n();
const id = `security-${useId()}`;
</script>

<style scoped>
.security {
  display: grid;
  gap: clamp(28px, 5vw, 64px);
  align-items: center;
  padding: clamp(24px, 7vw, 96px);
  background: linear-gradient(180deg, hsl(var(--bohr-hsl-red) / 0.1) 0%, transparent 60%);
}

.security__head {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.security__shield {
  display: none;
  width: 120px;
  filter: drop-shadow(0 18px 30px rgb(232 72 85 / 0.35));
}

.security__list {
  display: grid;
  gap: 18px;
}

.security__item {
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 14px;
  align-items: start;
  font-size: 17px;
  line-height: 1.5;
}

/* v1's plan checkmark: dark disc, red check with a red glow */
.security__check {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-red);
  background: rgb(0 0 0 / 0.46);
}

.security__check :deep(svg) {
  filter: drop-shadow(0 0 5px var(--bohr-color-red));
}

@media (min-width: 992px) {
  .security {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  }

  .security__shield {
    display: block;
  }
}
</style>
