<template>
  <nav class="admin-pagination" :aria-label="t('admin.pagination.label')">
    <p class="admin-pagination__summary" role="status">
      {{ t('admin.pagination.summary', { page, pages, total }) }}
    </p>
    <div v-if="pages > 1" class="actions">
      <BohrButton
        size="sm"
        variant="ghost"
        :as="RouterLink"
        :to="{ query: pageQuery(page - 1) }"
        :disabled="page <= 1"
        :tabindex="page <= 1 ? -1 : undefined"
        data-page="previous"
        :class="{ 'is-disabled': page <= 1 }"
      >
        {{ t('admin.pagination.previous') }}
      </BohrButton>
      <BohrButton
        size="sm"
        variant="ghost"
        :as="RouterLink"
        :to="{ query: pageQuery(page + 1) }"
        :disabled="page >= pages"
        :tabindex="page >= pages ? -1 : undefined"
        data-page="next"
        :class="{ 'is-disabled': page >= pages }"
      >
        {{ t('admin.pagination.next') }}
      </BohrButton>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { type LocationQueryRaw, RouterLink } from 'vue-router';

defineProps<{
  page: number;
  pages: number;
  total: number;
  pageQuery: (page: number) => LocationQueryRaw;
}>();

const { t } = useI18n();
</script>

<style scoped>
.admin-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 20px;
}

.admin-pagination__summary {
  font-size: 14px;
  color: var(--bohr-color-text-muted);
}

.is-disabled {
  pointer-events: none;
  opacity: 0.4;
}
</style>
