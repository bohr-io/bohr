<template>
  <div class="page dns-zone">
    <RouterLink :to="{ name: 'domains' }" class="dns-zone__back">
      <ArrowIcon direction="left" :size="9" />
      <span>{{ t('dns.back') }}</span>
    </RouterLink>
    <BohrPageTitle :title="name" />

    <div class="stack dns-zone__body">
      <ErrorState v-if="detail === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
      <div v-else-if="detail === null" aria-busy="true">
        <BohrSkeleton class="dns-zone__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>

      <template v-else>
        <p class="page-lead dns-zone__lead">{{ t('dns.zone.lead', { name: detail.zone.name }) }}</p>
        <div v-if="!detail.zone.canEdit" class="notice" role="status" data-notice="read-only">
          {{ t('dns.zone.readOnly', { org: detail.zone.org?.name ?? '' }) }}
        </div>
        <div v-else-if="detail.zone.access === 'admin'" class="notice notice--warn" role="status" data-notice="admin">
          {{ t('dns.zone.adminNotice') }}
        </div>

        <div class="actions dns-zone__actions">
          <BohrButton v-if="detail.zone.canEdit" data-action="add-record" @click="openDialog(null)">
            <template #iconLeft><PlusIcon :size="12" /></template>
            {{ t('dns.zone.add') }}
          </BohrButton>
          <a :href="exportUrl" class="text-link" download data-action="export">{{ t('dns.zone.export') }}</a>
        </div>

        <p v-if="detail.records.length === 0" class="notice" data-empty>{{ t('dns.zone.empty') }}</p>
        <div v-else class="admin-table-wrap">
          <table class="admin-table dns-zone__table" data-table="records">
            <thead>
              <tr>
                <th scope="col">{{ t('dns.columns.type') }}</th>
                <th scope="col">{{ t('dns.columns.name') }}</th>
                <th scope="col">{{ t('dns.columns.content') }}</th>
                <th scope="col">{{ t('dns.columns.ttl') }}</th>
                <th scope="col">{{ t('dns.columns.proxy') }}</th>
                <th scope="col">{{ t('dns.columns.priority') }}</th>
                <th scope="col"><span class="bohr-visually-hidden">{{ t('dns.columns.actions') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in detail.records" :key="record.id" :data-record="record.id">
                <td><span class="admin-table__strong">{{ record.type }}</span></td>
                <td class="dns-zone__name" :title="record.name">{{ shortName(detail.zone.name, record.name) }}</td>
                <td class="dns-zone__content"><code>{{ record.content }}</code></td>
                <td class="admin-table__nowrap">{{ ttlLabel(record.ttl) }}</td>
                <td class="admin-table__nowrap">
                  <template v-if="PROXIABLE_TYPES.includes(record.type)">
                    <span class="badge" :class="{ 'badge--amber': record.proxied }">
                      {{ record.proxied ? t('dns.proxied') : t('dns.dnsOnly') }}
                    </span>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
                <td>{{ record.priority ?? '—' }}</td>
                <td>
                  <span
                    v-if="record.managedByBohr"
                    class="badge badge--cyan dns-zone__locked"
                    :title="t('dns.usedByBohrTitle')"
                    data-locked
                  >
                    <LockIcon :size="10" />
                    {{ t('dns.usedByBohr') }}
                  </span>
                  <div v-else-if="detail.zone.canEdit" class="dns-zone__row-actions">
                    <BohrButton
                      v-if="record.editable"
                      size="sm"
                      variant="ghost"
                      :aria-label="t('dns.editLabel', { type: record.type, name: record.name })"
                      data-action="edit"
                      @click="openDialog(record)"
                    >
                      {{ t('dns.edit') }}
                    </BohrButton>
                    <BohrButton
                      size="sm"
                      variant="ghost"
                      danger
                      :aria-label="t('dns.deleteLabel', { type: record.type, name: record.name })"
                      data-action="delete"
                      @click="deleting = record"
                    >
                      {{ t('dns.delete') }}
                    </BohrButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="field-hint">{{ t('dns.zone.lockedHint') }}</p>
        <p class="field-hint">
          <a :href="guideUrl" target="_blank" rel="noopener noreferrer" class="text-link">{{ t('dns.guide') }}</a>
        </p>
      </template>
    </div>

    <DnsRecordDialog
      :open="dialogOpen"
      :zone="name"
      :record="editing"
      :busy="saving"
      :error="saveError"
      @save="save"
      @cancel="dialogOpen = false"
    />

    <ConfirmDialog
      :open="deleting !== null"
      :title="t('dns.deleteTitle', { type: deleting?.type ?? '' })"
      :confirm-label="t('dns.delete')"
      danger
      :busy="deleteBusy"
      @confirm="remove"
      @cancel="deleting = null"
    >
      <p>{{ t('dns.deleteText', { name: deleting?.name ?? '', content: deleting?.content ?? '' }) }}</p>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrButton, BohrPageTitle, BohrSkeleton, PlusIcon, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { api, type DnsRecord, type DnsRecordInput, type DnsZoneDetail, dnsExportUrl } from '../api';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DnsRecordDialog from '../components/dns/DnsRecordDialog.vue';
import ErrorState from '../components/ErrorState.vue';
import { LockIcon } from '../components/icons';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { usePageTitle } from '../composables/usePageTitle';
import { PROXIABLE_TYPES, shortName, useDnsGuideUrl, useTtlLabel } from '../lib/dns';

// A domain whose DNS bohr hosts: its records in Cloudflare. The owner (or an admin of its organization) adds,
// changes and deletes them; the ones bohr needs to serve sites are locked.
const props = defineProps<{ name: string }>();

const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();
const ttlLabel = useTtlLabel();
const guideUrl = useDnsGuideUrl();

const detail = ref<DnsZoneDetail | null>(null);
const loadError = ref<unknown>(null);
const dialogOpen = ref(false);
const editing = ref<DnsRecord | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const deleting = ref<DnsRecord | null>(null);
const deleteBusy = ref(false);
const exportUrl = computed(() => dnsExportUrl(props.name));

usePageTitle(() => props.name);

async function load() {
  loadError.value = null;
  try {
    detail.value = await api.dnsZone(props.name);
  } catch (caught) {
    loadError.value = caught;
  }
}

function openDialog(record: DnsRecord | null) {
  editing.value = record;
  saveError.value = null;
  dialogOpen.value = true;
}

async function save(input: DnsRecordInput) {
  if (saving.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const record = editing.value;
    detail.value =
      record === null
        ? await api.createDnsRecord(props.name, input)
        : await api.updateDnsRecord(props.name, record.id, input);
    toast.success(record === null ? t('dns.created') : t('dns.saved'));
    dialogOpen.value = false;
  } catch (error) {
    // Kept in the dialog, next to the values to fix
    saveError.value = errorText(error);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const record = deleting.value;
  if (record === null || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    detail.value = await api.deleteDnsRecord(props.name, record.id);
    toast.success(t('dns.deleted'));
    deleting.value = null;
  } catch (error) {
    showError(error);
  } finally {
    deleteBusy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dns-zone__back {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 24px;
  padding: 6px 17px 6px 10px;
  border-radius: var(--bohr-radius-full);
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
  text-transform: uppercase;
  color: #fff;
  background-color: hsl(0 0% 0% / 0.25);
  transition: background-color var(--bohr-transition);
}

.dns-zone__back:hover,
.dns-zone__back:focus-visible {
  background-color: hsl(0 0% 0% / 1);
}

.dns-zone__body {
  margin-top: 24px;
}

.dns-zone__lead {
  margin-top: 0;
}

.dns-zone__skeleton {
  width: 100%;
  height: 360px;
}

.dns-zone__name {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.dns-zone__content code {
  display: block;
  max-width: 420px;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.dns-zone__locked {
  gap: 6px;
  white-space: nowrap;
}

/* Side by side: one line per record */
.dns-zone__row-actions {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 6px;
  white-space: nowrap;
}
</style>
