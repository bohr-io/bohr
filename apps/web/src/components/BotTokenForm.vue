<template>
  <div class="bot-token">
    <ol v-if="withInstructions" class="bot-token__steps">
      <li>
        <I18nT keypath="botToken.step1" scope="global">
          <template #botfather>
            <a href="https://t.me/BotFather" class="text-link" target="_blank" rel="noopener noreferrer">{{
              t('botToken.botfather')
            }}</a>
          </template>
          <template #command><code class="inline-code">/newbot</code></template>
        </I18nT>
      </li>
      <li>{{ t('botToken.step2') }}</li>
      <li>{{ t('botToken.step3') }}</li>
    </ol>

    <form class="form" novalidate @submit.prevent="connect">
      <div class="form-field">
        <BohrTextField
          ref="field"
          v-model="token"
          type="password"
          :label="t('botToken.label')"
          :placeholder="t('botToken.placeholder')"
          :toggle-label="t('common.toggleVisibility')"
          :has-error="error !== null"
          autocomplete="off"
          spellcheck="false"
          required
          :aria-describedby="error !== null ? `${id}-error` : undefined"
        />
        <p v-if="error !== null" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>
      </div>
      <div class="actions">
        <BohrButton type="submit" :variant="primary ? 'default' : 'ghost'" :disabled="connecting">
          {{ connecting ? t('botToken.connecting') : t('botToken.connect') }}
        </BohrButton>
        <slot name="actions" />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField } from '@bohr/ui';
import { nextTick, ref, useId, useTemplateRef } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { ApiError, api } from '../api';
import { useErrorText } from '../composables/useErrorText';
import { BOT_TOKEN_PATTERN } from '../lib/validation';

const props = defineProps<{
  projectId: string;
  /** How to get a token from BotFather, above the field. */
  withInstructions?: boolean;
  /** Filled submit button (otherwise outlined). */
  primary?: boolean;
}>();

const emit = defineEmits<{ connected: [username: string] }>();

const { t } = useI18n();
const errorText = useErrorText();
const id = `bot-token-${useId()}`;
const field = useTemplateRef<{ focus: () => void }>('field');
const token = ref('');
const connecting = ref(false);
const error = ref<string | null>(null);

async function fail(message: string) {
  error.value = message;
  await nextTick();
  field.value?.focus();
}

async function connect() {
  const value = token.value.trim();
  error.value = null;
  if (!BOT_TOKEN_PATTERN.test(value)) {
    await fail(t('botToken.invalidFormat'));
    return;
  }
  connecting.value = true;
  try {
    // The instance points the bot's webhook at the project Worker and stores the token there.
    const { username } = await api.connectTelegramBot(props.projectId, value);
    token.value = '';
    emit('connected', username);
  } catch (caught) {
    await fail(caught instanceof ApiError && caught.status === 400 ? t('botToken.rejected') : errorText(caught));
  } finally {
    connecting.value = false;
  }
}
</script>

<style scoped>
.bot-token__steps {
  display: grid;
  gap: 10px;
  margin: 12px 0 0;
  padding-left: 22px;
  line-height: 1.55;
}

.bot-token__steps li::marker {
  font-weight: 700;
  color: var(--bohr-color-amber);
}
</style>
