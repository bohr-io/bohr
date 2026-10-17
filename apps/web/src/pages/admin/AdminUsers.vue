<template>
  <div class="stack admin-list">
    <AdminSearch
      :value="list.query.value"
      :label="t('admin.users.search')"
      :placeholder="t('admin.users.placeholder')"
      @search="list.search"
    />

    <ErrorState v-if="list.error.value !== null" :message="errorText(list.error.value)" @retry="list.load" />
    <div v-else-if="list.items.value === null" aria-busy="true">
      <BohrSkeleton class="admin-list__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <p v-else-if="list.items.value.length === 0" class="notice" data-empty>{{ t('admin.users.none') }}</p>

    <template v-else>
      <div class="admin-table-wrap" :aria-busy="list.loading.value || undefined">
        <table class="admin-table" data-table="users">
          <thead>
            <tr>
              <th scope="col">{{ t('admin.users.user') }}</th>
              <th scope="col">{{ t('admin.users.signIn') }}</th>
              <th scope="col">{{ t('admin.users.projects') }}</th>
              <th scope="col">{{ t('admin.users.subscription') }}</th>
              <th scope="col">{{ t('admin.users.created') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in list.items.value" :key="user.id" :data-user="user.id">
              <td>
                <RouterLink :to="{ name: 'admin-user', params: { userId: user.id } }" class="admin-table__strong text-link">
                  {{ user.name ?? user.email ?? user.id }}
                </RouterLink>
                <span v-if="user.role === 'admin'" class="badge badge--cyan admin-list__role">{{ t('admin.role.admin') }}</span>
                <span v-if="user.email && user.name" class="admin-table__muted">{{ user.email }}</span>
                <span v-if="user.orgs?.length" class="admin-list__orgs">
                  <span v-for="org in user.orgs" :key="org.slug" class="badge badge--cyan" data-org-badge>{{ org.name }}</span>
                </span>
              </td>
              <td>
                <span v-for="entry in user.identities" :key="entry.provider" class="admin-table__muted">
                  {{ t(`connections.${entry.provider}`) }}<template v-if="entry.username">: {{ entry.username }}</template>
                </span>
                <span v-if="user.identities.length === 0" class="admin-table__muted">—</span>
              </td>
              <td>{{ user.projects }}</td>
              <td>
                <span v-if="user.subscription" class="badge" :class="isActiveSubscription(user.subscription) ? 'badge--green' : 'badge--amber'">
                  {{ subscriptionLabel(user.subscription) }}
                </span>
                <span v-else class="admin-table__muted">—</span>
              </td>
              <td class="admin-table__nowrap">{{ formatDate(user.createdAt, locale) }}</td>
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
import { RouterLink } from 'vue-router';
import { api, type ManagedUser } from '../../api';
import AdminPagination from '../../components/admin/AdminPagination.vue';
import AdminSearch from '../../components/admin/AdminSearch.vue';
import ErrorState from '../../components/ErrorState.vue';
import { useAdminList } from '../../composables/useAdminList';
import { useErrorText } from '../../composables/useErrorText';
import { isActiveSubscription, isKnownStatus } from '../../lib/billing';
import { formatDate } from '../../lib/format';

const { t, locale } = useI18n();
const errorText = useErrorText();

const subscriptionLabel = (status: string) => (isKnownStatus(status) ? t(`billing.statuses.${status}`) : status);

const list = useAdminList<ManagedUser>(async (query) => {
  const { users, total } = await api.manageUsers(query);
  return { items: users, total };
});
</script>

<style scoped>
.admin-list__skeleton {
  width: 100%;
  height: 360px;
}

.admin-list__role {
  margin-left: 8px;
}

.admin-list__orgs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
