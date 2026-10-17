<template>
  <div class="page page--narrow billing">
    <BohrPageTitle :title="t('billing.title')" />
    <p class="page-lead">{{ t(subscription?.legacy ? 'billing.leadLegacy' : 'billing.lead', { price }) }}</p>

    <div v-if="loading" class="billing__body" aria-busy="true">
      <BohrSkeleton class="billing__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <SettingsCard v-else-if="unavailable" class="billing__body">
      <p class="card-text">{{ t('billing.unavailable') }}</p>
    </SettingsCard>

    <ErrorState v-else-if="error !== null" class="billing__body" :message="errorText(error)" @retry="load" />

    <div v-else class="billing__body stack">
      <p v-if="confirming" class="notice" role="status">{{ t('billing.confirming') }}</p>
      <p v-else-if="returned && active" class="notice notice--success" role="status">{{ t('billing.paid') }}</p>

      <SettingsCard>
        <h2 class="billing__title">{{ t('billing.subscription') }}</h2>
        <dl v-if="subscription !== null" class="facts billing__facts">
          <div>
            <dt>{{ t('billing.status') }}</dt>
            <dd class="billing__status">
              <StatusIndicator :status="subscriptionIndicator(subscription.status)" :label="statusLabel" />
              <span aria-hidden="true">{{ statusLabel }}</span>
            </dd>
          </div>
          <div v-if="subscription.currentPeriodEnd">
            <dt>{{ active ? t('billing.renews') : t('billing.ended') }}</dt>
            <dd>{{ formatDateTime(subscription.currentPeriodEnd, locale) }}</dd>
          </div>
          <div v-if="subscription.legacy">
            <dt>{{ t('billing.plan') }}</dt>
            <dd>{{ t('billing.legacy') }}</dd>
          </div>
        </dl>
        <p v-else class="card-text">{{ t('billing.none') }}</p>

        <div class="actions billing__actions">
          <BohrButton v-if="!active" :disabled="busy || confirming" @click="go(api.billingCheckout)">
            {{ t('billing.subscribe') }}
          </BohrButton>
          <BohrButton v-if="subscription !== null" variant="ghost" :disabled="busy" @click="go(api.billingPortal)">
            {{ t('billing.manage') }}
          </BohrButton>
          <BohrButton :as="RouterLink" to="/projects" variant="text">{{ t('billing.back') }}</BohrButton>
        </div>
      </SettingsCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, BohrSkeleton, SettingsCard, StatusIndicator } from '@bohr/ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { ApiError, api, type Billing } from '../api';
import ErrorState from '../components/ErrorState.vue';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { CLOUD_PRICE_USD, isActiveSubscription, isKnownStatus, subscriptionIndicator } from '../lib/billing';
import { formatDateTime, formatUsd } from '../lib/format';
import { createPoller } from '../lib/poller';

/** After Stripe Checkout: how often, and how many times, to look for the subscription. */
const CONFIRM_POLL_MS = 3_000;
const MAX_CONFIRM_CHECKS = 20;

const { t, locale } = useI18n();
const route = useRoute();
const errorText = useErrorText();
const showError = useErrorToast();

const billing = ref<Billing | null>(null);
const loading = ref(true);
const unavailable = ref(false);
const error = ref<unknown>(null);
const busy = ref(false);
const checks = ref(0);

const price = computed(() => formatUsd(CLOUD_PRICE_USD, locale.value, 0));
const subscription = computed(() => billing.value?.subscription ?? null);
const active = computed(() => isActiveSubscription(subscription.value?.status));
const statusLabel = computed(() => {
  const status = subscription.value?.status ?? '';
  return isKnownStatus(status) ? t(`billing.statuses.${status}`) : status;
});
/** Stripe Checkout brings the user back with ?billing=success; the subscription arrives by webhook. */
const returned = computed(() => route.query.billing === 'success');
const confirming = computed(() => returned.value && !active.value && checks.value < MAX_CONFIRM_CHECKS);

async function load() {
  error.value = null;
  try {
    billing.value = await api.billing();
  } catch (caught) {
    // 404: this instance does not charge (self-hosted).
    if (caught instanceof ApiError && caught.status === 404) unavailable.value = true;
    else error.value = caught;
  } finally {
    loading.value = false;
  }
}

const poller = createPoller(
  async () => {
    checks.value += 1;
    billing.value = await api.billing();
  },
  () => CONFIRM_POLL_MS,
);
watch(confirming, (on) => (on && !loading.value ? poller.start(false) : poller.stop()));

/** Checkout and the customer portal are Stripe pages; the instance hands out their URL. */
async function go(open: () => Promise<{ url: string }>) {
  busy.value = true;
  try {
    window.location.assign((await open()).url);
  } catch (caught) {
    showError(caught);
    busy.value = false;
  }
}

onMounted(async () => {
  await load();
  // The page just read the subscription; look again after a while.
  if (confirming.value) poller.start(false);
});
onBeforeUnmount(() => poller.stop());
</script>

<style scoped>
.billing__body {
  margin-top: 32px;
}

.billing__skeleton {
  width: 100%;
  height: 220px;
}

.billing__title {
  font-size: 18px;
}

.billing__facts {
  margin-top: 16px;
}

.billing__status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.billing__actions {
  margin-top: 24px;
}
</style>
