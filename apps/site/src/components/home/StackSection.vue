<template>
  <section id="stack" class="section" aria-labelledby="stack-title">
    <div class="container">
      <h2 id="stack-title" class="section-title">{{ t('stack.title') }}</h2>
      <p class="section-lead">{{ t('stack.text') }}</p>

      <div class="stack__table-wrap">
        <table class="stack__table">
          <caption class="bohr-visually-hidden">{{ t('stack.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('stack.from') }}</th>
              <th scope="col">{{ t('stack.to') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ROWS" :key="row">
              <th scope="row">{{ t(`stack.rows.${row}.from`) }}</th>
              <td>
                <span class="stack__to">
                  <ArrowIcon direction="right" :size="12" class="stack__arrow" gradient />
                  <span>{{ t(`stack.rows.${row}.to`) }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul class="stack__frameworks" role="list" :aria-label="t('stack.frameworks')">
        <li v-for="framework in FRAMEWORKS" :key="framework.file">
          <img
            :src="`/logos/${framework.file}.svg`"
            :alt="framework.name"
            :title="framework.name"
            height="44"
            loading="lazy"
            decoding="async"
          />
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ArrowIcon } from '@bohr/ui';
import { useI18n } from 'vue-i18n';

const ROWS = ['code', 'docker', 'compose', 'postgres', 'redis', 'queues', 'files'] as const;

// Same order as v1's "Use tools you love" row.
const FRAMEWORKS = [
  { file: 'next', name: 'Next.js' },
  { file: 'svelte', name: 'Svelte' },
  { file: 'angular', name: 'Angular' },
  { file: 'gatsby', name: 'Gatsby' },
  { file: 'remix', name: 'Remix' },
  { file: 'tailwind', name: 'Tailwind CSS' },
  { file: 'react', name: 'React' },
  { file: 'solid', name: 'SolidJS' },
  { file: 'nuxt', name: 'Nuxt' },
] as const;

const { t } = useI18n();
</script>

<style scoped>
.stack__table-wrap {
  max-width: 860px;
  margin: clamp(32px, 5vw, 48px) auto 0;
  overflow: hidden;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  background: linear-gradient(180deg, hsl(0 0% 100% / 0.05), hsl(0 0% 100% / 0.02));
  box-shadow: var(--bohr-shadow-card);
}

.stack__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 17px;
  text-align: left;
}

.stack__table thead th {
  padding: 16px 24px;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
  background: rgb(0 0 0 / 0.25);
}

.stack__table tbody th,
.stack__table td {
  width: 50%;
  padding: 16px 24px;
  vertical-align: top;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.stack__table tbody th {
  font-weight: 700;
}

.stack__table td {
  color: hsl(0 0% 100% / 0.85);
}

.stack__to {
  display: inline-flex;
  gap: 12px;
  align-items: center;
}

.stack__arrow {
  flex-shrink: 0;
}

.stack__frameworks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: clamp(24px, 4vw, 50px);
  margin-top: clamp(40px, 6vw, 64px);
}

.stack__frameworks img {
  width: auto;
  height: 44px;
}

@media (max-width: 479px) {
  .stack__table {
    font-size: 15px;
  }

  .stack__table thead th,
  .stack__table tbody th,
  .stack__table td {
    padding: 14px 14px;
  }

  .stack__frameworks img {
    height: 36px;
  }
}
</style>
