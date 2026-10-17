<template>
  <div class="store">
    <div class="store__bar">
      <span class="store__brand">{{ t('demo.store.name') }}</span>
      <svg class="store__cart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M3 4h2l2.4 10.2a1.5 1.5 0 0 0 1.5 1.1h8.6a1.5 1.5 0 0 0 1.4-1l2.1-6.3H6.2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="9.5" cy="19" r="1.4" fill="currentColor" />
        <circle cx="17" cy="19" r="1.4" fill="currentColor" />
      </svg>
    </div>
    <div class="store__body">
      <div class="store__image">
        <svg viewBox="0 0 120 90" aria-hidden="true" focusable="false">
          <ellipse cx="60" cy="74" rx="44" ry="6" fill="rgb(0 0 0 / 0.12)" />
          <path
            d="M18 62c0-6 3-9 8-10l20-4c6-6 10-16 13-24 2-4 7-4 9 0l6 12c4 7 14 10 24 12 6 1 9 5 9 10v6c0 2-2 4-4 4H22c-2 0-4-2-4-4z"
            fill="#f26419"
          />
          <path d="M18 64h92v4c0 2-2 4-4 4H22c-2 0-4-2-4-4z" fill="#0e171d" />
          <path d="M52 44l10 4m-6-12 10 4m-6-12 9 4" stroke="#fff" stroke-width="3" stroke-linecap="round" />
        </svg>
      </div>
      <div class="store__details">
        <p class="store__product">{{ t('demo.store.product') }}</p>
        <p class="store__price">{{ t('demo.store.price') }}</p>
        <p class="store__label">{{ t('demo.store.payment') }}</p>
        <div class="store__options">
          <span class="store__option">
            <span class="store__radio" />
            {{ t('demo.store.card') }}
          </span>
          <span class="store__option is-selected">
            <span class="store__radio" />
            {{ t('demo.store.pix') }}
          </span>
        </div>
        <span class="store__buy">{{ t('demo.store.buy') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<style scoped>
/* Sized in container units of the surrounding SitePreview, so it scales with the frame. */
.store {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 3.2cqi;
  line-height: 1.25;
  color: #10181d;
  background: #fff;
}

.store__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2.6cqi 4cqi;
  border-bottom: 1px solid #e8ecef;
}

.store__brand {
  font-weight: 700;
  letter-spacing: -0.02em;
}

.store__cart {
  width: 4.8cqi;
  height: 4.8cqi;
}

.store__body {
  display: grid;
  flex: 1;
  grid-template-columns: 44% 1fr;
  gap: 4cqi;
  align-items: center;
  padding: 3cqi 4cqi;
}

.store__image {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: 2cqi;
  background: linear-gradient(160deg, #fdf0e6, #f7d9c4);
}

.store__image svg {
  width: 88%;
}

.store__details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1.2cqi;
}

.store__product {
  font-size: 4.2cqi;
  font-weight: 700;
}

.store__price {
  font-size: 4.6cqi;
  font-weight: 700;
  color: #0e171d;
}

.store__label {
  margin-top: 1cqi;
  font-size: 2.8cqi;
  color: #5b6770;
}

.store__options {
  display: flex;
  flex-wrap: wrap;
  gap: 1.6cqi;
}

.store__option {
  display: inline-flex;
  align-items: center;
  gap: 1.2cqi;
  padding: 1cqi 2.2cqi;
  border: 1px solid #d6dde2;
  border-radius: 1.4cqi;
  font-size: 3cqi;
  font-weight: 700;
}

.store__option.is-selected {
  border-color: #1fa54a;
  box-shadow: 0 0 0 1px #1fa54a;
}

.store__radio {
  width: 2.4cqi;
  height: 2.4cqi;
  border: 1px solid #9aa6ae;
  border-radius: 50%;
}

.is-selected .store__radio {
  border: 0.7cqi solid #1fa54a;
}

.store__buy {
  margin-top: 1.4cqi;
  padding: 1.6cqi 6cqi;
  border-radius: 1.4cqi;
  font-size: 3.4cqi;
  font-weight: 700;
  color: #0e171d;
  background: var(--bohr-color-green);
}
</style>
