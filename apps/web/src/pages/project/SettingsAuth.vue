<template>
  <div class="settings-page">
    <div v-if="protection === null && loadError === null" aria-busy="true">
      <BohrSkeleton class="settings-page__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <ErrorState v-else-if="protection === null" :message="errorText(loadError)" @retry="load" />

    <SettingsCard v-else class="auth">
      <template #content>
        <h2 class="card-title">{{ t('protection.title') }}</h2>
        <p class="card-text">{{ t('protection.text') }}</p>

        <div v-if="protection.warning === 'custom_deploy'" class="notice notice--warn auth__notice" role="status">
          <strong class="notice__title">{{ t('protection.customDeployTitle') }}</strong>
          <p>{{ t('protection.customDeploy') }}</p>
        </div>

        <!-- Members see how the site is protected -->
        <template v-if="!canEdit">
          <dl class="facts auth__facts">
            <div>
              <dt>{{ t('protection.method') }}</dt>
              <dd>{{ t(`protection.methods.${protection.type}`) }}</dd>
            </div>
            <div v-if="protection.type === 'basic'">
              <dt>{{ t('protection.users') }}</dt>
              <dd>{{ protection.users.map((user) => user.username).join(', ') }}</dd>
            </div>
            <div v-if="protection.type === 'basic' && protection.bypassPaths.length > 0">
              <dt>{{ t('protection.bypass') }}</dt>
              <dd>{{ protection.bypassPaths.join(', ') }}</dd>
            </div>
          </dl>
          <p class="field-hint auth__note">{{ t('protection.ownerOnly') }}</p>
        </template>

        <form v-else :id="`${id}-form`" class="auth__form" novalidate @submit.prevent="save">
          <div class="form-field auth__method">
            <label :for="`${id}-method`" class="field-label">{{ t('protection.method') }}</label>
            <select :id="`${id}-method`" v-model="type" class="control" :disabled="saving">
              <option value="none">{{ t('protection.methods.none') }}</option>
              <option value="basic">{{ t('protection.methods.basic') }}</option>
            </select>
          </div>

          <template v-if="type === 'basic'">
            <h3 class="auth__subtitle">{{ t('protection.users') }}</h3>
            <div v-if="users.length > 0" class="auth__row auth__labels" aria-hidden="true">
              <span :id="`${id}-username`">{{ t('protection.username') }}</span>
              <span :id="`${id}-password`">{{ t('protection.password') }}</span>
              <span />
            </div>
            <fieldset v-for="(user, index) in users" :key="user.uid" class="auth__row" :disabled="saving">
              <legend class="bohr-visually-hidden">{{ t('protection.userLabel', { number: index + 1 }) }}</legend>
              <BohrTextField
                v-model="user.username"
                autocomplete="off"
                spellcheck="false"
                :placeholder="t('protection.username')"
                :aria-labelledby="`${id}-username`"
              />
              <BohrTextField
                v-model="user.password"
                type="password"
                autocomplete="new-password"
                :toggle-label="t('common.toggleVisibility')"
                :placeholder="kept.has(user.username.trim()) ? t('protection.passwordKept') : t('protection.password')"
                :aria-labelledby="`${id}-password`"
              />
              <button
                type="button"
                class="auth__remove"
                :aria-label="t('protection.removeUser', { name: user.username || index + 1 })"
                @click="users = users.filter((candidate) => candidate.uid !== user.uid)"
              >
                <XIcon :size="14" />
              </button>
            </fieldset>
            <button type="button" class="auth__add" :disabled="saving" @click="addUser">
              <PlusIcon :size="18" color="var(--bohr-color-green)" />
              {{ t('protection.addUser') }}
            </button>

            <h3 class="auth__subtitle">{{ t('protection.bypass') }}</h3>
            <p class="field-hint">{{ t('protection.bypassHint') }}</p>
            <fieldset v-for="(entry, index) in paths" :key="entry.uid" class="auth__row auth__row--path" :disabled="saving">
              <legend class="bohr-visually-hidden">{{ t('protection.pathLabel', { number: index + 1 }) }}</legend>
              <BohrTextField
                v-model="entry.path"
                autocomplete="off"
                spellcheck="false"
                placeholder="/api/public/*"
                :aria-label="t('protection.pathLabel', { number: index + 1 })"
              />
              <button
                type="button"
                class="auth__remove"
                :aria-label="t('protection.removePath', { path: entry.path || index + 1 })"
                @click="paths = paths.filter((candidate) => candidate.uid !== entry.uid)"
              >
                <XIcon :size="14" />
              </button>
            </fieldset>
            <button type="button" class="auth__add" :disabled="saving" @click="addPath">
              <PlusIcon :size="18" color="var(--bohr-color-green)" />
              {{ t('protection.addPath') }}
            </button>
          </template>

          <ul v-if="problems.length > 0" class="notice notice--error auth__problems" role="alert">
            <li v-for="message in problems" :key="message">{{ message }}</li>
          </ul>
          <div v-if="failure !== null" class="notice notice--error auth__notice" role="alert">
            <p>{{ failure.text }}</p>
            <p v-if="failure.detail" class="auth__detail">{{ failure.detail }}</p>
          </div>
          <p class="field-hint auth__note">{{ t('protection.note') }}</p>
        </form>
      </template>

      <template v-if="canEdit" #actions>
        <BohrButton type="submit" :form="`${id}-form`" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </BohrButton>
      </template>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, BohrTextField, PlusIcon, SettingsCard, useToast, XIcon } from '@bohr/ui';
import { onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api, type Protection, type ProtectionInput } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import { useErrorText } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';
import { BYPASS_PATH, SITE_USERNAME } from '../../lib/validation';

// Basic Auth in front of the site, like bohr v1's authentication settings (without OAuth).
const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const { id: projectId } = useProject();
const id = `auth-${useId()}`;

const protection = ref<Protection | null>(null);
const canEdit = ref(false);
const loadError = ref<unknown>(null);

let nextUid = 1;
const type = ref<Protection['type']>('none');
const users = ref<{ uid: number; username: string; password: string }[]>([]);
const paths = ref<{ uid: number; path: string }[]>([]);
/** Usernames whose password the instance keeps when none is typed. */
const kept = ref(new Set<string>());
const problems = ref<string[]>([]);
const failure = ref<{ text: string; detail: string | null } | null>(null);
const saving = ref(false);

function reset(value: Protection) {
  protection.value = value;
  type.value = value.type;
  users.value = value.users.map((user) => ({ uid: nextUid++, username: user.username, password: '' }));
  paths.value = value.bypassPaths.map((path) => ({ uid: nextUid++, path }));
  kept.value = new Set(value.users.map((user) => user.username));
  if (value.type === 'none' || users.value.length === 0) addUser();
}

function addUser() {
  users.value.push({ uid: nextUid++, username: '', password: '' });
}

function addPath() {
  paths.value.push({ uid: nextUid++, path: '' });
}

async function load() {
  loadError.value = null;
  try {
    const result = await api.protection(projectId);
    canEdit.value = result.canEdit;
    reset(result.protection);
  } catch (caught) {
    loadError.value = caught;
  }
}

/** The request to send, or the problems that keep it from being sent. */
function input(): ProtectionInput | string[] {
  if (type.value === 'none') return { type: 'none', users: [], bypassPaths: [] };
  const found: string[] = [];
  const entries = users.value
    .map((user) => ({ username: user.username.trim(), password: user.password }))
    .filter((user) => user.username !== '' || user.password !== '');
  const names = new Set<string>();
  for (const user of entries) {
    if (!SITE_USERNAME.test(user.username)) found.push(t('protection.errors.username', { name: user.username }));
    else if (names.has(user.username)) found.push(t('protection.errors.duplicate', { name: user.username }));
    else if (user.password === '' && !kept.value.has(user.username)) {
      found.push(t('protection.errors.password', { name: user.username }));
    }
    names.add(user.username);
  }
  if (entries.length === 0) found.push(t('protection.errors.noUsers'));
  const bypassPaths = paths.value.map((entry) => entry.path.trim()).filter((path) => path !== '');
  for (const path of bypassPaths) {
    if (!BYPASS_PATH.test(path)) found.push(t('protection.errors.path', { path }));
  }
  if (found.length > 0) return found;
  return {
    type: 'basic',
    users: entries.map((user) => (user.password === '' ? { username: user.username } : user)),
    bypassPaths,
  };
}

async function save() {
  failure.value = null;
  const body = input();
  if (Array.isArray(body)) {
    problems.value = body;
    return;
  }
  problems.value = [];
  saving.value = true;
  try {
    reset((await api.setProtection(projectId, body)).protection);
    toast.success(t('project.settingsSaved'));
  } catch (caught) {
    const detail =
      caught instanceof ApiError && (caught.status === 400 || caught.status === 409) ? caught.message : null;
    failure.value =
      detail === null ? { text: errorText(caught), detail: null } : { text: t('protection.failed'), detail };
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-page__skeleton {
  width: 100%;
  height: 280px;
}

.auth__notice,
.auth__facts,
.auth__problems {
  margin-top: 20px;
}

.auth__form {
  display: grid;
  gap: 12px;
  margin-top: 24px;
}

.auth__method {
  max-width: 320px;
  margin-bottom: 8px;
}

.auth__subtitle {
  margin-top: 16px;
  font-size: 16px;
}

.auth__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.auth__row--path {
  grid-template-columns: minmax(0, 1fr) 28px;
  max-width: 520px;
}

.auth__labels {
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-text-muted);
}

.auth__remove {
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

.auth__remove:hover,
.auth__remove:focus-visible {
  background-color: hsl(var(--bohr-hsl-red) / 0.15);
}

.auth__add {
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

.auth__add:hover,
.auth__add:focus-visible {
  color: var(--bohr-color-green);
}

.auth__problems {
  display: grid;
  gap: 4px;
  padding-left: 32px;
  list-style: disc;
}

.auth__detail {
  font-size: 13px;
  overflow-wrap: anywhere;
  opacity: 0.85;
}

.auth__note {
  margin-top: 8px;
}

</style>
