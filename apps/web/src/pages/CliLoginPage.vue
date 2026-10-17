<template>
  <div class="page page--narrow cli-login">
    <BohrPageTitle :title="t('cliLogin.title')" />
    <p class="page-lead">{{ t('cliLogin.lead') }}</p>

    <div class="stack cli-login__cards">
      <SettingsCard v-if="code === null" data-card="enter-code">
        <form class="form" novalidate @submit.prevent="lookUp">
          <div class="form-field">
            <BohrTextField
              v-model="typed"
              :label="t('cliLogin.codeLabel')"
              autocomplete="off"
              spellcheck="false"
              maxlength="12"
              required
              :has-error="typedError !== null"
            />
            <p v-if="typedError !== null" class="field-error" role="alert">{{ typedError }}</p>
            <p v-else class="field-hint">{{ t('cliLogin.codeHint') }}</p>
          </div>
          <div class="actions">
            <BohrButton type="submit">{{ t('cliLogin.continue') }}</BohrButton>
          </div>
        </form>
      </SettingsCard>

      <div v-else-if="login === null && loadError === null" aria-busy="true">
        <BohrSkeleton class="cli-login__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>

      <SettingsCard v-else-if="login === null" data-card="not-found">
        <p class="card-text" role="alert">{{ notFound ? t('cliLogin.notFound') : errorText(loadError) }}</p>
        <div class="actions cli-login__actions">
          <BohrButton variant="ghost" @click="reset">{{ t('cliLogin.otherCode') }}</BohrButton>
        </div>
      </SettingsCard>

      <SettingsCard v-else :data-status="login.status">
        <h2 class="card-title">{{ login.clientName }}</h2>
        <dl class="facts cli-login__facts">
          <div>
            <dt>{{ t('cliLogin.code') }}</dt>
            <dd><code class="inline-code cli-login__code">{{ login.userCode }}</code></dd>
          </div>
          <div>
            <dt>{{ t('cliLogin.requested') }}</dt>
            <dd>{{ formatDateTime(login.createdAt, locale) }}</dd>
          </div>
        </dl>

        <template v-if="login.status === 'pending'">
          <div class="notice notice--warn cli-login__notice" data-notice="check">
            <strong class="notice__title">{{ t('cliLogin.checkTitle') }}</strong>
            <p>{{ t('cliLogin.checkText') }}</p>
          </div>
          <div class="actions cli-login__actions">
            <BohrButton :disabled="answering" @click="answer(true)">{{ t('cliLogin.approve') }}</BohrButton>
            <BohrButton variant="ghost" danger :disabled="answering" @click="answer(false)">
              {{ t('cliLogin.deny') }}
            </BohrButton>
          </div>
        </template>
        <div v-else-if="login.status === 'approved' || login.status === 'done'" class="notice notice--success cli-login__notice" role="status">
          <strong class="notice__title">{{ t('cliLogin.approvedTitle') }}</strong>
          <p>{{ t('cliLogin.approvedText') }}</p>
          <p>
            <RouterLink :to="{ name: 'account-tokens' }" class="text-link">{{ t('cliLogin.manage') }}</RouterLink>
          </p>
        </div>
        <p v-else-if="login.status === 'denied'" class="notice cli-login__notice" role="status">{{ t('cliLogin.deniedText') }}</p>
        <p v-else class="notice notice--warn cli-login__notice" role="status">{{ t('cliLogin.expiredText') }}</p>
      </SettingsCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, BohrSkeleton, BohrTextField, SettingsCard } from '@bohr/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiError, api, type CliLogin } from '../api';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { formatDateTime } from '../lib/format';

// `bohr login` opens /cli?code=XXXX-XXXX: the signed-in person checks the code against their terminal and
// approves the sign-in, which gives the CLI on that computer a token of their own (Account › Tokens).
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const errorText = useErrorText();
const showError = useErrorToast();

const code = computed(() =>
  typeof route.query.code === 'string' && route.query.code !== '' ? route.query.code : null,
);
const login = ref<CliLogin | null>(null);
const loadError = ref<unknown>(null);
const notFound = computed(() => loadError.value instanceof ApiError && loadError.value.status === 404);
const typed = ref('');
const typedError = ref<string | null>(null);
const answering = ref(false);

async function load() {
  login.value = null;
  loadError.value = null;
  if (code.value === null) return;
  try {
    login.value = (await api.cliLogin(code.value)).login;
  } catch (caught) {
    loadError.value = caught;
  }
}

function lookUp() {
  const value = typed.value.trim();
  typedError.value = value === '' ? t('cliLogin.codeRequired') : null;
  if (typedError.value === null) void router.replace({ query: { code: value } });
}

function reset() {
  typed.value = '';
  void router.replace({ query: {} });
}

async function answer(approve: boolean) {
  if (login.value === null) return;
  answering.value = true;
  try {
    login.value = (await api.answerCliLogin(login.value.userCode, approve)).login;
  } catch (error) {
    showError(error);
    await load();
  } finally {
    answering.value = false;
  }
}

watch(code, load);
onMounted(load);
</script>

<style scoped>
.cli-login__cards {
  margin-top: 36px;
}

.cli-login__skeleton {
  width: 100%;
  height: 240px;
}

.cli-login__facts,
.cli-login__notice,
.cli-login__actions {
  margin-top: 16px;
}

.cli-login__code {
  font-size: 18px;
  letter-spacing: 0.08em;
}
</style>
