<template>
  <div class="stack admin-overview">
    <ErrorState v-if="overview === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
    <div v-else-if="overview === null" aria-busy="true">
      <BohrSkeleton class="admin-overview__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <ul class="admin-overview__stats" role="list">
        <li data-stat="users">
          <SettingsCard>
            <p class="admin-overview__label">{{ t('admin.overview.users') }}</p>
            <p class="admin-overview__number">{{ formatNumber(overview.users) }}</p>
            <RouterLink :to="{ name: 'admin-users' }" class="text-link admin-overview__link">{{ t('admin.overview.seeUsers') }}</RouterLink>
          </SettingsCard>
        </li>
        <li data-stat="projects">
          <SettingsCard>
            <p class="admin-overview__label">{{ t('admin.overview.projects') }}</p>
            <p class="admin-overview__number">{{ formatNumber(overview.projects) }}</p>
            <RouterLink :to="{ name: 'admin-projects' }" class="text-link admin-overview__link">{{ t('admin.overview.seeProjects') }}</RouterLink>
          </SettingsCard>
        </li>
        <li data-stat="subscriptions">
          <SettingsCard>
            <p class="admin-overview__label">{{ t('admin.overview.subscriptions') }}</p>
            <p class="admin-overview__number">{{ formatNumber(overview.subscriptions.active) }}</p>
          </SettingsCard>
        </li>
      </ul>

      <SettingsCard data-card="runtimes">
        <h2 class="card-title">{{ t('admin.overview.runtimesTitle') }}</h2>
        <p class="card-text">{{ t('admin.overview.runtimesText') }}</p>
        <ul class="admin-overview__runtimes" role="list">
          <li v-for="status in RUNTIME_STATUSES" :key="status" :data-runtime="status">
            <span class="badge" :class="RUNTIME_BADGE[status]">{{ t(`admin.runtime.${status}`) }}</span>
            <strong>{{ formatNumber(overview.runtimes[status] ?? 0) }}</strong>
          </li>
        </ul>
        <div class="actions admin-overview__actions">
          <BohrButton :disabled="updating" @click="updateRuntimes">
            {{ updating ? t('common.working') : t('admin.overview.update') }}
          </BohrButton>
        </div>
        <p v-if="updated !== null" class="notice notice--success admin-overview__notice" role="status" data-notice="update">
          {{
            updated.updating.length > 0
              ? t('admin.overview.updating', { count: updated.updating.length, version: updated.version })
              : t('admin.overview.upToDate', { version: updated.version })
          }}
        </p>
      </SettingsCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, SettingsCard } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api, type ManageOverview, type RuntimeStatus } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import { useErrorText, useErrorToast } from '../../composables/useErrorText';
import { RUNTIME_BADGE } from '../../lib/status';

const RUNTIME_STATUSES: RuntimeStatus[] = ['ready', 'provisioning', 'pending', 'error'];

const { t, locale } = useI18n();
const errorText = useErrorText();
const showError = useErrorToast();

const overview = ref<ManageOverview | null>(null);
const loadError = ref<unknown>(null);
const updating = ref(false);
const updated = ref<{ version: string; updating: string[] } | null>(null);

const formatNumber = (value: number) => new Intl.NumberFormat(locale.value).format(value);

async function load() {
  loadError.value = null;
  try {
    overview.value = await api.manageOverview();
  } catch (caught) {
    loadError.value = caught;
  }
}

async function updateRuntimes() {
  updating.value = true;
  updated.value = null;
  try {
    updated.value = await api.updateRuntimes();
    await load();
  } catch (caught) {
    showError(caught);
  } finally {
    updating.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.admin-overview__skeleton {
  width: 100%;
  height: 320px;
}

.admin-overview__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
}

.admin-overview__label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.admin-overview__number {
  margin-top: 8px;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
}

.admin-overview__link {
  display: inline-block;
  margin-top: 12px;
  font-size: 14px;
}

.admin-overview__runtimes {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 28px;
  margin-top: 20px;
}

.admin-overview__runtimes li {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.admin-overview__actions,
.admin-overview__notice {
  margin-top: 20px;
}
</style>
