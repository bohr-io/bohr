<template>
  <SettingsCard class="variables" :data-target="target">
    <template #content>
      <h2 class="card-title">{{ t(`variables.${target}.title`) }}</h2>
      <p class="card-text">{{ t(`variables.${target}.text`) }}</p>
      <p v-if="target === 'runtime'" class="card-text">
        {{ hostedByBohr ? t('variables.runtime.whenBohr') : t('variables.runtime.whenOwn') }}
      </p>

      <p v-if="rows.length === 0 && !canEdit" class="muted variables__empty">{{ t('variables.empty') }}</p>

      <!-- Members see the names and the plain values -->
      <dl v-else-if="!canEdit" class="facts variables__facts">
        <div v-for="row in rows" :key="row.uid">
          <dt class="variables__key">{{ row.key }}</dt>
          <dd>
            <span v-if="row.secret" class="badge">{{ t('variables.secretBadge') }}</span>
            <code v-else>{{ row.value }}</code>
          </dd>
        </div>
      </dl>

      <div v-else class="variables__list">
        <div v-if="rows.length > 0" class="variables__row variables__labels" aria-hidden="true">
          <span :id="`${id}-name`">{{ t('variables.name') }}</span>
          <span :id="`${id}-value`">{{ t('variables.value') }}</span>
          <span :id="`${id}-secret`" class="variables__secret-label">{{ t('variables.secret') }}</span>
          <span />
        </div>
        <p v-else class="muted variables__empty">{{ t('variables.empty') }}</p>

        <fieldset v-for="(row, index) in rows" :key="row.uid" class="variables__row" :disabled="saving">
          <legend class="bohr-visually-hidden">{{ t('variables.rowLabel', { number: index + 1 }) }}</legend>
          <BohrTextField
            v-model="row.key"
            placeholder="NOME_DA_VARIAVEL"
            autocomplete="off"
            spellcheck="false"
            :aria-labelledby="`${id}-name`"
            :has-error="errors[row.uid] !== undefined"
            :aria-describedby="errors[row.uid] !== undefined ? `${id}-error-${row.uid}` : undefined"
          />
          <BohrTextField
            v-model="row.value"
            :type="row.secret ? 'password' : 'text'"
            autocomplete="off"
            spellcheck="false"
            :toggle-label="t('common.toggleVisibility')"
            :placeholder="row.original?.secret ? t('variables.secretPlaceholder') : ''"
            :aria-labelledby="`${id}-value`"
          />
          <input
            v-model="row.secret"
            type="checkbox"
            class="variables__checkbox"
            :aria-labelledby="`${id}-secret`"
          />
          <button
            type="button"
            class="variables__remove"
            :aria-label="t('variables.remove', { name: row.key || t('variables.rowLabel', { number: index + 1 }) })"
            :title="t('variables.remove', { name: row.key })"
            @click="remove(row)"
          >
            <XIcon :size="14" />
          </button>
          <p v-if="errors[row.uid] !== undefined" :id="`${id}-error-${row.uid}`" class="field-error variables__error" role="alert">
            {{ errors[row.uid] }}
          </p>
        </fieldset>

        <button type="button" class="variables__add" :disabled="saving" @click="add">
          <PlusIcon :size="18" color="var(--bohr-color-green)" />
          {{ t('variables.add') }}
        </button>
      </div>

      <div v-if="failure !== null" class="notice notice--error variables__failure" role="alert">
        <p>{{ failure.text }}</p>
        <p v-if="failure.detail" class="variables__detail">{{ failure.detail }}</p>
      </div>
    </template>

    <template v-if="canEdit" #actions>
      <BohrButton :disabled="saving" @click="save">{{ saving ? t('common.saving') : t('common.save') }}</BohrButton>
    </template>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField, PlusIcon, SettingsCard, useToast, XIcon } from '@bohr/ui';
import { reactive, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api, type Variable, type VariableTarget } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { reservedVariable, VARIABLE_NAME } from '../../lib/validation';

// One kind of environment variables (the site's or the build's), edited like bohr v1's list: change the
// rows, then save; the card sends what changed, one variable at a time.
const props = defineProps<{
  projectId: string;
  target: VariableTarget;
  /** Every variable of the project, as the instance listed them. */
  variables: Variable[];
  canEdit: boolean;
  /** Projects bohr hosts apply plain site variables on the next deploy. */
  hostedByBohr: boolean;
}>();

interface Row {
  uid: number;
  key: string;
  value: string;
  secret: boolean;
  /** The saved variable this row shows; null for a new one. */
  original: Variable | null;
}

const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const id = `variables-${useId()}`;

let nextUid = 1;
const rows = ref<Row[]>([]);
/** Saved variables the user removed from the list. */
let removed: Variable[] = [];
const errors = reactive<Record<number, string>>({});
const saving = ref(false);
const failure = ref<{ text: string; detail: string | null } | null>(null);

function reset(variables: Variable[]) {
  rows.value = variables
    .filter((variable) => variable.target === props.target)
    .map((variable) => ({
      uid: nextUid++,
      key: variable.key,
      value: variable.value ?? '',
      secret: variable.secret,
      original: variable,
    }));
  removed = [];
  for (const uid of Object.keys(errors)) delete errors[Number(uid)];
}

watch(() => props.variables, reset, { immediate: true });

function add() {
  rows.value.push({ uid: nextUid++, key: '', value: '', secret: false, original: null });
}

function remove(row: Row) {
  rows.value = rows.value.filter((candidate) => candidate.uid !== row.uid);
  if (row.original !== null) removed.push(row.original);
  delete errors[row.uid];
}

function changed(row: Row): boolean {
  const original = row.original;
  if (original === null) return row.key.trim() !== '' || row.value !== '';
  if (row.key.trim() !== original.key || row.secret !== original.secret) return true;
  // A secret cannot be read back: an empty value keeps it.
  return original.secret ? row.value !== '' : row.value !== (original.value ?? '');
}

/** What is wrong with a row that is about to be saved, if anything. */
function problem(row: Row, keys: Map<string, number>): string | null {
  const key = row.key.trim();
  if (key === '') return t('variables.errors.keyRequired');
  if (!VARIABLE_NAME.test(key)) return t('variables.errors.keyInvalid');
  if (reservedVariable(key)) return t('variables.errors.reserved', { name: key });
  if ((keys.get(key) ?? 0) > 1) return t('variables.errors.duplicate', { name: key });
  const original = row.original;
  if (row.value === '' && row.secret && original === null) return t('variables.errors.valueRequired');
  if (row.value === '' && original?.secret && (key !== original.key || !row.secret)) {
    return t('variables.errors.secretValue');
  }
  return null;
}

async function save() {
  failure.value = null;
  for (const uid of Object.keys(errors)) delete errors[Number(uid)];
  // Blank new rows are ignored.
  rows.value = rows.value.filter((row) => row.original !== null || row.key.trim() !== '' || row.value !== '');
  const dirty = rows.value.filter(changed);
  if (dirty.length === 0 && removed.length === 0) {
    toast.tip(t('settings.unchanged'));
    return;
  }
  const keys = new Map<string, number>();
  for (const row of rows.value) keys.set(row.key.trim(), (keys.get(row.key.trim()) ?? 0) + 1);
  for (const row of rows.value) {
    const message = problem(row, keys);
    if (message !== null) errors[row.uid] = message;
  }
  if (Object.keys(errors).length > 0) return;

  saving.value = true;
  let latest: Variable[] | null = null;
  let current = '';
  try {
    for (const variable of [...removed]) {
      current = variable.key;
      latest = (await api.deleteVariable(props.projectId, props.target, variable.key)).variables;
      removed = removed.filter((candidate) => candidate !== variable);
    }
    for (const row of dirty) {
      const key = row.key.trim();
      current = key;
      latest = (
        await api.setVariable(props.projectId, { target: props.target, key, value: row.value, secret: row.secret })
      ).variables;
      const renamed = row.original !== null && row.original.key !== key;
      if (renamed && row.original !== null) {
        latest = (await api.deleteVariable(props.projectId, props.target, row.original.key)).variables;
      }
      // Saved: the row now shows the stored variable (a secret's value is gone).
      row.original = latest.find((variable) => variable.target === props.target && variable.key === key) ?? null;
      if (row.secret) row.value = '';
    }
    reset(latest ?? props.variables);
    toast.success(t('project.settingsSaved'));
  } catch (caught) {
    const detail =
      caught instanceof ApiError && (caught.status === 400 || caught.status === 409) ? caught.message : null;
    failure.value =
      detail === null
        ? { text: errorText(caught), detail: null }
        : { text: t('variables.failed', { name: current }), detail };
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.variables__empty,
.variables__facts {
  margin-top: 20px;
}

.variables__key {
  font-family: var(--bohr-font-family-mono);
  text-transform: none;
  overflow-wrap: anywhere;
}

.variables__list {
  display: grid;
  gap: 12px;
  margin-top: 24px;
}

.variables__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px 28px;
  align-items: center;
  gap: 8px 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.variables__labels {
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
}

.variables__secret-label {
  justify-self: center;
}

.variables__checkbox {
  justify-self: center;
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.variables__remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-red);
  background: none;
  transition: background-color var(--bohr-transition);
}

.variables__remove:hover,
.variables__remove:focus-visible {
  background-color: hsl(var(--bohr-hsl-red) / 0.15);
}

.variables__error {
  grid-column: 1 / -1;
  margin: 0;
}

.variables__add {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  justify-self: start;
  padding: 6px 0;
  border: 0;
  font: inherit;
  font-weight: 700;
  color: inherit;
  background: none;
}

.variables__add:hover,
.variables__add:focus-visible {
  color: var(--bohr-color-green);
}

.variables__failure {
  margin-top: 20px;
}

.variables__detail {
  font-size: 13px;
  overflow-wrap: anywhere;
  opacity: 0.85;
}

@media (max-width: 640px) {
  .variables__row {
    grid-template-columns: minmax(0, 1fr) 40px 28px;
  }

  .variables__row > .bohr-text-field:first-of-type {
    grid-column: 1 / -1;
  }

  .variables__labels {
    display: none;
  }
}
</style>
