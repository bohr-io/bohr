<template>
  <ModalBase
    :open="open"
    :labelledby="titleId"
    with-close-button
    :close-label="t('common.close')"
    :close-on-backdrop="!busy"
    max-width="min(560px, calc(100vw - 32px))"
    @close="cancel"
  >
    <form class="record-dialog" novalidate data-record-dialog @submit.prevent="submit">
      <h2 :id="titleId" class="record-dialog__title">
        {{ record === null ? t('dns.dialog.addTitle') : t('dns.dialog.editTitle') }}
      </h2>

      <div class="record-dialog__row">
        <div class="record-dialog__field record-dialog__field--type">
          <label :for="`${titleId}-type`" class="record-dialog__label">{{ t('dns.dialog.type') }}</label>
          <select :id="`${titleId}-type`" v-model="type" class="record-dialog__input" name="type">
            <option v-for="option in DNS_RECORD_TYPES" :key="option" :value="option">{{ option }}</option>
          </select>
        </div>
        <div class="record-dialog__field">
          <label :for="`${titleId}-name`" class="record-dialog__label">{{ t('dns.dialog.name') }}</label>
          <input
            :id="`${titleId}-name`"
            v-model="name"
            class="record-dialog__input"
            name="name"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="@"
            :aria-describedby="`${titleId}-name-hint`"
          />
          <p :id="`${titleId}-name-hint`" class="record-dialog__hint">{{ t('dns.dialog.nameHint', { zone }) }}</p>
        </div>
      </div>

      <div class="record-dialog__field">
        <label :for="`${titleId}-content`" class="record-dialog__label">{{ t(`dns.dialog.content.${type}`) }}</label>
        <textarea
          v-if="type === 'TXT'"
          :id="`${titleId}-content`"
          v-model="content"
          class="record-dialog__input record-dialog__input--mono"
          name="content"
          rows="3"
          spellcheck="false"
          :aria-invalid="contentError !== null"
          :aria-describedby="`${titleId}-content-hint`"
        />
        <input
          v-else
          :id="`${titleId}-content`"
          v-model="content"
          class="record-dialog__input record-dialog__input--mono"
          name="content"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="contentError !== null"
          :aria-describedby="`${titleId}-content-hint`"
        />
        <p v-if="contentError !== null" class="record-dialog__error" role="alert">{{ contentError }}</p>
        <p v-else :id="`${titleId}-content-hint`" class="record-dialog__hint">{{ t(`dns.dialog.contentHint.${type}`) }}</p>
      </div>

      <div class="record-dialog__row">
        <div class="record-dialog__field">
          <label :for="`${titleId}-ttl`" class="record-dialog__label">{{ t('dns.dialog.ttl') }}</label>
          <select :id="`${titleId}-ttl`" v-model.number="ttl" class="record-dialog__input" name="ttl" :disabled="proxied">
            <option v-for="option in ttlOptions" :key="option" :value="option">{{ ttlLabel(option) }}</option>
          </select>
        </div>
        <div v-if="hasPriority" class="record-dialog__field">
          <label :for="`${titleId}-priority`" class="record-dialog__label">{{ t('dns.dialog.priority') }}</label>
          <input
            :id="`${titleId}-priority`"
            v-model="priority"
            class="record-dialog__input"
            name="priority"
            type="number"
            min="0"
            max="65535"
            :aria-invalid="priorityError !== null"
          />
          <p v-if="priorityError !== null" class="record-dialog__error" role="alert">{{ priorityError }}</p>
        </div>
      </div>

      <label v-if="proxiable" class="record-dialog__check">
        <input v-model="proxied" type="checkbox" name="proxied" />
        <span>
          <strong>{{ t('dns.dialog.proxied') }}</strong>
          <span class="record-dialog__hint">{{ t('dns.dialog.proxiedHint') }}</span>
        </span>
      </label>

      <p v-if="error" class="record-dialog__failure" role="alert" data-error>{{ error }}</p>

      <div class="record-dialog__actions">
        <BohrButton variant="text" color="black" :disabled="busy" @click="cancel">{{ t('common.cancel') }}</BohrButton>
        <BohrButton type="submit" :disabled="busy" data-action="save-record">
          {{ busy ? t('common.saving') : record === null ? t('dns.dialog.add') : t('common.save') }}
        </BohrButton>
      </div>
    </form>
  </ModalBase>
</template>

<script setup lang="ts">
import { BohrButton, ModalBase } from '@bohr/ui';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DNS_RECORD_TYPES, type DnsRecord, type DnsRecordInput, type DnsRecordType } from '../../api';
import { PRIORITY_TYPES, PROXIABLE_TYPES, shortName, TTL_OPTIONS, useTtlLabel } from '../../lib/dns';

// Adds a record to a domain whose DNS bohr hosts, or changes one. The instance checks it again (and Cloudflare);
// its refusal comes back as `error`.
const props = defineProps<{
  open: boolean;
  zone: string;
  /** null: a new record. */
  record: DnsRecord | null;
  busy?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{ save: [input: DnsRecordInput]; cancel: [] }>();

const { t } = useI18n();
const ttlLabel = useTtlLabel();
const titleId = `record-${useId()}`;

const type = ref<DnsRecordType>('A');
const name = ref('');
const content = ref('');
const ttl = ref<number>(1);
const proxied = ref(false);
const priority = ref<string | number>('');
const contentError = ref<string | null>(null);
const priorityError = ref<string | null>(null);

const proxiable = computed(() => PROXIABLE_TYPES.includes(type.value));
const hasPriority = computed(() => PRIORITY_TYPES.includes(type.value));
/** The record's own TTL stays available when it is not one of the usual ones. */
const ttlOptions = computed(() => [...new Set<number>([...TTL_OPTIONS, ttl.value])].sort((a, b) => a - b));

// Each time it opens: the record's values, or an empty A record
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const record = props.record;
    const known = record !== null && (DNS_RECORD_TYPES as readonly string[]).includes(record.type);
    type.value = known ? (record.type as DnsRecordType) : 'A';
    name.value = record === null ? '' : record.name === props.zone ? '@' : shortName(props.zone, record.name);
    content.value = record?.content ?? '';
    ttl.value = record?.ttl ?? 1;
    proxied.value = record?.proxied ?? false;
    priority.value = record?.priority ?? (record === null ? 10 : '');
    contentError.value = null;
    priorityError.value = null;
  },
  { immediate: true },
);

watch(proxied, (value) => {
  // Cloudflare answers proxied records itself: their TTL is automatic
  if (value) ttl.value = 1;
});

function submit() {
  contentError.value = content.value.trim() === '' ? t('dns.dialog.contentRequired') : null;
  const number = priority.value === '' ? Number.NaN : Number(priority.value);
  priorityError.value =
    hasPriority.value && !(Number.isInteger(number) && number >= 0 && number <= 65535)
      ? t('dns.dialog.priorityRequired')
      : null;
  if (contentError.value !== null || priorityError.value !== null) return;
  emit('save', {
    type: type.value,
    name: name.value.trim() || '@',
    content: content.value.trim(),
    ttl: proxiable.value && proxied.value ? 1 : ttl.value,
    proxied: proxiable.value && proxied.value,
    priority: hasPriority.value ? number : null,
  });
}

function cancel() {
  if (!props.busy) emit('cancel');
}
</script>

<style scoped>
.record-dialog {
  display: grid;
  gap: 16px;
  min-width: min(480px, calc(100vw - 80px));
  color: hsl(0 0% 10%);
}

.record-dialog__title {
  padding-right: 32px;
  font-size: 22px;
  line-height: 1.25;
}

.record-dialog__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.record-dialog__field {
  display: grid;
  gap: 6px;
  align-content: start;
}

.record-dialog__label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.record-dialog__input {
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid hsl(0 0% 0% / 0.25);
  border-radius: 6px;
  font: inherit;
  color: hsl(0 0% 10%);
  background: #fff;
}

.record-dialog__input--mono {
  font-family: var(--bohr-font-family-mono);
  font-size: 14px;
}

.record-dialog__input:focus-visible {
  outline: 2px solid hsl(var(--bohr-hsl-cyan));
  outline-offset: 1px;
}

.record-dialog__input[aria-invalid="true"] {
  border-color: hsl(355 78% 50%);
}

.record-dialog__input:disabled {
  opacity: 0.6;
}

textarea.record-dialog__input {
  resize: vertical;
}

.record-dialog__hint {
  display: block;
  font-size: 13px;
  line-height: 1.45;
  color: hsl(0 0% 35%);
}

.record-dialog__error,
.record-dialog__failure {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
  color: hsl(355 78% 45%);
}

.record-dialog__failure {
  padding: 10px 12px;
  border: 1px solid hsl(355 78% 50% / 0.35);
  border-radius: 8px;
  background: hsl(355 78% 50% / 0.06);
  overflow-wrap: anywhere;
}

.record-dialog__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.record-dialog__check input {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
}

.record-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
