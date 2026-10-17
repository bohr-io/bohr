<template>
  <div class="stack admin-list">
    <AdminSearch
      :value="list.query.value"
      :label="t('admin.orgs.search')"
      :placeholder="t('admin.orgs.placeholder')"
      @search="list.search"
    />

    <ErrorState v-if="list.error.value !== null" :message="errorText(list.error.value)" @retry="list.load" />
    <div v-else-if="list.items.value === null" aria-busy="true">
      <BohrSkeleton class="admin-list__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <p v-else-if="list.items.value.length === 0" class="notice" data-empty>{{ t('admin.orgs.none') }}</p>

    <template v-else>
      <div class="admin-table-wrap" :aria-busy="list.loading.value || undefined">
        <table class="admin-table" data-table="orgs">
          <thead>
            <tr>
              <th scope="col">{{ t('admin.orgs.org') }}</th>
              <th scope="col">{{ t('admin.orgs.members') }}</th>
              <th scope="col">{{ t('admin.orgs.projects') }}</th>
              <th scope="col">{{ t('admin.orgs.subscription') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="org in list.items.value" :key="org.id" :data-org="org.slug">
              <td>
                <span class="admin-table__strong">{{ org.name }}</span>
                <a
                  :href="`https://github.com/${encodeURIComponent(org.slug)}`"
                  class="admin-table__muted text-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ `github.com/${org.slug}` }}</a>
              </td>
              <td>{{ org.members }}</td>
              <td>{{ org.projects }}</td>
              <td>
                <span v-if="org.subscription" class="badge" :class="isActiveSubscription(org.subscription) ? 'badge--green' : 'badge--amber'">
                  {{ subscriptionLabel(org.subscription) }}
                </span>
                <span v-else class="admin-table__muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
import { api, type ManagedOrg } from '../../api';
import AdminPagination from '../../components/admin/AdminPagination.vue';
import AdminSearch from '../../components/admin/AdminSearch.vue';
import ErrorState from '../../components/ErrorState.vue';
import { useAdminList } from '../../composables/useAdminList';
import { useErrorText } from '../../composables/useErrorText';
import { isActiveSubscription, isKnownStatus } from '../../lib/billing';

// The instance's organizations (admins): members, projects and the subscription of each.
const { t } = useI18n();
const errorText = useErrorText();

const subscriptionLabel = (status: string) => (isKnownStatus(status) ? t(`billing.statuses.${status}`) : status);

const list = useAdminList<ManagedOrg>(async (query) => {
  const { orgs, total } = await api.manageOrgs(query);
  return { items: orgs, total };
});
</script>

<style scoped>
.admin-list__skeleton {
  width: 100%;
  height: 360px;
}
</style>
