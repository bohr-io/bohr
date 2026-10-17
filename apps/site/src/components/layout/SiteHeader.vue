<template>
  <header class="site-header">
    <div class="container site-header__inner">
      <RouterLink :to="pathFor('home')" class="site-header__logo" :aria-label="t('common.homeLink')">
        <BohrLogo />
      </RouterLink>
      <nav class="site-header__nav" :aria-label="t('common.mainNav')">
        <ul role="list">
          <li v-for="link in LINKS" :key="link.hash">
            <RouterLink :to="{ path: pathFor('home'), hash: link.hash }" class="site-header__link">
              {{ t(link.label) }}
            </RouterLink>
          </li>
          <li>
            <a :href="docsUrl(code)" class="site-header__link">{{ t('header.docs') }}</a>
          </li>
        </ul>
      </nav>
      <div class="site-header__actions">
        <LanguageSwitcher compact />
        <a :href="GITHUB_URL" class="site-header__github" :aria-label="t('header.github')" :title="t('header.github')">
          <GithubIcon :size="24" />
        </a>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { BohrLogo, GithubIcon } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { useSiteLocale } from '../../composables/useSiteLocale';
import { docsUrl, GITHUB_URL } from '../../config';
import LanguageSwitcher from './LanguageSwitcher.vue';

const LINKS = [
  { hash: '#how-it-works', label: 'header.howItWorks' },
  { hash: '#self-hosted', label: 'header.selfHosted' },
  { hash: '#plans', label: 'header.plans' },
  { hash: '#faq', label: 'header.faq' },
] as const;

const { t } = useI18n();
const { code, pathFor } = useSiteLocale();
</script>

<style scoped>
/* v1's translucent warm header with backdrop blur */
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background-color: rgb(24 11 2 / 0.92);
  border-bottom: 1px solid hsl(0 0% 100% / 0.06);
}

@supports (backdrop-filter: blur(0)) {
  .site-header {
    background-color: rgb(24 11 2 / 0.55);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
}

.site-header__inner {
  display: flex;
  align-items: center;
  gap: 24px;
  height: var(--header-height);
}

.site-header__logo {
  display: block;
  flex-shrink: 0;
  margin-right: auto;
}

.site-header__logo :deep(svg) {
  width: auto;
  height: 28px;
}

.site-header__nav ul {
  display: flex;
  gap: 28px;
}

.site-header__link {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  transition: color var(--bohr-transition);
}

.site-header__link:hover {
  color: var(--bohr-color-yellow);
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.site-header__github {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--bohr-radius-full);
  color: #fff;
  transition:
    color var(--bohr-transition),
    background-color var(--bohr-transition);
}

.site-header__github:hover {
  background-color: hsl(0 0% 100% / 0.08);
}

@media (max-width: 959px) {
  .site-header__nav {
    display: none;
  }
}

@media (max-width: 400px) {
  .site-header__inner {
    gap: 8px;
  }

  .site-header__logo :deep(svg) {
    height: 24px;
  }
}
</style>
