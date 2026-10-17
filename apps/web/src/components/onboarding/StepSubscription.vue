<template>
  <WizardStep step="subscription" :title="t('wizard.subscription.title')">
    <p class="card-text">{{ org ? t('orgs.setup.subscriptionText') : t('wizard.subscription.text') }}</p>

    <p v-if="confirming" class="notice subscription__notice" role="status">{{ t('wizard.subscription.confirming') }}</p>
    <p
      v-else-if="billingReturned && onboarding.billing.subscribed"
      class="notice notice--success subscription__notice"
      role="status"
    >
      {{ t('wizard.subscription.paid') }}
    </p>
    <p v-else-if="billingReturned" class="notice notice--warn subscription__notice" role="status">
      {{ t('wizard.subscription.notConfirmed') }}
    </p>

    <BohrBox variant="outline" color="orange" class="subscription__plan">
      <span class="subscription__name">{{ t('wizard.subscription.plan') }}</span>
      <span class="subscription__price">{{ t('wizard.subscription.price', { price }) }}</span>
      <ul class="subscription__points">
        <li>{{ t('wizard.subscription.point1') }}</li>
        <li>{{ org ? t('orgs.setup.subscriptionPoint2') : t('wizard.subscription.point2') }}</li>
        <li>{{ t('wizard.subscription.point3') }}</li>
      </ul>
    </BohrBox>

    <p v-if="error !== null" class="field-error" role="alert">{{ error }}</p>

    <div class="actions">
      <BohrButton :disabled="busy || confirming" @click="subscribe">
        {{ busy ? t('common.working') : t('wizard.subscription.subscribe') }}
      </BohrButton>
      <BohrButton v-if="billingReturned && !confirming" variant="ghost" :disabled="busy" @click="emit('refresh')">
        {{ t('wizard.subscription.checkAgain') }}
      </BohrButton>
    </div>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrBox, BohrButton } from '@bohr/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Onboarding } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { CLOUD_PRICE_USD } from '../../lib/billing';
import { formatUsd } from '../../lib/format';
import WizardStep from './WizardStep.vue';

const props = defineProps<{
  onboarding: Pick<Onboarding, 'billing'>;
  /** An organization's slug: its own subscription, paid by an admin. */
  org?: string;
  /** Back from Stripe Checkout (?billing=success). */
  billingReturned: boolean;
  /** Waiting for the subscription to show up after paying. */
  confirming: boolean;
}>();

const emit = defineEmits<{ refresh: [] }>();

const { t, locale } = useI18n();
const errorText = useErrorText();
const busy = ref(false);
const error = ref<string | null>(null);
const price = computed(() => formatUsd(CLOUD_PRICE_USD, locale.value, 0));

async function subscribe() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    if (props.org) {
      // Stripe Checkout brings the admin back to the organization (?billing=success).
      window.location.assign((await api.orgBillingCheckout(props.org)).url);
      return;
    }
    const result = await api.checkSubscription();
    if (result.status === 'payment_required') {
      // Stripe Checkout brings the user back to /start?billing=success.
      window.location.assign(result.checkoutUrl);
      return;
    }
    emit('refresh');
    busy.value = false;
  } catch (caught) {
    error.value = errorText(caught);
    busy.value = false;
  }
}
</script>

<style scoped>
.subscription__notice {
  margin-top: 20px;
}

.subscription__plan {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  margin-top: 24px;
  padding: 20px;
}

.subscription__name {
  font-size: 18px;
  font-weight: 700;
}

.subscription__price {
  font-weight: 700;
  color: var(--bohr-color-amber);
}

.subscription__points {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--bohr-color-text-muted);
}
</style>
