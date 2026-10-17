<template>
  <div class="stack admin-list">
    <AdminSearch
      :value="list.query.value"
      :label="t('admin.projects.search')"
      :placeholder="t('admin.projects.placeholder')"
      @search="list.search"
    />

    <ErrorState v-if="list.error.value !== null" :message="errorText(list.error.value)" @retry="list.load" />
    <div v-else-if="list.items.value === null" aria-busy="true">
      <BohrSkeleton class="admin-list__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <p v-else-if="list.items.value.length === 0" class="notice" data-empty>{{ t('admin.projects.none') }}</p>

    <template v-else>
      <AdminProjectsTable :projects="list.items.value" :aria-busy="list.loading.value || undefined" />
      <AdminPagination
        :page="list.page.value"
        :pages="list.pages.value"
        :total="list.total.value"
        :page-query="list.pageQuery"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrSkeleton } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { api, type ProjectRow } from '../../api';
import AdminPagination from '../../components/admin/AdminPagination.vue';
import AdminProjectsTable from '../../components/admin/AdminProjectsTable.vue';
import AdminSearch from '../../components/admin/AdminSearch.vue';
import ErrorState from '../../components/ErrorState.vue';
import { useAdminList } from '../../composables/useAdminList';
import { useErrorText } from '../../composables/useErrorText';

const { t } = useI18n();
const errorText = useErrorText();

const list = useAdminList<ProjectRow>(async (query) => {
  const { projects, total } = await api.manageProjects(query);
  return { items: projects, total };
});
</script>

<style scoped>
.admin-list__skeleton {
  width: 100%;
  height: 360px;
}
</style>
