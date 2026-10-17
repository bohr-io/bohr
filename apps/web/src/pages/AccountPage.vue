<template>
  <div class="page page--narrow account">
    <BohrPageTitle :title="t('account.title')" />

    <div class="stack account__cards">
      <SettingsCard>
        <h2 class="account__title">{{ t('account.profile') }}</h2>
        <dl class="facts account__facts">
          <div>
            <dt>{{ t('account.name') }}</dt>
            <dd>{{ me?.user.name ?? t('account.unknown') }}</dd>
          </div>
          <div>
            <dt>{{ t('account.email') }}</dt>
            <dd>{{ me?.user.email ?? t('account.unknown') }}</dd>
          </div>
        </dl>
      </SettingsCard>

      <section class="stack" aria-labelledby="connections-title" data-section="connections">
        <h2 id="connections-title" class="account__section">{{ t('connections.title') }}</h2>

        <ErrorState
          v-if="connections === null && loadError !== null"
          :message="errorText(loadError)"
          @retry="loadConnections"
        />
        <div v-else-if="connections === null" aria-busy="true">
          <BohrSkeleton class="account__skeleton" radius="8px" />
          <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
        </div>

        <template v-else>
          <SettingsCard data-card="sign-in">
            <h3 class="account__title">{{ t('connections.signInTitle') }}</h3>
            <p class="card-text account__text">{{ t('connections.signInText') }}</p>
            <ul class="items" role="list">
              <li v-for="method in signInMethods" :key="method.provider" class="items__item" :data-provider="method.provider">
                <component :is="method.icon" :size="20" class="items__icon" />
                <div class="items__text">
                  <p class="items__name">{{ method.name }}</p>
                  <p class="items__value">{{ method.identity?.username ?? (method.identity ? t('connections.connected') : t('connections.notConnected')) }}</p>
                </div>
                <span
                  v-if="method.identity"
                  class="items__action"
                  :title="method.identity.canRemove ? undefined : t('connections.lastMethod')"
                >
                  <BohrButton
                    size="sm"
                    variant="ghost"
                    danger
                    :disabled="!method.identity.canRemove"
                    :aria-describedby="method.identity.canRemove ? undefined : 'last-method'"
                    @click="askRemoveIdentity(method.provider, method.name)"
                  >
                    {{ t('connections.remove') }}
                  </BohrButton>
                </span>
                <BohrButton v-else-if="method.provider === 'github'" size="sm" :href="linkGithubHref">
                  {{ t('connections.connectGithub') }}
                </BohrButton>
                <BohrButton v-else-if="!addingEmail" size="sm" @click="addingEmail = true">
                  {{ t('connections.addEmail') }}
                </BohrButton>
              </li>
            </ul>
            <p v-if="lastMethod" id="last-method" class="field-hint">{{ t('connections.lastMethod') }}</p>
            <div v-if="addingEmail" class="account__email" data-form="add-email">
              <EmailCodeForm
                :start="startEmail"
                :verify="addEmail"
                :submit-label="t('connections.addEmailSubmit')"
                :verify-label="t('connections.addEmailVerify')"
                :conflict-message="t('connections.emailTaken')"
                :hint="demo ? t('login.demoCode', { code: '123456' }) : undefined"
                cancelable
                @cancel="addingEmail = false"
              />
            </div>
          </SettingsCard>

          <SettingsCard data-card="github-app">
            <h3 class="account__title">{{ t('connections.githubAppTitle') }}</h3>
            <p class="card-text account__text">{{ t('connections.githubAppText') }}</p>
            <ul v-if="connections.githubInstallations.length > 0" class="items" role="list">
              <li v-for="installation in connections.githubInstallations" :key="installation.id" class="items__item">
                <GithubIcon :size="20" class="items__icon" />
                <div class="items__text">
                  <p class="items__name">{{ installation.account }}</p>
                  <p class="items__value">{{ t('connections.projects', { count: installation.projects }) }}</p>
                </div>
                <BohrButton size="sm" variant="ghost" danger @click="askDisconnectGithub(installation)">
                  {{ t('connections.disconnect') }}
                </BohrButton>
              </li>
            </ul>
            <p v-else class="field-hint">{{ t('connections.githubAppNone') }}</p>
          </SettingsCard>

          <SettingsCard data-card="cloudflare">
            <h3 class="account__title">{{ t('connections.cloudflareTitle') }}</h3>
            <p class="card-text account__text">{{ t('connections.cloudflareText') }}</p>
            <ul v-if="connections.cloudflare.length > 0" class="items" role="list">
              <li v-for="account in connections.cloudflare" :key="account.id" class="items__item">
                <div class="items__text">
                  <p class="items__name">{{ account.accountName ?? account.accountId }}</p>
                  <p class="items__value">
                    <code class="inline-code">{{ account.accountId }}</code>
                    · {{ t('connections.projects', { count: account.projects }) }}
                  </p>
                </div>
                <BohrButton size="sm" variant="ghost" danger @click="askDisconnectCloudflare(account)">
                  {{ t('connections.disconnect') }}
                </BohrButton>
              </li>
            </ul>
            <p v-else class="field-hint">{{ t('connections.cloudflareNone') }}</p>
            <div v-if="cloudflareHint !== null" class="notice notice--warn account__notice" role="status" data-notice="cloudflare">
              <strong class="notice__title">{{ t('connections.cloudflareRemoved') }}</strong>
              <p>{{ cloudflareHint }}</p>
            </div>
          </SettingsCard>

          <SettingsCard data-card="telegram">
            <h3 class="account__title">{{ t('connections.telegramTitle') }}</h3>
            <template v-if="connections.telegram !== null">
              <ul class="items" role="list">
                <li class="items__item">
                  <SendIcon :size="20" class="items__icon" />
                  <div class="items__text">
                    <p class="items__name">{{ t('connections.telegram') }}</p>
                    <p class="items__value">
                      {{ connections.telegram.username ? `@${connections.telegram.username}` : t('connections.connected') }}
                    </p>
                  </div>
                  <BohrButton size="sm" variant="ghost" danger @click="askDisconnectTelegram">
                    {{ t('connections.disconnect') }}
                  </BohrButton>
                </li>
              </ul>
            </template>
            <template v-else>
              <p class="card-text account__text">{{ t('account.telegramText') }}</p>
              <TelegramLinkButton class="account__actions">
                <BohrButton variant="ghost" :disabled="checking" @click="refresh">
                  {{ checking ? t('common.checking') : t('account.telegramDone') }}
                </BohrButton>
              </TelegramLinkButton>
            </template>
          </SettingsCard>

          <SettingsCard data-card="agent">
            <h3 class="account__title">{{ t('account.agentTitle') }}</h3>
            <p class="card-text account__text">
              {{ connections.agent.configured ? t('account.agentOn') : t('account.agentOff') }}
            </p>
            <dl v-if="connections.agent.configured" class="facts account__facts">
              <div>
                <dt>{{ t('connections.agentProvider') }}</dt>
                <dd>
                  {{
                    connections.agent.provider === 'compatible'
                      ? (connections.agent.baseUrl ?? t('connections.agentCompatible'))
                      : connections.agent.provider === 'subscription'
                        ? t('connections.agentSubscription')
                        : 'Anthropic'
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ t('connections.agentModel') }}</dt>
                <dd>{{ connections.agent.model ?? t('connections.agentDefault') }}</dd>
              </div>
              <div v-if="connections.agent.keyHint">
                <dt>{{ t('connections.agentKey') }}</dt>
                <dd><code class="inline-code">{{ connections.agent.keyHint }}</code></dd>
              </div>
            </dl>
            <div class="actions account__actions">
              <BohrButton :as="RouterLink" :to="{ name: 'account-agent' }" :variant="connections.agent.configured ? 'ghost' : 'default'">
                {{ connections.agent.configured ? t('connections.agentConfigure') : t('account.agentSetUp') }}
              </BohrButton>
              <BohrButton v-if="connections.agent.configured" variant="ghost" danger @click="askDisconnectAgent">
                {{ t('connections.disconnect') }}
              </BohrButton>
            </div>
          </SettingsCard>
        </template>
      </section>

      <SettingsCard data-card="tokens">
        <h2 class="account__title">{{ t('account.tokensTitle') }}</h2>
        <p class="card-text account__text">{{ t('account.tokensText') }}</p>
        <div class="actions account__actions">
          <BohrButton :as="RouterLink" :to="{ name: 'account-tokens' }" variant="ghost">{{ t('account.tokensOpen') }}</BohrButton>
        </div>
      </SettingsCard>

      <SettingsCard v-if="billing !== null">
        <h2 class="account__title">{{ t('account.billingTitle') }}</h2>
        <p class="card-text">
          {{
            billing.subscription === null
              ? t('account.billingNone')
              : isActiveSubscription(billing.subscription.status)
                ? t('account.billingActive')
                : t('account.billingInactive')
          }}
        </p>
        <div class="actions account__actions">
          <BohrButton :as="RouterLink" to="/billing" variant="ghost">{{ t('account.billingOpen') }}</BohrButton>
        </div>
      </SettingsCard>

      <SettingsCard>
        <h2 class="account__title">{{ t('account.language.title') }}</h2>
        <p class="card-text">{{ t('account.language.text') }}</p>
        <div class="account__language">
          <LanguageSwitcher />
        </div>
      </SettingsCard>

      <SettingsCard>
        <h2 class="account__title">{{ t('account.signOutTitle') }}</h2>
        <p class="card-text">{{ t('account.signOutText') }}</p>
        <div class="actions account__actions">
          <BohrButton variant="ghost" danger :disabled="signingOut" @click="logOut">
            {{ signingOut ? t('common.working') : t('account.signOut') }}
          </BohrButton>
        </div>
      </SettingsCard>

      <SettingsCard danger data-card="danger">
        <h2 class="account__title account__danger">{{ t('deleteAccount.title') }}</h2>
        <p class="card-text">{{ t('deleteAccount.text') }}</p>
        <div class="actions account__actions">
          <BohrButton danger @click="deleteOpen = true">{{ t('deleteAccount.button') }}</BohrButton>
        </div>
      </SettingsCard>
    </div>

    <ConfirmDialog
      :open="pending !== null"
      :title="pending?.title ?? ''"
      :confirm-label="pending?.confirmLabel ?? ''"
      danger
      :busy="pendingBusy"
      @confirm="runPending"
      @cancel="pending = null"
    >
      <div v-if="pending !== null" class="confirm-text" data-dialog="disconnect">
        <p v-for="line in pending.text" :key="line">{{ line }}</p>
        <p v-if="pendingError !== null" class="confirm-text__error" role="alert">{{ pendingError }}</p>
      </div>
    </ConfirmDialog>

    <DeleteAccountDialog
      :open="deleteOpen"
      :title="t('deleteAccount.confirmTitle')"
      :intro="t('deleteAccount.intro')"
      :remove="deleteAccount"
      @cancel="deleteOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, BohrSkeleton, GithubIcon, SettingsCard, useToast } from '@bohr/ui';
import { type Component, computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, type Billing, type Connections, type IdentityProvider } from '../api';
import DeleteAccountDialog from '../components/account/DeleteAccountDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmailCodeForm from '../components/EmailCodeForm.vue';
import ErrorState from '../components/ErrorState.vue';
import { MailIcon, SendIcon } from '../components/icons';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';
import TelegramLinkButton from '../components/TelegramLinkButton.vue';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { isActiveSubscription } from '../lib/billing';
import { clearSession, loadSession, session, setFarewell, signOut } from '../session';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();

const demo = import.meta.env.MODE === 'demo';
const me = computed(() => session.me);

const checking = ref(false);
const signingOut = ref(false);
/** The bohr.io Cloud subscription; null where the instance does not charge (404) or did not answer. */
const billing = ref<Billing | null>(null);
const connections = ref<Connections | null>(null);
const loadError = ref<unknown>(null);
const addingEmail = ref(false);
/** After disconnecting a Cloudflare account: the API token to delete in Cloudflare too. */
const cloudflareHint = ref<string | null>(null);
const deleteOpen = ref(false);

/** Linking GitHub signs in there and comes back here (with ?error= when it could not link). */
const linkGithubHref = `/auth/github?link=1&redirect=${encodeURIComponent('/account')}`;

type SignInProvider = Extract<IdentityProvider, 'github' | 'email'>;

const signInMethods = computed(() => {
  const list: { provider: SignInProvider; name: string; icon: Component }[] = [
    { provider: 'github', name: t('connections.github'), icon: GithubIcon },
    { provider: 'email', name: t('connections.email'), icon: MailIcon },
  ];
  return list.map((method) => ({
    ...method,
    identity: connections.value?.identities.find((entry) => entry.provider === method.provider) ?? null,
  }));
});
const lastMethod = computed(() => signInMethods.value.some((method) => method.identity?.canRemove === false));

async function loadConnections() {
  loadError.value = null;
  try {
    connections.value = await api.connections();
  } catch (caught) {
    loadError.value = caught;
  }
}

/** The connections and the session's identities, after a change. */
async function reload() {
  await Promise.all([loadConnections(), loadSession(true).catch(() => null)]);
}

onMounted(async () => {
  // Back from /auth/github?link=1 when GitHub could not be linked.
  const linkError = route.query.error;
  if (typeof linkError === 'string' && linkError !== '') {
    toast.error(t('connections.linkError', { detail: linkError }), { persistent: true });
    const { error: _error, ...query } = route.query;
    void router.replace({ query });
  }
  void loadConnections();
  try {
    billing.value = await api.billing();
  } catch {
    billing.value = null;
  }
});

/** After linking in Telegram, reload the connections. */
async function refresh() {
  checking.value = true;
  try {
    await reload();
  } catch (error) {
    showError(error);
  } finally {
    checking.value = false;
  }
}

function startEmail(email: string) {
  return api.linkEmailStart(email);
}

async function addEmail(email: string, code: string) {
  await api.linkEmailVerify(email, code);
  addingEmail.value = false;
  toast.success(t('connections.emailAdded', { email }));
  await reload();
}

// Every disconnection asks first, in one dialog.
interface Pending {
  title: string;
  text: string[];
  confirmLabel: string;
  run: () => Promise<void>;
}

const pending = ref<Pending | null>(null);
const pendingBusy = ref(false);
const pendingError = ref<string | null>(null);

function ask(action: Pending) {
  pendingError.value = null;
  pending.value = action;
}

async function runPending() {
  const action = pending.value;
  if (action === null || pendingBusy.value) return;
  pendingBusy.value = true;
  pendingError.value = null;
  try {
    await action.run();
    pending.value = null;
    await reload();
  } catch (caught) {
    // A 409 lists the projects that still use the connection.
    pendingError.value = errorText(caught);
  } finally {
    pendingBusy.value = false;
  }
}

function askRemoveIdentity(provider: SignInProvider, name: string) {
  ask({
    title: t('connections.removeTitle', { name }),
    text: [t('connections.removeText', { name })],
    confirmLabel: t('connections.remove'),
    run: async () => {
      await api.removeIdentity(provider);
      toast.success(t('connections.removed', { name }));
    },
  });
}

function askDisconnectGithub(installation: Connections['githubInstallations'][number]) {
  ask({
    title: t('connections.githubAppConfirmTitle', { account: installation.account }),
    text: [t('connections.githubAppConfirmText', { account: installation.account }), t('connections.githubAppRepos')],
    confirmLabel: t('connections.disconnect'),
    run: async () => {
      await api.disconnectGithubInstallation(installation.id);
      toast.success(t('connections.disconnected', { name: installation.account }));
    },
  });
}

function askDisconnectCloudflare(account: Connections['cloudflare'][number]) {
  const name = account.accountName ?? account.accountId;
  ask({
    title: t('connections.cloudflareConfirmTitle', { name }),
    text: [t('connections.cloudflareConfirmText', { name })],
    confirmLabel: t('connections.disconnect'),
    run: async () => {
      const { hint } = await api.disconnectCloudflare(account.id);
      cloudflareHint.value = hint ?? t('connections.cloudflareTokenHint');
    },
  });
}

function askDisconnectTelegram() {
  const name = t('connections.telegram');
  ask({
    title: t('connections.telegramConfirmTitle'),
    text: [t('connections.telegramConfirmText')],
    confirmLabel: t('connections.disconnect'),
    run: async () => {
      await api.removeIdentity('telegram');
      toast.success(t('connections.disconnected', { name }));
    },
  });
}

function askDisconnectAgent() {
  ask({
    title: t('connections.agentConfirmTitle'),
    text: [t('connections.agentConfirmText')],
    confirmLabel: t('connections.disconnect'),
    run: async () => {
      await api.removeAgentSettings();
      toast.success(t('agentSettings.removed'));
    },
  });
}

async function deleteAccount(deleteSites: boolean) {
  const { warnings } = await api.deleteAccount({ deleteSites });
  deleteOpen.value = false;
  clearSession();
  setFarewell(warnings);
  await router.replace({ name: 'login' });
}

async function logOut() {
  signingOut.value = true;
  try {
    await signOut();
    await router.replace({ name: 'login' });
  } catch (error) {
    showError(error);
  } finally {
    signingOut.value = false;
  }
}
</script>

<style scoped>
.account__cards {
  margin-top: 36px;
}

.account__section {
  margin-top: 12px;
  font-size: 22px;
}

.account__title {
  font-size: 18px;
}

.account__danger {
  color: var(--bohr-color-red);
}

.account__text {
  margin-top: 8px;
}

.account__facts {
  margin-top: 16px;
}

.account__skeleton {
  width: 100%;
  height: 360px;
}

.items {
  display: grid;
  gap: 2px;
  margin-top: 16px;
}

.items__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
}

.items__item + .items__item {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.items__icon {
  flex-shrink: 0;
  color: var(--bohr-color-text-muted);
}

.items__text {
  flex: 1;
  min-width: 160px;
}

.items__name {
  font-weight: 700;
}

.items__value {
  font-size: 14px;
  color: var(--bohr-color-text-muted);
  overflow-wrap: anywhere;
}

.items__action {
  display: inline-flex;
}

.account__email {
  max-width: 440px;
  margin-top: 16px;
}

.account__notice,
.account__language,
.account__actions {
  margin-top: 16px;
}

.confirm-text {
  display: grid;
  gap: 10px;
}

.confirm-text__error {
  font-size: 13px;
  font-weight: 700;
  color: hsl(355 78% 42%);
}
</style>
