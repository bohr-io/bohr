<template>
  <div v-if="view?.status !== 'unavailable'" class="move">
    <SettingsCard class="move__card" :data-move="view?.status ?? 'loading'">
      <h2 class="card-title">{{ view?.status === 'done' ? t('move.doneTitle') : t('move.title') }}</h2>

      <ErrorState v-if="view === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
      <div v-else-if="view === null" aria-busy="true">
        <BohrSkeleton class="move__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>

      <!-- Choose the account and prepare the pull request -->
      <template v-else-if="view.status === 'available'">
        <p class="card-text">{{ t('move.text') }}</p>
        <h3 class="move__subtitle">{{ t('move.howTitle') }}</h3>
        <ol class="move__list">
          <li>{{ t('move.how1') }}</li>
          <li>{{ t('move.how2') }}</li>
          <li>{{ t('move.how3') }}</li>
        </ol>

        <p v-if="connections.length === 0" class="notice move__notice">{{ t('move.connectFirst') }}</p>
        <fieldset v-else class="move__accounts">
          <legend class="field-label">{{ t('move.accountLegend') }}</legend>
          <label v-for="connection in connections" :key="connection.id" class="move__account">
            <input v-model="selected" type="radio" :name="`${id}-account`" :value="connection.id" class="move__radio" />
            <span class="move__account-name">{{ connection.accountName ?? connection.accountId }}</span>
            <span class="move__account-id">{{ connection.accountId }}</span>
          </label>
        </fieldset>

        <div v-if="error !== null" class="notice notice--error move__notice" role="alert">
          <p>{{ error }}</p>
          <p v-if="errorDetail !== null" class="move__detail">{{ errorDetail }}</p>
        </div>

        <div v-if="connections.length > 0" class="actions move__actions">
          <BohrButton :disabled="selected === null || busy" @click="confirmOpen = true">{{ t('move.prepare') }}</BohrButton>
          <BohrButton v-if="!connecting" variant="text" @click="startConnecting">{{ t('move.otherAccount') }}</BohrButton>
        </div>
      </template>

      <!-- Prepared (waiting for the merge, or for pending domains) or done -->
      <template v-else>
        <p v-if="view.status === 'done'" class="notice notice--success move__notice" role="status">
          {{ t('move.done', { account: accountLabel(view.accountId) }) }}
        </p>
        <template v-else-if="view.hostnames.length === 0">
          <p class="card-text">{{ t('move.prepared', { number: view.pullRequest.number }) }}</p>
          <ol class="move__list">
            <li>{{ t('move.step1', { number: view.pullRequest.number }) }}</li>
            <li>{{ t('move.step2') }}</li>
            <li>{{ t('move.step3') }}</li>
          </ol>
        </template>
        <p v-else class="notice notice--warn move__notice" role="status">{{ t('move.partial') }}</p>

        <ul v-if="view.hostnames.length > 0" class="move__hostnames" role="list" :aria-label="t('move.hostnamesLabel')">
          <li v-for="entry in view.hostnames" :key="entry.hostname" class="move__hostname">
            <span class="move__host">{{ entry.hostname }}</span>
            <span class="badge" :class="BADGES[entry.status]">{{ t(`move.statuses.${entry.status}`) }}</span>
          </li>
        </ul>
        <p v-if="has('pending')" class="card-text move__help">{{ t('move.pendingHelp') }}</p>
        <p v-if="has('proxied')" class="card-text move__help">{{ t('move.proxiedHelp') }}</p>
        <p v-if="has('redirected')" class="card-text move__help">{{ t('move.redirectedHelp') }}</p>
        <p v-if="has('dropped')" class="card-text move__help">{{ t('move.droppedHelp') }}</p>

        <div v-if="error !== null" class="notice notice--error move__notice" role="alert">
          <p>{{ error }}</p>
          <p v-if="errorDetail !== null" class="move__detail">{{ errorDetail }}</p>
        </div>

        <div class="actions move__actions">
          <BohrButton v-if="view.status === 'prepared'" :disabled="busy" @click="complete">
            {{ busy ? t('common.working') : t('move.complete') }}
          </BohrButton>
          <BohrButton :href="view.pullRequest.url" target="_blank" rel="noopener noreferrer" variant="ghost">
            <template #iconLeft><NewWindowIcon :size="12" /></template>
            {{ t('move.openPullRequest', { number: view.pullRequest.number }) }}
          </BohrButton>
        </div>
      </template>
    </SettingsCard>

    <!-- No Cloudflare account yet (or another one): the wizard's token steps -->
    <template v-if="view?.status === 'available' && (connections.length === 0 || connecting)">
      <ErrorState v-if="cloudflareError !== null" :message="errorText(cloudflareError)" @retry="loadCloudflare" />
      <StepCloudflareAccount
        v-else-if="cloudflare !== null && pendingAccounts !== null"
        :onboarding="{ ...cloudflare, pendingAccounts }"
        @result="onCloudflare"
        @paste-token="pendingAccounts = null"
      />
      <StepCloudflare v-else-if="cloudflare !== null" :onboarding="cloudflare" :missing="missing" @result="onCloudflare" />
    </template>

    <ConfirmDialog
      :open="confirmOpen"
      :title="t('move.confirmTitle')"
      :confirm-label="t('move.prepare')"
      :busy="busy"
      @confirm="prepare"
      @cancel="confirmOpen = false"
    >
      <p>{{ t('move.confirmText', { account: accountLabel(selectedAccountId) }) }}</p>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, NewWindowIcon, SettingsCard, useToast } from '@bohr/ui';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ApiError,
  api,
  type CloudflareAccount,
  type CloudflareConnection,
  type CloudflareResult,
  type MovedHostname,
  type MoveView,
  type Onboarding,
} from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import ConfirmDialog from '../ConfirmDialog.vue';
import ErrorState from '../ErrorState.vue';
import StepCloudflare from '../onboarding/StepCloudflare.vue';
import StepCloudflareAccount from '../onboarding/StepCloudflareAccount.vue';

const BADGES: Record<MovedHostname['status'], string> = {
  moved: 'badge--green',
  proxied: 'badge--green',
  redirected: 'badge--cyan',
  pending: 'badge--amber',
  dropped: '',
};

// A project migrated from bohr v1 runs on bohr's Cloudflare account until its owner moves it to their own:
// a pull request changes the deploy, then completing the move copies the secrets and moves the domains.
const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ moved: [] }>();

const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const id = `move-${useId()}`;

const view = ref<MoveView | null>(null);
const connections = ref<CloudflareConnection[]>([]);
const loadError = ref<unknown>(null);
const selected = ref<string | null>(null);
const busy = ref(false);
const confirmOpen = ref(false);
/** A translated sentence, plus the instance's own (English) reason when there is one. */
const error = ref<string | null>(null);
const errorDetail = ref<string | null>(null);

// Connecting a Cloudflare account, as in the wizard
const connecting = ref(false);
const cloudflare = ref<Onboarding | null>(null);
const cloudflareError = ref<unknown>(null);
const pendingAccounts = ref<CloudflareAccount[] | null>(null);
const missing = ref<Extract<CloudflareResult, { status: 'missing' }> | null>(null);

const selectedAccountId = computed(
  () => connections.value.find((connection) => connection.id === selected.value)?.accountId ?? '',
);

function accountLabel(accountId: string): string {
  return connections.value.find((connection) => connection.accountId === accountId)?.accountName ?? accountId;
}

function has(status: MovedHostname['status']): boolean {
  return view.value !== null && 'hostnames' in view.value && view.value.hostnames.some((h) => h.status === status);
}

function showError(caught: unknown, conflictText: string) {
  if (caught instanceof ApiError && caught.status === 409) {
    error.value = conflictText;
    errorDetail.value = caught.message;
  } else {
    error.value = errorText(caught);
    errorDetail.value = null;
  }
}

function clearError() {
  error.value = null;
  errorDetail.value = null;
}

async function load() {
  loadError.value = null;
  try {
    const result = await api.moveStatus(props.projectId);
    view.value = result.move;
    connections.value = result.connections;
    if (!connections.value.some((connection) => connection.id === selected.value)) {
      selected.value = connections.value[0]?.id ?? null;
    }
    if (result.move.status === 'available' && result.connections.length === 0) void loadCloudflare();
  } catch (caught) {
    loadError.value = caught;
  }
}

/** The token template link comes with the onboarding. */
async function loadCloudflare() {
  if (cloudflare.value !== null) return;
  cloudflareError.value = null;
  try {
    cloudflare.value = await api.onboarding();
  } catch (caught) {
    cloudflareError.value = caught;
  }
}

function startConnecting() {
  connecting.value = true;
  void loadCloudflare();
}

async function onCloudflare(result: CloudflareResult) {
  missing.value = result.status === 'missing' ? result : null;
  pendingAccounts.value = result.status === 'choose_account' ? result.accounts : null;
  if (result.status !== 'connected') return;
  toast.success(
    result.accountName
      ? t('wizard.cloudflare.connected', { account: result.accountName })
      : t('wizard.cloudflare.connectedNoName'),
  );
  connecting.value = false;
  selected.value = result.connectionId;
  await load();
}

async function prepare() {
  if (selected.value === null) return;
  busy.value = true;
  clearError();
  try {
    view.value = (await api.prepareMove(props.projectId, selected.value)).move;
  } catch (caught) {
    showError(caught, t('move.cannotPrepare'));
  } finally {
    busy.value = false;
    confirmOpen.value = false;
  }
}

async function complete() {
  busy.value = true;
  clearError();
  try {
    view.value = (await api.completeMove(props.projectId)).move;
    if (view.value.status === 'done') emit('moved');
  } catch (caught) {
    showError(caught, t('move.notYet'));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.move {
  display: grid;
  gap: 24px;
  max-width: 760px;
}

.move__skeleton {
  width: 100%;
  height: 120px;
  margin-top: 16px;
}

.move__subtitle {
  margin-top: 20px;
  font-size: 16px;
}

.move__list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding-left: 22px;
  line-height: 1.55;
  color: var(--bohr-color-text-muted);
}

.move__list li::marker {
  font-weight: 700;
  color: var(--bohr-color-amber);
}

.move__notice {
  margin-top: 20px;
}

.move__accounts {
  display: grid;
  gap: 10px;
  margin: 24px 0 0;
  padding: 0;
  border: 0;
}

.move__account {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 2px 12px;
  padding: 12px 14px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: var(--bohr-radius-md);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.move__account:hover,
.move__account:has(:checked) {
  border-color: var(--bohr-color-frame);
}

.move__radio {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.move__account-name {
  font-weight: 700;
}

.move__account-id {
  overflow: hidden;
  font-family: var(--bohr-font-family-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  color: var(--bohr-color-text-muted);
}

.move__hostnames {
  display: grid;
  gap: 6px;
  margin-top: 20px;
}

.move__hostname {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 10px 12px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
}

.move__host {
  font-family: var(--bohr-font-family-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.move__help {
  margin-top: 14px;
}

.move__detail {
  font-size: 12px;
  overflow-wrap: anywhere;
  opacity: 0.85;
}

.move__actions {
  margin-top: 24px;
}
</style>
