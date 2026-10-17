<template>
  <nav class="language-switcher" :class="{ 'is-compact': compact }" :aria-label="t('common.language')">
    <ul role="list" class="language-switcher__list">
      <li v-for="item in LOCALES" :key="item.code">
        <RouterLink
          :to="pathFor(page, item.code)"
          class="language-switcher__link"
          :class="{ 'is-current': item.code === code }"
          :hreflang="item.hreflang"
          :lang="item.htmlLang"
          :title="compact ? item.name : undefined"
        >
          <template v-if="compact">
            <span aria-hidden="true">{{ item.short }}</span>
            <span class="bohr-visually-hidden">{{ item.name }}</span>
          </template>
          <template v-else>{{ item.name }}</template>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useSiteLocale } from '../../composables/useSiteLocale';
import { LOCALES } from '../../i18n/locales';

defineProps<{
  /** Two-letter codes, for the header. */
  compact?: boolean;
}>();

const { t } = useI18n();
const { code, page, pathFor } = useSiteLocale();
</script>

<style scoped>
.language-switcher__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
}

.language-switcher__link {
  display: inline-block;
  padding: 6px 2px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
  border-bottom: 2px solid transparent;
  transition:
    color var(--bohr-transition),
    border-color var(--bohr-transition);
}

.language-switcher__link:hover {
  color: #fff;
}

.language-switcher__link.is-current {
  color: #fff;
  border-bottom-color: var(--bohr-color-frame);
}

.is-compact .language-switcher__list {
  gap: 2px;
}

.is-compact .language-switcher__link {
  padding: 6px 8px;
  font-size: 13px;
  letter-spacing: 0.04em;
}
</style>
