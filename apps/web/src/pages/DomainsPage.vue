<template>
  <div class="page page--narrow domains-page">
    <BohrPageTitle :title="t('dns.title')" />
    <p class="page-lead">{{ t('dns.lead') }}</p>

    <div class="stack domains-page__body">
      <ErrorState v-if="zones === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
      <div v-else-if="zones === null" aria-busy="true">
        <BohrSkeleton class="domains-page__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>
      <p v-else-if="zones.length === 0" class="notice" data-empty>{{ t('dns.none') }}</p>

      <div v-else class="admin-table-wrap">
        <table class="admin-table" data-table="zones">
          <thead>
            <tr>
              <th scope="col">{{ t('dns.domain') }}</th>
              <th scope="col">{{ t('dns.owner') }}</th>
              <th scope="col">{{ t('dns.access') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="zone in zones" :key="zone.name" :data-zone="zone.name">
              <td>
                <RouterLink :to="{ name: 'domain', params: { name: zone.name } }" class="admin-table__strong text-link">
                  {{ zone.name }}
                </RouterLink>
              </td>
              <td>{{ zone.org?.name ?? (zone.owner === undefined ? t('dns.personal') : (zone.owner ?? t('dns.unassigned'))) }}</td>
              <td>
                <span class="badge" :class="{ 'badge--cyan': zone.canEdit }" data-access>
                  {{ zone.canEdit ? t('dns.canEdit') : t('dns.readOnly') }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="field-hint">
        <a :href="guideUrl" target="_blank" rel="noopener noreferrer" class="text-link">{{ t('dns.guide') }}</a>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrPageTitle, BohrSkeleton } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api, type DnsZoneSummary } from '../api';
import ErrorState from '../components/ErrorState.vue';
import { useErrorText } from '../composables/useErrorText';
import { useDnsGuideUrl } from '../lib/dns';

// The domains whose DNS bohr hosts that the user can see: their own and their organizations'.
const { t } = useI18n();
const errorText = useErrorText();
const guideUrl = useDnsGuideUrl();

const zones = ref<DnsZoneSummary[] | null>(null);
const loadError = ref<unknown>(null);

async function load() {
  loadError.value = null;
  try {
    zones.value = (await api.dnsZones()).zones;
  } catch (caught) {
    loadError.value = caught;
  }
}

onMounted(load);
</script>

<style scoped>
.domains-page__body {
  margin-top: 36px;
}

.domains-page__skeleton {
  width: 100%;
  height: 200px;
}
</style>
