<template>
  <div class="site bohr-spotlight" :style="{ '--bohr-spotlight-y': spotlightY }">
    <a class="skip-link" href="#main">{{ t('common.skipToContent') }}</a>
    <SiteHeader />
    <main id="main" class="site__main" tabindex="-1">
      <RouterView />
    </main>
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import SiteFooter from './components/layout/SiteFooter.vue';
import SiteHeader from './components/layout/SiteHeader.vue';

const { t } = useI18n();
const route = useRoute();

// v1 moved its red spotlight per route; the home page centers it 800px down.
const spotlightY = computed(() => route.meta.spotlightY ?? 'top');
</script>

<style scoped>
.site {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-size: 16px;
  /* Decorative overflow (giant titles, glows) never causes horizontal scrolling. */
  overflow-x: clip;
}

.site__main {
  flex: 1;
}

.site__main:focus {
  outline: none;
}
</style>
