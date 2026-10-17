<template>
  <div class="page page--narrow account-tokens">
    <RouterLink :to="{ name: 'account' }" class="account-tokens__back">
      <ArrowIcon direction="left" :size="9" />
      <span>{{ t('tokens.back') }}</span>
    </RouterLink>
    <BohrPageTitle :title="t('tokens.title')" />
    <p class="page-lead">{{ t('tokens.lead') }}</p>

    <div class="stack account-tokens__cards">
      <ErrorState v-if="data === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
      <div v-else-if="data === null" aria-busy="true">
        <BohrSkeleton class="account-tokens__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>

      <template v-else>
        <div v-if="created !== null" class="notice notice--success" role="status" data-created>
          <strong class="notice__title">{{ t('tokens.createdTitle', { name: created.name }) }}</strong>
          <p>{{ t('tokens.createdText') }}</p>
          <div class="account-tokens__secret">
            <code class="inline-code" data-token>{{ created.token }}</code>
            <CopyButton :value="created.token" />
          </div>
          <p class="account-tokens__usage">{{ t('tokens.usage') }}</p>
          <pre class="account-tokens__example"><code>BOHR_TOKEN={{ created.token.slice(0, 9) }}… npx bohr deploy --json</code></pre>
        </div>

        <SettingsCard data-card="new-token">
          <h2 class="card-title">{{ t('tokens.newTitle') }}</h2>
          <p class="card-text">{{ t('tokens.newText') }}</p>
          <form class="form account-tokens__form" novalidate @submit.prevent="create">
            <div class="form-field">
              <BohrTextField
                v-model="name"
                :label="t('tokens.name')"
                maxlength="100"
                autocomplete="off"
                required
                :has-error="nameError !== null"
                :aria-describedby="nameError !== null ? 'token-name-error' : 'token-name-hint'"
              />
              <p v-if="nameError !== null" id="token-name-error" class="field-error" role="alert">{{ nameError }}</p>
              <p v-else id="token-name-hint" class="field-hint">{{ t('tokens.nameHint') }}</p>
            </div>

            <fieldset class="account-tokens__scope">
              <legend class="field-label">{{ t('tokens.scope') }}</legend>
              <label class="account-tokens__option">
                <input v-model="scope" type="radio" name="scope" value="all" />
                <span>{{ t('tokens.scopeAll') }}</span>
              </label>
              <label class="account-tokens__option">
                <input v-model="scope" type="radio" name="scope" value="selected" :disabled="data.projects.length === 0" />
                <span>{{ t('tokens.scopeSelected') }}</span>
              </label>
              <ul v-if="scope === 'selected'" class="account-tokens__projects" role="list" data-projects>
                <li v-for="project in data.projects" :key="project.id">
                  <label class="account-tokens__option">
                    <input v-model="selected" type="checkbox" :value="project.id" />
                    <span>{{ project.name }} <span class="account-tokens__muted">{{ project.repository }}</span></span>
                  </label>
                </li>
              </ul>
              <p v-if="scopeError !== null" class="field-error" role="alert">{{ scopeError }}</p>
            </fieldset>

            <div class="form-field">
              <label for="token-expiry" class="field-label">{{ t('tokens.expiry') }}</label>
              <select id="token-expiry" v-model="expiry" class="control">
                <option v-for="days in EXPIRY_DAYS" :key="days" :value="String(days)">
                  {{ t('tokens.days', { count: days }) }}
                </option>
                <option value="never">{{ t('tokens.never') }}</option>
              </select>
            </div>

            <div class="actions">
              <BohrButton type="submit" :disabled="creating">
                {{ creating ? t('common.working') : t('tokens.create') }}
              </BohrButton>
            </div>
          </form>
        </SettingsCard>

        <SettingsCard data-card="tokens">
          <h2 class="card-title">{{ t('tokens.listTitle') }}</h2>
          <p v-if="data.tokens.length === 0" class="card-text">{{ t('tokens.none') }}</p>
          <ul v-else class="account-tokens__list" role="list">
            <li v-for="token in data.tokens" :key="token.id" class="account-tokens__item" :data-token-id="token.id">
              <div class="account-tokens__text">
                <p class="account-tokens__name">
                  {{ token.name }}
                  <span v-if="token.source === 'cli'" class="badge badge--cyan">{{ t('tokens.cli') }}</span>
                  <span v-if="token.expired" class="badge badge--red">{{ t('tokens.expired') }}</span>
                </p>
                <p class="account-tokens__muted">
                  <code class="inline-code">{{ token.hint }}</code> · {{ scopeText(token) }}
                </p>
                <p class="account-tokens__muted">
                  {{ t('tokens.createdAt', { date: formatDate(token.createdAt, locale) }) }} ·
                  {{
                    token.lastUsedAt === null
                      ? t('tokens.neverUsed')
                      : t('tokens.lastUsed', { when: formatRelative(token.lastUsedAt, locale) })
                  }}
                  ·
                  {{
                    token.expiresAt === null
                      ? t('tokens.noExpiry')
                      : t('tokens.expiresAt', { date: formatDate(token.expiresAt, locale) })
                  }}
                </p>
              </div>
              <BohrButton size="sm" variant="ghost" danger @click="revoking = token">{{ t('tokens.revoke') }}</BohrButton>
            </li>
          </ul>
        </SettingsCard>
      </template>
    </div>

    <ConfirmDialog
      :open="revoking !== null"
      :title="t('tokens.revokeTitle', { name: revoking?.name ?? '' })"
      :confirm-label="t('tokens.revoke')"
      danger
      :busy="revokeBusy"
      @confirm="revoke"
      @cancel="revoking = null"
    >
      <p class="account-tokens__confirm">{{ t('tokens.revokeText') }}</p>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrButton, BohrPageTitle, BohrSkeleton, BohrTextField, SettingsCard, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { type ApiToken, api, type Tokens } from '../api';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import CopyButton from '../components/CopyButton.vue';
import ErrorState from '../components/ErrorState.vue';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { formatDate, formatRelative } from '../lib/format';

// API tokens: scripts and AI agents use bohr as the user (BOHR_TOKEN); `bohr login` makes them too.
const EXPIRY_DAYS = [30, 90, 365];

const { t, locale } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();

const data = ref<Tokens | null>(null);
const loadError = ref<unknown>(null);
const name = ref('');
const scope = ref<'all' | 'selected'>('all');
const selected = ref<string[]>([]);
const expiry = ref('90');
const creating = ref(false);
const nameError = ref<string | null>(null);
const scopeError = ref<string | null>(null);
/** The token just created: shown once. */
const created = ref<{ name: string; token: string } | null>(null);
const revoking = ref<ApiToken | null>(null);
const revokeBusy = ref(false);

const projectNames = computed(() => new Map((data.value?.projects ?? []).map((project) => [project.id, project.name])));

function scopeText(token: ApiToken) {
  if (token.projects === null) return t('tokens.allProjects');
  const names = token.projects.map((project) => project.name ?? projectNames.value.get(project.id) ?? project.id);
  return t('tokens.someProjects', { projects: names.join(', ') });
}

async function load() {
  loadError.value = null;
  try {
    data.value = await api.tokens();
  } catch (caught) {
    loadError.value = caught;
  }
}

async function create() {
  nameError.value = name.value.trim() === '' ? t('tokens.nameRequired') : null;
  scopeError.value = scope.value === 'selected' && selected.value.length === 0 ? t('tokens.scopeRequired') : null;
  if (nameError.value !== null || scopeError.value !== null) return;
  creating.value = true;
  try {
    const answer = await api.createToken({
      name: name.value.trim(),
      projectIds: scope.value === 'all' ? null : selected.value,
      expiresInDays: expiry.value === 'never' ? null : Number(expiry.value),
    });
    created.value = { name: name.value.trim(), token: answer.token };
    data.value = { tokens: answer.tokens, projects: answer.projects };
    name.value = '';
    selected.value = [];
    scope.value = 'all';
  } catch (error) {
    showError(error);
  } finally {
    creating.value = false;
  }
}

async function revoke() {
  const token = revoking.value;
  if (token === null || revokeBusy.value) return;
  revokeBusy.value = true;
  try {
    data.value = await api.revokeToken(token.id);
    toast.success(t('tokens.revoked', { name: token.name }));
    revoking.value = null;
  } catch (error) {
    showError(error);
  } finally {
    revokeBusy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.account-tokens__back {
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

.account-tokens__back:hover,
.account-tokens__back:focus-visible {
  background-color: hsl(0 0% 0% / 1);
}

.account-tokens__cards {
  margin-top: 36px;
}

.account-tokens__skeleton {
  width: 100%;
  height: 360px;
}

.account-tokens__form {
  margin-top: 16px;
}

.account-tokens__scope {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.account-tokens__option {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account-tokens__projects {
  display: grid;
  gap: 6px;
  margin-left: 26px;
}

.account-tokens__secret {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.account-tokens__secret .inline-code {
  overflow-wrap: anywhere;
}

.account-tokens__example {
  overflow-x: auto;
  font-size: 13px;
}

.account-tokens__list {
  display: grid;
  gap: 2px;
  margin-top: 16px;
}

.account-tokens__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
}

.account-tokens__item + .account-tokens__item {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.account-tokens__text {
  flex: 1;
  min-width: 200px;
}

.account-tokens__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.account-tokens__muted {
  font-size: 14px;
  color: var(--bohr-color-text-muted);
  overflow-wrap: anywhere;
}
</style>
