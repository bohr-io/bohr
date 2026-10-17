<template>
  <section v-if="current !== null" class="org-setup" aria-labelledby="org-setup-title" data-setup>
    <h2 id="org-setup-title" class="org-setup__title">{{ t('orgs.setup.title') }}</h2>
    <p class="card-text">{{ t('orgs.setup.text') }}</p>

    <WizardProgress class="org-setup__progress" :steps="steps" :current="current" />
    <div ref="stepArea" class="org-setup__step" :data-view="current">
      <StepSubscription
        v-if="current === 'subscription'"
        :org="slug"
        :onboarding="{ billing }"
        :billing-returned="billingReturned"
        :confirming="confirmingPayment"
        @refresh="reload"
      />

      <template v-else-if="current === 'cloudflare'">
        <ErrorState v-if="cloudflare === null && cloudflareError !== null" :message="errorText(cloudflareError)" @retry="loadCloudflare" />
        <div v-else-if="cloudflare === null" aria-busy="true">
          <BohrSkeleton class="org-setup__skeleton" radius="8px" />
          <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
        </div>
        <StepCloudflareAccount
          v-else-if="pendingAccounts.length > 0"
          :key="pendingAccounts.map((account) => account.id).join()"
          :org="slug"
          :onboarding="{ pendingAccounts }"
          @result="onCloudflare"
          @paste-token="pendingAccounts = []"
        />
        <StepCloudflare v-else :org="slug" :onboarding="{ cloudflare }" :missing="missing" @result="onCloudflare" />
      </template>

      <WizardStep v-else step="agent" :title="t('orgs.setup.agentTitle')">
        <p class="card-text">{{ t('orgs.setup.agentText') }}</p>
        <ErrorState v-if="agent === null && agentError !== null" :message="errorText(agentError)" @retry="loadAgent" />
        <div v-else-if="agent === null" aria-busy="true">
          <BohrSkeleton class="org-setup__skeleton" radius="8px" />
          <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
        </div>
        <AgentSettingsForm v-else :settings="agent" :org="slug" class="org-setup__agent" @update:settings="onAgent" />
      </WizardStep>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrSkeleton, useToast } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { type AgentSettings, api, type CloudflareAccount, type CloudflareResult, type OrgCloudflare } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { useOrg } from '../../composables/useOrg';
import { orgSubscribed } from '../../lib/org';
import { createPoller } from '../../lib/poller';
import AgentSettingsForm from '../AgentSettingsForm.vue';
import ErrorState from '../ErrorState.vue';
import StepCloudflare from '../onboarding/StepCloudflare.vue';
import StepCloudflareAccount from '../onboarding/StepCloudflareAccount.vue';
import StepSubscription from '../onboarding/StepSubscription.vue';
import WizardProgress from '../onboarding/WizardProgress.vue';
import WizardStep from '../onboarding/WizardStep.vue';

// The organization's setup, for its admins, like the personal onboarding: the subscription (bohr.io Cloud),
// the Cloudflare account and the agent. It disappears once everything is set up.
type Phase = 'subscription' | 'cloudflare' | 'agent';

/** After Stripe Checkout: how often, and how many times, to look for the new subscription. */
const PAYMENT_POLL_MS = 3_000;
const MAX_PAYMENT_CHECKS = 40;

const { t } = useI18n();
const route = useRoute();
const toast = useToast();
const errorText = useErrorText();
const { slug, detail, reload } = useOrg();
const stepArea = useTemplateRef<HTMLElement>('stepArea');

const billing = computed(() => detail.value?.billing ?? { enabled: false, subscribed: false });

const phases = computed<Phase[]>(() => [
  ...(billing.value.enabled ? (['subscription'] as const) : []),
  'cloudflare',
  'agent',
]);
function isDone(phase: Phase): boolean {
  const org = detail.value;
  if (org === null) return false;
  return phase === 'subscription' ? orgSubscribed(org) : org.org.status[phase];
}
const current = computed<Phase | null>(() => phases.value.find((phase) => !isDone(phase)) ?? null);
const steps = computed(() => phases.value.map((phase) => ({ id: phase, label: t(`orgs.setup.phases.${phase}`) })));

// Cloudflare: the token template, then (for a token that reaches several accounts) the account to use.
const cloudflare = ref<OrgCloudflare | null>(null);
const cloudflareError = ref<unknown>(null);
const pendingAccounts = ref<CloudflareAccount[]>([]);
const missing = ref<Extract<CloudflareResult, { status: 'missing' }> | null>(null);

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
  if (result.status === 'connected') {
    toast.success(
      result.accountName
        ? t('wizard.cloudflare.connected', { account: result.accountName })
        : t('wizard.cloudflare.connectedNoName'),
    );
    void reload();
  }
}

// The agent: the same form as the account's, for the organization.
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
  if (settings.configured) void reload();
}

watch(
  current,
  (phase) => {
    if (phase === 'cloudflare' && cloudflare.value === null) void loadCloudflare();
    if (phase === 'agent' && agent.value === null) void loadAgent();
  },
  { immediate: true },
);

// Back from Stripe Checkout: the subscription arrives through a webhook, so look for it for a while.
const billingReturned = computed(() => route.query.billing === 'success');
const paymentChecks = ref(0);
const confirmingPayment = computed(
  () => billingReturned.value && current.value === 'subscription' && paymentChecks.value < MAX_PAYMENT_CHECKS,
);
const paymentPoller = createPoller(
  async () => {
    paymentChecks.value += 1;
    await reload();
  },
  () => PAYMENT_POLL_MS,
);
watch(confirmingPayment, (confirming) => (confirming ? paymentPoller.start(false) : paymentPoller.stop()), {
  immediate: true,
});
watch(
  () => isDone('subscription'),
  (paid, before) => {
    if (billingReturned.value && paid && before === false) toast.success(t('wizard.subscription.paid'));
  },
);

// A new step: move focus to its heading, so keyboard and screen reader users start there.
watch(current, async (next, previous) => {
  if (previous === undefined || previous === null || next === previous) return;
  await nextTick();
  stepArea.value?.querySelector<HTMLElement>('h2')?.focus();
});

onBeforeUnmount(() => paymentPoller.stop());
</script>

<style scoped>
.org-setup {
  margin-bottom: 40px;
}

.org-setup__title {
  font-size: 22px;
}

.org-setup__progress {
  margin-top: 24px;
}

.org-setup__step {
  margin-top: 24px;
}

.org-setup__skeleton {
  width: 100%;
  height: 280px;
}

.org-setup__agent {
  margin-top: 20px;
}
</style>
