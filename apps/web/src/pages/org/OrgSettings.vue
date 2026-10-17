<template>
  <div class="stack org-settings">
    <h2 class="org-settings__page-title">{{ t('orgs.nav.settings') }}</h2>
    <p v-if="!isAdmin" class="notice notice--warn" role="status" data-notice="admins-only">{{ t('orgs.settings.adminsOnly') }}</p>

    <template v-else-if="detail !== null">
      <SettingsCard data-card="general">
        <h2 class="org-settings__title">{{ t('orgs.settings.general') }}</h2>
        <dl class="facts org-settings__facts">
          <div>
            <dt>{{ t('orgs.settings.name') }}</dt>
            <dd>{{ detail.org.name }}</dd>
          </div>
          <div>
            <dt>{{ t('orgs.settings.githubOrg') }}</dt>
            <dd>
              <a :href="githubUrl" target="_blank" rel="noopener noreferrer" class="text-link">{{ `github.com/${detail.org.githubLogin}` }}</a>
            </dd>
          </div>
        </dl>
        <p class="field-hint org-settings__hint">{{ t('orgs.settings.nameHint') }}</p>
      </SettingsCard>

      <SettingsCard data-card="cloudflare">
        <h2 class="org-settings__title">{{ t('connections.cloudflareTitle') }}</h2>
        <p class="card-text org-settings__text">{{ t('orgs.settings.cloudflareText') }}</p>
        <ErrorState v-if="cloudflare === null && cloudflareError !== null" :message="errorText(cloudflareError)" @retry="loadCloudflare" />
        <template v-else-if="cloudflare !== null">
          <ul v-if="cloudflare.connections.length > 0" class="org-settings__items" role="list">
            <li v-for="account in cloudflare.connections" :key="account.id" class="org-settings__item" :data-connection="account.id">
              <div class="org-settings__item-text">
                <p class="org-settings__item-name">{{ account.accountName ?? account.accountId }}</p>
                <p class="org-settings__item-value">
                  <code class="inline-code">{{ account.accountId }}</code>
                  <template v-if="account.projects !== undefined"> · {{ t('connections.projects', { count: account.projects }) }}</template>
                </p>
              </div>
              <BohrButton size="sm" variant="ghost" danger @click="askDisconnect(account)">{{ t('connections.disconnect') }}</BohrButton>
            </li>
          </ul>
          <p v-else class="field-hint">{{ t('connections.cloudflareNone') }}</p>
          <div v-if="cloudflareHint !== null" class="notice notice--warn org-settings__notice" role="status">
            <strong class="notice__title">{{ t('connections.cloudflareRemoved') }}</strong>
            <p>{{ cloudflareHint }}</p>
          </div>
          <div v-if="!connecting" class="actions org-settings__actions">
            <BohrButton variant="ghost" data-action="connect-cloudflare" @click="connecting = true">
              {{ cloudflare.connections.length > 0 ? t('orgs.settings.cloudflareAnother') : t('orgs.settings.cloudflareConnect') }}
            </BohrButton>
          </div>
        </template>
      </SettingsCard>
      <template v-if="connecting && cloudflare !== null">
        <StepCloudflareAccount
          v-if="pendingAccounts.length > 0"
          :key="pendingAccounts.map((account) => account.id).join()"
          :org="slug"
          :onboarding="{ pendingAccounts }"
          @result="onCloudflare"
          @paste-token="pendingAccounts = []"
        />
        <StepCloudflare v-else :org="slug" :onboarding="{ cloudflare }" :missing="missing" @result="onCloudflare" />
      </template>

      <SettingsCard data-card="agent">
        <div class="org-settings__heading">
          <h2 class="org-settings__title">{{ t('agentSettings.cardTitle') }}</h2>
          <template v-if="agent !== null">
            <span v-if="agent.configured" class="badge badge--green">{{ t('agentSettings.on') }}</span>
            <span v-else class="badge badge--amber">{{ t('agentSettings.off') }}</span>
          </template>
        </div>
        <p class="card-text org-settings__text">{{ t('orgs.settings.agentText') }}</p>
        <ErrorState v-if="agent === null && agentError !== null" :message="errorText(agentError)" @retry="loadAgent" />
        <div v-else-if="agent === null" aria-busy="true">
          <BohrSkeleton class="org-settings__skeleton" radius="8px" />
          <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
        </div>
        <AgentSettingsForm v-else :settings="agent" :org="slug" class="org-settings__form" @update:settings="onAgent" />
      </SettingsCard>

      <SettingsCard v-if="detail.billing.enabled" data-card="billing">
        <h2 class="org-settings__title">{{ t('orgs.settings.billing') }}</h2>
        <p class="card-text org-settings__text">
          {{ subscribed ? t('orgs.settings.billingActive') : t('orgs.settings.billingNone', { price }) }}
        </p>
        <div class="actions org-settings__actions">
          <BohrButton v-if="!subscribed" :disabled="billingBusy" data-action="checkout" @click="openBilling(api.orgBillingCheckout)">
            {{ t('billing.subscribe') }}
          </BohrButton>
          <BohrButton v-else variant="ghost" :disabled="billingBusy" data-action="portal" @click="openBilling(api.orgBillingPortal)">
            {{ t('billing.manage') }}
          </BohrButton>
        </div>
      </SettingsCard>

      <OrgDangerZone :slug="slug" :name="detail.org.name" />
    </template>

    <ConfirmDialog
      :open="disconnecting !== null"
      :title="t('connections.cloudflareConfirmTitle', { name: disconnectName })"
      :confirm-label="t('connections.disconnect')"
      danger
      :busy="disconnectBusy"
      @confirm="disconnect"
      @cancel="disconnecting = null"
    >
      <div class="org-settings__confirm">
        <p>{{ t('orgs.settings.cloudflareConfirmText', { name: disconnectName }) }}</p>
        <p v-if="disconnectError !== null" class="org-settings__error" role="alert">{{ disconnectError }}</p>
      </div>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, SettingsCard, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type AgentSettings, api, type CloudflareAccount, type CloudflareResult, type OrgCloudflare } from '../../api';
import AgentSettingsForm from '../../components/AgentSettingsForm.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ErrorState from '../../components/ErrorState.vue';
import StepCloudflare from '../../components/onboarding/StepCloudflare.vue';
import StepCloudflareAccount from '../../components/onboarding/StepCloudflareAccount.vue';
import OrgDangerZone from '../../components/org/OrgDangerZone.vue';
import { useErrorText, useErrorToast } from '../../composables/useErrorText';
import { useOrg } from '../../composables/useOrg';
import { CLOUD_PRICE_USD } from '../../lib/billing';
import { formatUsd } from '../../lib/format';
import { orgSubscribed } from '../../lib/org';

// The organization's settings (admins): its name from GitHub, its Cloudflare accounts, the agent, the
// subscription and the danger zone.
const { t, locale } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();
const { slug, detail, isAdmin, reload } = useOrg();

const githubUrl = computed(() => `https://github.com/${encodeURIComponent(detail.value?.org.githubLogin ?? slug)}`);
const subscribed = computed(() => detail.value !== null && orgSubscribed(detail.value));
const price = computed(() => formatUsd(CLOUD_PRICE_USD, locale.value, 0));

// Cloudflare
const cloudflare = ref<OrgCloudflare | null>(null);
const cloudflareError = ref<unknown>(null);
const connecting = ref(false);
const pendingAccounts = ref<CloudflareAccount[]>([]);
const missing = ref<Extract<CloudflareResult, { status: 'missing' }> | null>(null);
const cloudflareHint = ref<string | null>(null);

async function loadCloudflare() {
  cloudflareError.value = null;
  try {
    cloudflare.value = await api.orgCloudflare(slug);
  } catch (caught) {
    cloudflareError.value = caught;
  }
}

function onCloudflare(result: CloudflareResult) {
  missing.value = result.status === 'missing' ? result : null;
  pendingAccounts.value = result.status === 'choose_account' ? result.accounts : [];
  if (result.status !== 'connected') return;
  connecting.value = false;
  toast.success(
    result.accountName
      ? t('wizard.cloudflare.connected', { account: result.accountName })
      : t('wizard.cloudflare.connectedNoName'),
  );
  void loadCloudflare();
  void reload();
}

const disconnecting = ref<OrgCloudflare['connections'][number] | null>(null);
const disconnectBusy = ref(false);
const disconnectError = ref<string | null>(null);
const disconnectName = computed(() => disconnecting.value?.accountName ?? disconnecting.value?.accountId ?? '');

function askDisconnect(account: OrgCloudflare['connections'][number]) {
  disconnectError.value = null;
  disconnecting.value = account;
}

async function disconnect() {
  const account = disconnecting.value;
  if (account === null || disconnectBusy.value) return;
  disconnectBusy.value = true;
  disconnectError.value = null;
  try {
    const result = await api.disconnectOrgCloudflare(slug, account.id);
    cloudflareHint.value = result?.hint ?? t('connections.cloudflareTokenHint');
    disconnecting.value = null;
    await loadCloudflare();
    void reload();
  } catch (caught) {
    // A 409 lists the projects of the organization that still use the account.
    disconnectError.value = errorText(caught);
  } finally {
    disconnectBusy.value = false;
  }
}

// The agent
const agent = ref<AgentSettings | null>(null);
const agentError = ref<unknown>(null);

async function loadAgent() {
  agentError.value = null;
  try {
    agent.value = (await api.orgAgentSettings(slug)).agent;
  } catch (caught) {
    agentError.value = caught;
  }
}

function onAgent(settings: AgentSettings) {
  agent.value = settings;
  void reload();
}

// Billing: Stripe's pages, from URLs the instance hands out.
const billingBusy = ref(false);

async function openBilling(open: (slug: string) => Promise<{ url: string }>) {
  billingBusy.value = true;
  try {
    window.location.assign((await open(slug)).url);
  } catch (caught) {
    showError(caught);
    billingBusy.value = false;
  }
}

onMounted(() => {
  if (!isAdmin.value) return;
  void loadCloudflare();
  void loadAgent();
});
</script>

<style scoped>
.org-settings__page-title {
  font-size: 22px;
}

.org-settings__title {
  font-size: 18px;
}

.org-settings__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.org-settings__text {
  margin-top: 8px;
}

.org-settings__facts,
.org-settings__hint,
.org-settings__notice,
.org-settings__actions,
.org-settings__form {
  margin-top: 16px;
}

.org-settings__skeleton {
  width: 100%;
  height: 320px;
  margin-top: 16px;
}

.org-settings__items {
  display: grid;
  gap: 2px;
  margin-top: 16px;
}

.org-settings__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
}

.org-settings__item + .org-settings__item {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.org-settings__item-text {
  flex: 1;
  min-width: 160px;
}

.org-settings__item-name {
  font-weight: 700;
}

.org-settings__item-value {
  font-size: 14px;
  color: var(--bohr-color-text-muted);
  overflow-wrap: anywhere;
}

.org-settings__confirm {
  display: grid;
  gap: 10px;
}

.org-settings__error {
  font-size: 13px;
  font-weight: 700;
  color: hsl(355 78% 42%);
}
</style>
