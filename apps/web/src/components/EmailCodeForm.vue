<template>
  <div class="email-code">
    <form v-if="step === 'email'" class="email-code__form" novalidate @submit.prevent="send">
      <p v-if="notice !== null" class="notice notice--warn" role="status">{{ notice }}</p>
      <div class="form-field">
        <BohrTextField
          v-model="email"
          :label="t('emailCode.emailLabel')"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          spellcheck="false"
          :has-error="error !== null"
          :aria-describedby="error !== null ? `${id}-error` : undefined"
        />
      </div>
      <p v-if="error !== null" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>
      <div class="actions">
        <BohrButton type="submit" :variant="variant" :disabled="busy" :full-width="fullWidth">
          {{ busy ? t('emailCode.sending') : submitLabel }}
        </BohrButton>
        <BohrButton v-if="cancelable" variant="text" :disabled="busy" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </BohrButton>
      </div>
    </form>

    <form v-else class="email-code__form" novalidate @submit.prevent="check">
      <p class="email-code__sent" role="status">
        <I18nT keypath="emailCode.sent" scope="global">
          <template #email><strong class="email-code__email">{{ sentTo }}</strong></template>
        </I18nT>
      </p>
      <div>
        <label :for="`${id}-code`" class="field-label">{{ t('emailCode.codeLabel') }}</label>
        <input
          :id="`${id}-code`"
          ref="codeInput"
          :value="code"
          class="control email-code__code"
          type="text"
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          maxlength="12"
          spellcheck="false"
          :aria-invalid="error !== null || undefined"
          :aria-describedby="error !== null ? `${id}-error` : hint ? `${id}-hint` : undefined"
          @input="typed"
        />
        <p v-if="hint" :id="`${id}-hint`" class="field-hint" data-hint="demo">{{ hint }}</p>
      </div>
      <p v-if="error !== null" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>
      <div class="actions">
        <BohrButton type="submit" :variant="variant" :disabled="busy || code.length !== CODE_LENGTH" :full-width="fullWidth">
          {{ busy ? t('emailCode.verifying') : verifyLabel }}
        </BohrButton>
      </div>
      <div class="email-code__links">
        <button type="button" class="email-code__link" :disabled="busy || waiting > 0" data-action="resend" @click="resend">
          {{ waiting > 0 ? t('emailCode.resendIn', { seconds: waiting }) : t('emailCode.resend') }}
        </button>
        <button type="button" class="email-code__link" :disabled="busy" data-action="other-email" @click="otherEmail">
          {{ t('emailCode.otherEmail') }}
        </button>
      </div>
      <p v-if="resent" class="field-hint" role="status">{{ t('emailCode.resent') }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { ApiError } from '../api';
import { useErrorText } from '../composables/useErrorText';

// Signing in (or adding a sign-in) with a code sent by email: the address, then the 6-digit code.
const props = withDefaults(
  defineProps<{
    /** Sends the code; may reject with 400 (invalid address) or 429 (too many tries). */
    start: (email: string) => Promise<unknown>;
    /** Checks the code; may reject with 400 { attemptsLeft }, 410 (expired) or 429. */
    verify: (email: string, code: string) => Promise<void>;
    submitLabel: string;
    verifyLabel: string;
    /** Said for a 409 (the address belongs to another account). */
    conflictMessage?: string;
    /** Shown under the code field (the demo's code). */
    hint?: string;
    variant?: 'default' | 'ghost';
    fullWidth?: boolean;
    cancelable?: boolean;
  }>(),
  { variant: 'default' },
);

const emit = defineEmits<{ cancel: [] }>();

const CODE_LENGTH = 6;
const COOLDOWN_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const { t } = useI18n();
const errorText = useErrorText();
const id = `email-code-${useId()}`;
const codeInput = useTemplateRef<HTMLInputElement>('codeInput');

const step = ref<'email' | 'code'>('email');
const email = ref('');
/** The address the code went to (the field may change meanwhile). */
const sentTo = ref('');
const code = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
/** Why the form is back at the address (the code expired). */
const notice = ref<string | null>(null);
const resent = ref(false);

// "Resend" waits a minute after each code.
const resendAt = ref(0);
const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 1000);
onBeforeUnmount(() => clearInterval(timer));
const waiting = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)));

function failure(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.status === 429) return t('emailCode.rateLimited');
    if (caught.status === 409 && props.conflictMessage) return props.conflictMessage;
  }
  return errorText(caught);
}

async function sendCode(address: string): Promise<boolean> {
  busy.value = true;
  error.value = null;
  try {
    await props.start(address);
    sentTo.value = address;
    now.value = Date.now();
    resendAt.value = now.value + COOLDOWN_SECONDS * 1000;
    return true;
  } catch (caught) {
    error.value = caught instanceof ApiError && caught.status === 400 ? t('emailCode.invalidEmail') : failure(caught);
    return false;
  } finally {
    busy.value = false;
  }
}

async function send() {
  if (busy.value) return;
  const address = email.value.trim();
  if (!EMAIL.test(address)) {
    error.value = t('emailCode.invalidEmail');
    return;
  }
  notice.value = null;
  if (!(await sendCode(address))) return;
  code.value = '';
  resent.value = false;
  step.value = 'code';
  await nextTick();
  codeInput.value?.focus();
}

async function resend() {
  if (busy.value || waiting.value > 0) return;
  resent.value = false;
  if (await sendCode(sentTo.value)) {
    code.value = '';
    resent.value = true;
  }
}

/** Only digits: a pasted "123 456" or "Código: 123456" becomes 123456; the sixth digit sends it. */
function typed(event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
  code.value = digits;
  input.value = digits;
  if (digits.length === CODE_LENGTH) void check();
}

async function check() {
  if (busy.value || code.value.length !== CODE_LENGTH) return;
  busy.value = true;
  error.value = null;
  try {
    await props.verify(sentTo.value, code.value);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 410) {
      backToEmail(t('emailCode.expired'));
      return;
    }
    if (caught instanceof ApiError && caught.status === 400) {
      const left = (caught.body as { attemptsLeft?: unknown } | null)?.attemptsLeft;
      error.value =
        typeof left === 'number' ? t('emailCode.wrongCode', { count: left }) : t('emailCode.wrongCodeNoCount');
    } else {
      error.value = failure(caught);
    }
    code.value = '';
    await nextTick();
    codeInput.value?.focus();
  } finally {
    busy.value = false;
  }
}

function backToEmail(message: string | null) {
  step.value = 'email';
  code.value = '';
  error.value = null;
  resent.value = false;
  notice.value = message;
}

function otherEmail() {
  backToEmail(null);
  email.value = '';
}
</script>

<style scoped>
.email-code__form {
  display: grid;
  gap: 16px;
  text-align: left;
}

.email-code__form .field-error {
  margin-top: -8px;
}

.email-code__sent {
  font-size: 15px;
  line-height: 1.55;
}

.email-code__email {
  overflow-wrap: anywhere;
}

.email-code__code {
  max-width: 220px;
  font-family: var(--bohr-font-family-mono);
  font-size: 24px;
  letter-spacing: 0.35em;
}

.email-code__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.email-code__link {
  padding: 0;
  border: 0;
  font: inherit;
  font-size: 14px;
  color: var(--bohr-color-link);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
  background: none;
  cursor: pointer;
}

.email-code__link:disabled {
  color: var(--bohr-color-text-muted);
  text-decoration: none;
  cursor: default;
}
</style>
