<template>
  <div class="settings-page">
    <div v-if="domains === null && loadError === null" aria-busy="true">
      <BohrSkeleton class="settings-page__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <ErrorState v-else-if="domains === null" :message="errorText(loadError)" @retry="load" />

    <SettingsCard v-else class="domains" :data-hosting="domains.hosting">
      <h2 class="card-title">{{ t('domains.title') }}</h2>

      <!-- Hosted by bohr: the domains stay as they were until the project moves -->
      <template v-if="domains.hosting === 'bohr'">
        <p class="card-text">{{ t('domains.bohr') }}</p>
        <p v-if="canMove" class="card-text">
          <RouterLink :to="{ name: 'project-settings-hosting', params: { id: projectId } }" class="text-link">
            {{ t('domains.moveLink') }}
          </RouterLink>
        </p>
        <ul v-if="domains.domains.length > 0" class="domains__list" role="list">
          <li v-for="domain in domains.domains" :key="domain.id" class="domains__item">
            <a :href="`https://${domain.hostname}`" target="_blank" rel="noopener noreferrer" class="domains__host">
              {{ domain.hostname }}
            </a>
            <span class="badge" :class="domain.status === 'live' ? 'badge--green' : 'badge--amber'">
              {{ t(`domains.status.${domain.status}`) }}
            </span>
          </li>
        </ul>
        <p v-else class="muted domains__empty">{{ t('domains.none') }}</p>
      </template>

      <!-- The owner's Cloudflare account -->
      <template v-else>
        <p class="card-text">{{ t('domains.text') }}</p>

        <div v-if="!domains.deployed" class="notice notice--warn domains__notice" role="status">
          <strong class="notice__title">{{ t('domains.notDeployedTitle') }}</strong>
          <p>{{ t('domains.notDeployed') }}</p>
        </div>

        <template v-else>
          <dl class="facts domains__facts">
            <div v-if="domains.workersDev">
              <dt>{{ t('domains.workersDev') }}</dt>
              <dd>
                <a :href="domains.workersDev" target="_blank" rel="noopener noreferrer" class="text-link">{{ domains.workersDev }}</a>
              </dd>
            </div>
            <div v-if="domains.worker">
              <dt>{{ t('domains.worker') }}</dt>
              <dd><code>{{ domains.worker }}</code></dd>
            </div>
          </dl>

          <h3 class="domains__subtitle">{{ t('domains.attached') }}</h3>
          <ul v-if="domains.domains.length > 0" class="domains__list" role="list">
            <li v-for="domain in domains.domains" :key="domain.id" class="domains__item">
              <a :href="`https://${domain.hostname}`" target="_blank" rel="noopener noreferrer" class="domains__host">
                {{ domain.hostname }}
              </a>
              <button
                v-if="domains.canEdit"
                type="button"
                class="domains__remove"
                :aria-label="t('domains.remove', { domain: domain.hostname })"
                :title="t('domains.remove', { domain: domain.hostname })"
                @click="removing = domain"
              >
                <XIcon :size="14" />
              </button>
            </li>
          </ul>
          <p v-else class="muted domains__empty">{{ t('domains.none') }}</p>

          <form v-if="domains.canEdit" class="domains__form" novalidate @submit.prevent="add">
            <h3 class="domains__subtitle">{{ t('domains.add') }}</h3>
            <div v-if="domains.zones.length > 0" class="domains__fields">
              <div class="form-field">
                <BohrTextField
                  v-model="subdomain"
                  :label="t('domains.subdomain')"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="www"
                  :aria-describedby="`${id}-preview`"
                />
              </div>
              <div class="form-field">
                <label :for="`${id}-zone`" class="field-label">{{ t('domains.zone') }}</label>
                <select :id="`${id}-zone`" v-model="zone" class="control">
                  <option v-for="entry in domains.zones" :key="entry.name" :value="entry.name">
                    {{ entry.status === 'active' ? entry.name : `${entry.name} (${entry.status})` }}
                  </option>
                </select>
              </div>
            </div>
            <div v-else class="form-field">
              <p class="field-hint">{{ t('domains.noZones') }}</p>
              <BohrTextField v-model="typed" :label="t('domains.hostname')" autocomplete="off" spellcheck="false" placeholder="www.exemplo.com.br" />
            </div>
            <p v-if="hostname" :id="`${id}-preview`" class="field-hint">{{ t('domains.preview', { domain: hostname }) }}</p>
            <p v-if="invalid" class="field-error" role="alert">{{ t('domains.invalid', { domain: hostname }) }}</p>
            <div class="actions">
              <BohrButton type="submit" :disabled="adding || hostname === ''">
                {{ adding ? t('common.working') : t('domains.addButton') }}
              </BohrButton>
            </div>
          </form>
          <p class="field-hint domains__note">{{ t('domains.note') }}</p>
        </template>
      </template>

      <div v-if="failure !== null" class="notice notice--error domains__notice" role="alert">
        <p>{{ failure.text }}</p>
        <p v-if="failure.detail" class="domains__detail">{{ failure.detail }}</p>
      </div>
    </SettingsCard>

    <ConfirmDialog
      :open="removing !== null"
      :title="t('domains.removeTitle')"
      :confirm-label="t('domains.removeConfirm')"
      danger
      :busy="busyRemoving"
      @confirm="remove"
      @cancel="removing = null"
    >
      <p>{{ t('domains.removeText', { domain: removing?.hostname ?? '' }) }}</p>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, BohrTextField, SettingsCard, useToast, XIcon } from '@bohr/ui';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError, api, type Domains } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ErrorState from '../../components/ErrorState.vue';
import { useErrorText } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';
import { HOSTNAME } from '../../lib/validation';

// The site's custom domains. In the owner's Cloudflare account a domain goes under one of its zones and
// Cloudflare creates the DNS record and the certificate; projects bohr hosts keep theirs until they move.
const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const { id: projectId, canMove } = useProject();
const id = `domains-${useId()}`;

const domains = ref<Domains | null>(null);
const loadError = ref<unknown>(null);
const subdomain = ref('');
const zone = ref('');
const typed = ref('');
const adding = ref(false);
const invalid = ref(false);
const failure = ref<{ text: string; detail: string | null } | null>(null);
const removing = ref<{ id: string; hostname: string } | null>(null);
const busyRemoving = ref(false);

const hostname = computed(() => {
  const view = domains.value;
  if (view?.hosting !== 'own') return '';
  if (view.zones.length === 0) return typed.value.trim().toLowerCase();
  const sub = subdomain.value.trim().toLowerCase().replace(/\.+$/, '');
  return zone.value === '' ? '' : sub === '' ? zone.value : `${sub}.${zone.value}`;
});

function show(view: Domains) {
  domains.value = view;
  if (view.hosting === 'own' && !view.zones.some((entry) => entry.name === zone.value)) {
    zone.value = view.zones[0]?.name ?? '';
  }
}

async function load() {
  loadError.value = null;
  try {
    show(await api.domains(projectId));
  } catch (caught) {
    loadError.value = caught;
  }
}

function fail(caught: unknown) {
  const detail = caught instanceof ApiError && (caught.status === 400 || caught.status === 409) ? caught.message : null;
  failure.value = detail === null ? { text: errorText(caught), detail: null } : { text: t('domains.failed'), detail };
}

async function add() {
  failure.value = null;
  invalid.value = !HOSTNAME.test(hostname.value);
  if (invalid.value) return;
  adding.value = true;
  try {
    show(await api.addDomain(projectId, hostname.value));
    toast.success(t('domains.added', { domain: hostname.value }));
    subdomain.value = '';
    typed.value = '';
  } catch (caught) {
    fail(caught);
  } finally {
    adding.value = false;
  }
}

async function remove() {
  const domain = removing.value;
  if (domain === null) return;
  failure.value = null;
  busyRemoving.value = true;
  try {
    show(await api.removeDomain(projectId, domain.id));
    toast.success(t('domains.removed', { domain: domain.hostname }));
  } catch (caught) {
    fail(caught);
  } finally {
    busyRemoving.value = false;
    removing.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-page__skeleton {
  width: 100%;
  height: 280px;
}

.domains__notice,
.domains__facts,
.domains__empty {
  margin-top: 20px;
}

.domains__subtitle {
  margin-top: 28px;
  margin-bottom: 12px;
  font-size: 16px;
}

.domains__list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.domains__subtitle + .domains__list {
  margin-top: 0;
}

.domains__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 10px 12px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
}

.domains__host {
  font-family: var(--bohr-font-family-mono);
  font-size: 14px;
  color: var(--bohr-color-cyan);
  overflow-wrap: anywhere;
}

.domains__remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-red);
  background: none;
}

.domains__remove:hover,
.domains__remove:focus-visible {
  background-color: hsl(var(--bohr-hsl-red) / 0.15);
}

.domains__form {
  display: grid;
  gap: 8px;
}

.domains__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  gap: 16px;
}

.domains__note {
  margin-top: 20px;
}

.domains__detail {
  font-size: 13px;
  overflow-wrap: anywhere;
  opacity: 0.85;
}
</style>
