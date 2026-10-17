<template>
  <div class="page page--narrow wizard">
    <BohrPageTitle :title="t('wizard.title')" />
    <p class="page-lead">{{ t('wizard.lead') }}</p>

    <ErrorState
      v-if="onboarding === null && loadError !== null"
      class="wizard__error"
      :message="errorText(loadError)"
      @retry="refresh"
    />
    <div v-else-if="onboarding === null" class="wizard__loading" aria-busy="true">
      <BohrSkeleton class="wizard__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <template v-else>
      <WizardProgress class="wizard__progress" :steps="steps" :current="currentPhase" />
      <div ref="stepArea" class="wizard__step" :data-view="view">
        <StepSubscription
          v-if="view === 'subscription'"
          :onboarding="onboarding"
          :billing-returned="billingReturned"
          :confirming="confirmingPayment"
          @refresh="refresh"
        />
        <StepCloudflare v-else-if="view === 'cloudflare'" :onboarding="onboarding" :missing="missing" @result="onCloudflare" />
        <StepCloudflareAccount
          v-else-if="view === 'cloudflare_account'"
          :onboarding="onboarding"
          @result="onCloudflare"
          @paste-token="local.pasteNewToken = true"
        />
        <StepGithub v-else-if="view === 'github'" :onboarding="onboarding" :refresh="refresh" />
        <StepDone v-else :agent-configured="onboarding.agent.configured" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrPageTitle, BohrSkeleton, useToast } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, type CloudflareResult, type Onboarding } from '../api';
import ErrorState from '../components/ErrorState.vue';
import StepCloudflare from '../components/onboarding/StepCloudflare.vue';
import StepCloudflareAccount from '../components/onboarding/StepCloudflareAccount.vue';
import StepDone from '../components/onboarding/StepDone.vue';
import StepGithub from '../components/onboarding/StepGithub.vue';
import StepSubscription from '../components/onboarding/StepSubscription.vue';
import WizardProgress from '../components/onboarding/WizardProgress.vue';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { createPoller } from '../lib/poller';
import { EMPTY_LOCAL, phaseOf, type WizardLocal, wizardPhases, wizardView } from '../lib/wizard';

// The onboarding: only what every user sets up once. Projects come afterwards (/projects/new) and the
// agent's provider lives in the account settings (/account/agente).

/** After Stripe Checkout: how often, and how many times, to look for the new subscription. */
const PAYMENT_POLL_MS = 3_000;
const MAX_PAYMENT_CHECKS = 40;

const { t } = useI18n();
const route = useRoute();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();
const stepArea = useTemplateRef<HTMLElement>('stepArea');

const onboarding = ref<Onboarding | null>(null);
const loadError = ref<unknown>(null);
const local = reactive<WizardLocal>({ ...EMPTY_LOCAL });
/** Permissions the last Cloudflare token lacked; shown again on the token form. */
const missing = ref<Extract<CloudflareResult, { status: 'missing' }> | null>(null);

const view = computed(() => (onboarding.value === null ? null : wizardView(onboarding.value, local)));
const steps = computed(() =>
  onboarding.value === null
    ? []
    : wizardPhases(onboarding.value).map((phase) => ({ id: phase, label: t(`wizard.phases.${phase}`) })),
);
const currentPhase = computed(() => (view.value === null ? null : phaseOf(view.value)));

async function refresh(): Promise<void> {
  try {
    onboarding.value = await api.onboarding();
    loadError.value = null;
  } catch (caught) {
    loadError.value = caught;
    // While a step is on screen, keep it and only report the failure.
    if (onboarding.value !== null) showError(caught);
  }
}

function onCloudflare(result: CloudflareResult) {
  local.pasteNewToken = false;
  missing.value = result.status === 'missing' ? result : null;
  if (result.status === 'connected') {
    toast.success(
      result.accountName
        ? t('wizard.cloudflare.connected', { account: result.accountName })
        : t('wizard.cloudflare.connectedNoName'),
    );
  }
  void refresh();
}

// Back from Stripe Checkout: the subscription arrives through a webhook, so look for it for a while.
const billingReturned = computed(() => route.query.billing === 'success');
const paymentChecks = ref(0);
const confirmingPayment = computed(
  () =>
    billingReturned.value &&
    view.value === 'subscription' &&
    onboarding.value?.billing.subscribed === false &&
    paymentChecks.value < MAX_PAYMENT_CHECKS,
);
const paymentPoller = createPoller(
  async () => {
    paymentChecks.value += 1;
    await refresh();
  },
  () => PAYMENT_POLL_MS,
);
watch(confirmingPayment, (confirming) => (confirming ? paymentPoller.start(false) : paymentPoller.stop()));
// The instance moves past the subscription step once it is active, so say so here.
watch(
  () => onboarding.value?.billing.subscribed,
  (subscribed, before) => {
    if (billingReturned.value && subscribed === true && before !== true) toast.success(t('wizard.subscription.paid'));
  },
);

// A new step: move focus to its heading, so keyboard and screen reader users start there.
watch(view, async (next, previous) => {
  if (previous === null || previous === undefined || next === previous) return;
  await nextTick();
  stepArea.value?.querySelector<HTMLElement>('h2')?.focus();
});

onMounted(refresh);
onBeforeUnmount(() => paymentPoller.stop());
</script>

<style scoped>
.wizard__progress {
  margin-top: 36px;
}

.wizard__step {
  margin-top: 28px;
}

.wizard__loading,
.wizard__error {
  margin-top: 36px;
}

.wizard__skeleton {
  width: 100%;
  height: 320px;
}
</style>
