<template>
  <form class="form agent-form" novalidate @submit.prevent="save">
    <fieldset class="agent-form__providers">
      <legend class="field-label">{{ t('agentSettings.provider') }}</legend>
      <div class="agent-form__options">
        <label v-for="option in PROVIDERS" :key="option" class="agent-form__option" :data-provider="option">
          <input v-model="provider" type="radio" name="provider" :value="option" class="agent-form__radio" />
          <span class="agent-form__option-name">{{ t(`agentSettings.providers.${option}.name`) }}</span>
          <span class="agent-form__option-text">{{ t(`agentSettings.providers.${option}.text`) }}</span>
        </label>
      </div>
    </fieldset>

    <!-- The Claude subscription: the official Claude Code runs `claude setup-token` in one of the user's project
         containers; the user authorizes at the link it prints and pastes the code claude.ai shows -->
    <section v-if="provider === 'subscription'" class="agent-form__subscription" data-subscription>
      <p class="notice" data-notice="subscription">{{ t('agentSettings.subscription.notice') }}</p>
      <p v-if="keepsKey && login === null" class="agent-form__connected" data-connected>
        {{ t('agentSettings.subscription.connected', { hint: settings.keyHint ?? '' }) }}
      </p>

      <div v-if="login !== null" class="agent-form__login" data-login>
        <p class="card-text">{{ t('agentSettings.subscription.steps') }}</p>
        <ol class="agent-form__steps">
          <li>
            {{ t('agentSettings.subscription.step1') }}
            <a :href="login.url" class="text-link" target="_blank" rel="noopener noreferrer" data-authorize>{{ t('agentSettings.subscription.open') }}</a>
          </li>
          <li>{{ t('agentSettings.subscription.step2') }}</li>
        </ol>
        <div class="form-field">
          <BohrTextField
            ref="codeField"
            v-model="code"
            :label="t('agentSettings.subscription.code')"
            autocomplete="off"
            spellcheck="false"
            maxlength="512"
            required
            :has-error="errors.code !== null"
            :aria-describedby="errors.code !== null ? `${id}-code-error` : undefined"
          />
          <p v-if="errors.code !== null" :id="`${id}-code-error`" class="field-error" role="alert">{{ errors.code }}</p>
        </div>
        <div class="actions">
          <BohrButton type="button" :disabled="finishing" @click="finishLogin">
            {{ finishing ? t('agentSettings.subscription.finishing') : t('agentSettings.subscription.finish') }}
          </BohrButton>
          <BohrButton type="button" variant="ghost" :disabled="finishing" @click="cancelLogin">
            {{ t('agentSettings.subscription.cancel') }}
          </BohrButton>
        </div>
      </div>
      <div v-else class="actions">
        <BohrButton type="button" :disabled="starting || saving || removing" @click="startLogin">
          {{
            starting
              ? t('agentSettings.subscription.starting')
              : keepsKey
                ? t('agentSettings.subscription.reconnect')
                : t('agentSettings.subscription.connect')
          }}
        </BohrButton>
      </div>
      <p v-if="loginError !== null" class="notice notice--error" role="alert" data-login-error>{{ loginError }}</p>
      <p v-if="noRuntime" class="notice notice--warn" role="status" data-no-runtime>{{ org ? t('orgs.agent.noRuntime') : t('agentSettings.subscription.noRuntime') }}</p>

      <details class="agent-form__fallback" :open="fallbackOpen" data-fallback @toggle="onFallbackToggle">
        <summary class="agent-form__fallback-summary">{{ t('agentSettings.subscription.fallback') }}</summary>
        <p class="field-hint">
          <I18nT keypath="agentSettings.subscription.fallbackText" scope="global">
            <template #command><code>claude setup-token</code></template>
          </I18nT>
        </p>
        <div class="form-field">
          <BohrTextField
            ref="tokenField"
            v-model="apiKey"
            type="password"
            :label="t('agentSettings.subscription.token')"
            :placeholder="keepsKey ? (settings.keyHint ?? '') : 'sk-ant-oat01-…'"
            :toggle-label="t('common.toggleVisibility')"
            :has-error="errors.apiKey !== null"
            autocomplete="off"
            spellcheck="false"
            maxlength="500"
            :aria-describedby="describedBy('token', errors.apiKey)"
          />
          <p v-if="errors.apiKey !== null" :id="`${id}-token-error`" class="field-error" role="alert">{{ errors.apiKey }}</p>
          <p :id="`${id}-token-hint`" class="field-hint">
            {{
              keepsKey
                ? t('agentSettings.subscription.tokenKept', { hint: settings.keyHint ?? '' })
                : t('agentSettings.subscription.tokenHint')
            }}
          </p>
        </div>
      </details>
    </section>

    <div v-else class="form-field">
      <BohrTextField
        ref="keyField"
        v-model="apiKey"
        type="password"
        :label="provider === 'anthropic' ? t('agentSettings.keyAnthropic') : t('agentSettings.keyCompatible')"
        :placeholder="keepsKey ? (settings.keyHint ?? '') : provider === 'anthropic' ? 'sk-ant-…' : ''"
        :toggle-label="t('common.toggleVisibility')"
        :has-error="errors.apiKey !== null"
        :required="!keepsKey"
        autocomplete="off"
        spellcheck="false"
        maxlength="500"
        :aria-describedby="describedBy('key', errors.apiKey)"
      />
      <p v-if="errors.apiKey !== null" :id="`${id}-key-error`" class="field-error" role="alert">{{ errors.apiKey }}</p>
      <p :id="`${id}-key-hint`" class="field-hint">
        <template v-if="keepsKey">{{ t('agentSettings.keyKept', { hint: settings.keyHint ?? '' }) }}</template>
        <I18nT v-else-if="provider === 'anthropic'" keypath="agentSettings.keyAnthropicHint" scope="global">
          <template #console>
            <a href="https://console.anthropic.com/settings/keys" class="text-link" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>
          </template>
        </I18nT>
        <template v-else>{{ t('agentSettings.keyCompatibleHint') }}</template>
      </p>
    </div>

    <div v-if="provider === 'compatible'" class="form-field">
      <BohrTextField
        ref="baseUrlField"
        v-model="baseUrl"
        :label="t('agentSettings.baseUrl')"
        placeholder="https://openrouter.ai/api"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        maxlength="500"
        required
        :has-error="errors.baseUrl !== null"
        :aria-describedby="describedBy('base-url', errors.baseUrl)"
      />
      <p v-if="errors.baseUrl !== null" :id="`${id}-base-url-error`" class="field-error" role="alert">{{ errors.baseUrl }}</p>
      <p :id="`${id}-base-url-hint`" class="field-hint">{{ t('agentSettings.baseUrlHint') }}</p>
    </div>

    <div class="agent-form__grid">
      <div class="form-field">
        <BohrTextField
          ref="modelField"
          v-model="model"
          :label="t('agentSettings.model')"
          :placeholder="claudeModels ? DEFAULT_MODEL : ''"
          :list="claudeModels ? `${id}-models` : undefined"
          autocomplete="off"
          spellcheck="false"
          maxlength="100"
          :required="provider === 'compatible'"
          :has-error="errors.model !== null"
          :aria-describedby="describedBy('model', errors.model)"
        />
        <datalist :id="`${id}-models`">
          <option v-for="suggestion in MODEL_SUGGESTIONS" :key="suggestion" :value="suggestion" />
        </datalist>
        <p v-if="errors.model !== null" :id="`${id}-model-error`" class="field-error" role="alert">{{ errors.model }}</p>
        <p :id="`${id}-model-hint`" class="field-hint">
          {{
            claudeModels
              ? t('agentSettings.modelAnthropicHint', { model: DEFAULT_MODEL })
              : t('agentSettings.modelCompatibleHint')
          }}
        </p>
      </div>

      <div class="form-field">
        <label :for="`${id}-effort`" class="field-label">{{ t('agentSettings.effort') }}</label>
        <select :id="`${id}-effort`" v-model="effort" class="control" :aria-describedby="`${id}-effort-hint`">
          <option value="">{{ t('agentSettings.efforts.default') }}</option>
          <option v-for="level in EFFORTS" :key="level" :value="level">{{ t(`agentSettings.efforts.${level}`) }}</option>
        </select>
        <p :id="`${id}-effort-hint`" class="field-hint">
          {{ t('agentSettings.effortHint') }}
          <template v-if="provider === 'compatible'">{{ t('agentSettings.effortCompatible') }}</template>
        </p>
      </div>
    </div>

    <p v-if="formError !== null" class="notice notice--error" role="alert">{{ formError }}</p>

    <div v-if="result !== null" class="notice" :class="result.failed > 0 ? 'notice--warn' : 'notice--success'" role="status" data-result>
      <p>{{ t(org ? 'orgs.agent.applied' : 'agentSettings.applied', { count: result.applied }, result.applied) }}</p>
      <p v-if="result.failed > 0">{{ t('agentSettings.failed', { count: result.failed }, result.failed) }}</p>
    </div>

    <div class="actions">
      <BohrButton type="submit" :disabled="saving || removing">
        {{ saving ? t('agentSettings.saving') : t('common.save') }}
      </BohrButton>
      <BohrButton v-if="settings.configured" variant="ghost" danger :disabled="saving || removing" @click="confirmRemove = true">
        {{ t('agentSettings.remove') }}
      </BohrButton>
    </div>

    <ConfirmDialog
      :open="confirmRemove"
      :title="t('agentSettings.removeTitle')"
      :confirm-label="t('agentSettings.removeConfirm')"
      danger
      :busy="removing"
      @confirm="remove"
      @cancel="confirmRemove = false"
    >
      <p>{{ org ? t('orgs.agent.removeText') : t('agentSettings.removeText') }}</p>
    </ConfirmDialog>
  </form>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField, useToast } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, useTemplateRef, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import {
  type AgentEffort,
  type AgentProvider,
  type AgentSettings,
  type AgentSettingsInput,
  ApiError,
  api,
  type SubscriptionFinish,
  type SubscriptionLogin,
} from '../api';
import { useErrorText } from '../composables/useErrorText';
import { ANTHROPIC_KEY_PATTERN, CLAUDE_CODE_PATTERN, CLAUDE_TOKEN_PATTERN } from '../lib/validation';
import ConfirmDialog from './ConfirmDialog.vue';

// The agent's provider, key, model and effort: one setting per user, applied to every project they own, or one
// per organization, applied to every project of the organization.
const PROVIDERS: AgentProvider[] = ['anthropic', 'compatible', 'subscription'];
const EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'claude-opus-5-5';
/** Suggestions only; any model name the provider accepts can be typed. */
const MODEL_SUGGESTIONS = [DEFAULT_MODEL, 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const props = defineProps<{
  settings: AgentSettings;
  /** An organization's slug: its settings, applied to every project of the organization (admins only). */
  org?: string;
}>();
const emit = defineEmits<{ 'update:settings': [settings: AgentSettings] }>();

const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const id = `agent-${useId()}`;
const keyField = useTemplateRef<{ focus: () => void }>('keyField');
const baseUrlField = useTemplateRef<{ focus: () => void }>('baseUrlField');
const modelField = useTemplateRef<{ focus: () => void }>('modelField');
const tokenField = useTemplateRef<{ focus: () => void }>('tokenField');
const codeField = useTemplateRef<{ focus: () => void }>('codeField');

const provider = ref<AgentProvider>('anthropic');
const apiKey = ref('');
const baseUrl = ref('');
const model = ref('');
const effort = ref<AgentEffort | ''>('');
const errors = reactive<{ apiKey: string | null; baseUrl: string | null; model: string | null; code: string | null }>({
  apiKey: null,
  baseUrl: null,
  model: null,
  code: null,
});
const formError = ref<string | null>(null);
const result = ref<{ applied: number; failed: number } | null>(null);
const saving = ref(false);
const removing = ref(false);
const confirmRemove = ref(false);

/** The calls for the user's settings or the organization's. */
const client = computed(() => {
  const slug = props.org;
  if (slug === undefined) {
    return {
      save: api.saveAgentSettings,
      remove: api.removeAgentSettings,
      start: api.startSubscription,
      finish: api.finishSubscription,
      cancel: api.cancelSubscription,
    };
  }
  return {
    save: (input: AgentSettingsInput) => api.saveOrgAgentSettings(slug, input),
    remove: () => api.removeOrgAgentSettings(slug),
    start: () => api.startOrgSubscription(slug),
    finish: (input: SubscriptionFinish) => api.finishOrgSubscription(slug, input),
    cancel: (input: { projectId: string | null; loginId: string }) => api.cancelOrgSubscription(slug, input),
  };
});

/** A blank key keeps the stored one, but only for the provider it belongs to. */
const keepsKey = computed(() => props.settings.configured && props.settings.provider === provider.value);
/** Anthropic's models: with an API key or a Claude subscription. */
const claudeModels = computed(() => provider.value !== 'compatible');

// Connecting a Claude subscription: the sign-in in progress, the code the user pastes, and what went wrong
const login = ref<SubscriptionLogin | null>(null);
const code = ref('');
const starting = ref(false);
const finishing = ref(false);
const loginError = ref<string | null>(null);
const noRuntime = ref(false);
const fallbackOpen = ref(false);

function fill(settings: AgentSettings) {
  provider.value = settings.provider ?? 'anthropic';
  apiKey.value = '';
  baseUrl.value = settings.baseUrl ?? '';
  model.value = settings.model ?? '';
  effort.value = settings.effort ?? '';
}
fill(props.settings);

function describedBy(field: string, error: string | null) {
  return error !== null ? `${id}-${field}-error ${id}-${field}-hint` : `${id}-${field}-hint`;
}

function validate(): boolean {
  const key = apiKey.value.trim();
  errors.apiKey = null;
  errors.baseUrl = null;
  errors.model = null;
  if (provider.value === 'subscription') {
    if (key === '' && !keepsKey.value) errors.apiKey = t('agentSettings.errors.tokenRequired');
    else if (key !== '' && !CLAUDE_TOKEN_PATTERN.test(key)) errors.apiKey = t('agentSettings.errors.claudeToken');
  } else if (key === '' && !keepsKey.value) errors.apiKey = t('agentSettings.errors.keyRequired');
  else if (key !== '' && provider.value === 'anthropic' && !ANTHROPIC_KEY_PATTERN.test(key)) {
    errors.apiKey = t('agentSettings.errors.anthropicKey');
  }
  if (provider.value === 'compatible') {
    if (!/^https:\/\/[^\s/?#]+[^\s?#]*$/.test(baseUrl.value.trim())) errors.baseUrl = t('agentSettings.errors.baseUrl');
    if (model.value.trim() === '') errors.model = t('agentSettings.errors.modelRequired');
  }
  if (/\s/.test(model.value.trim())) errors.model = t('agentSettings.errors.modelSpaces');
  return errors.apiKey === null && errors.baseUrl === null && errors.model === null;
}

async function focusFirstError() {
  if (errors.apiKey !== null && provider.value === 'subscription') fallbackOpen.value = true;
  await nextTick();
  if (errors.apiKey !== null) (provider.value === 'subscription' ? tokenField : keyField).value?.focus();
  else if (errors.baseUrl !== null) baseUrlField.value?.focus();
  else if (errors.model !== null) modelField.value?.focus();
}

async function save() {
  // Enter in the code field finishes the sign-in instead of saving
  if (provider.value === 'subscription' && login.value !== null) {
    await finishLogin();
    return;
  }
  formError.value = null;
  result.value = null;
  if (!validate()) {
    await focusFirstError();
    return;
  }
  const input: AgentSettingsInput = {
    provider: provider.value,
    apiKey: apiKey.value.trim() || undefined,
    baseUrl: provider.value === 'compatible' ? baseUrl.value.trim() : null,
    model: model.value.trim() || null,
    effort: effort.value || null,
  };
  saving.value = true;
  try {
    // The instance checks the key with the provider, then gives it to every project the user owns.
    const { agent, projects } = await client.value.save(input);
    result.value = projects;
    emit('update:settings', agent);
    fill(agent);
    toast.success(t('agentSettings.saved'));
  } catch (caught) {
    formError.value = errorText(caught);
  } finally {
    saving.value = false;
  }
}

/** The instance's error code ("no_runtime"…), next to its sentence. */
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) return undefined;
  const value = (error.body as Record<string, unknown>).code;
  return typeof value === 'string' ? value : undefined;
}

async function startLogin() {
  loginError.value = null;
  noRuntime.value = false;
  formError.value = null;
  result.value = null;
  starting.value = true;
  try {
    // The instance starts `claude setup-token` in its sign-in container (or in one of the owner's projects)
    login.value = await client.value.start();
    code.value = '';
    errors.code = null;
  } catch (caught) {
    // Only instances without the sign-in container need a project for this
    if (errorCode(caught) === 'no_runtime') {
      noRuntime.value = true;
      fallbackOpen.value = true;
    } else {
      loginError.value = errorText(caught);
    }
  } finally {
    starting.value = false;
  }
}

async function finishLogin() {
  const current = login.value;
  if (current === null) return;
  loginError.value = null;
  errors.code = null;
  errors.model = null;
  const value = code.value.trim();
  if (!CLAUDE_CODE_PATTERN.test(value)) errors.code = t('agentSettings.errors.code');
  if (/\s/.test(model.value.trim())) errors.model = t('agentSettings.errors.modelSpaces');
  if (errors.code !== null || errors.model !== null) {
    await nextTick();
    (errors.code !== null ? codeField : modelField).value?.focus();
    return;
  }
  finishing.value = true;
  try {
    // The CLI turns the code into its long-lived token; the instance keeps it and applies it to every project
    const { agent, projects } = await client.value.finish({
      projectId: current.projectId,
      loginId: current.loginId,
      code: value,
      model: model.value.trim() || null,
      effort: effort.value || null,
    });
    login.value = null;
    code.value = '';
    result.value = projects;
    emit('update:settings', agent);
    fill(agent);
    toast.success(t('agentSettings.subscription.done'));
  } catch (caught) {
    loginError.value = errorText(caught);
    // A refused code, an expired sign-in or a timeout ends it: the next try starts over
    if (caught instanceof ApiError && [404, 422, 504].includes(caught.status)) login.value = null;
  } finally {
    finishing.value = false;
  }
}

function abandonLogin() {
  const current = login.value;
  login.value = null;
  code.value = '';
  errors.code = null;
  if (current !== null) {
    void client.value.cancel({ projectId: current.projectId, loginId: current.loginId }).catch(() => {});
  }
}

function cancelLogin() {
  loginError.value = null;
  abandonLogin();
}

function onFallbackToggle(event: Event) {
  fallbackOpen.value = (event.target as HTMLDetailsElement).open;
}

// A sign-in left behind would keep the container's single slot busy until it expires
watch(provider, (value) => {
  if (value !== 'subscription') abandonLogin();
});
onBeforeUnmount(abandonLogin);

async function remove() {
  removing.value = true;
  try {
    const { agent } = await client.value.remove();
    emit('update:settings', agent);
    fill(agent);
    result.value = null;
    formError.value = null;
    confirmRemove.value = false;
    toast.success(t('agentSettings.removed'));
  } catch (caught) {
    formError.value = errorText(caught);
    confirmRemove.value = false;
  } finally {
    removing.value = false;
  }
}
</script>

<style scoped>
.agent-form__providers {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.agent-form__options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 10px;
}

.agent-form__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: start;
  align-items: center;
  gap: 4px 12px;
  padding: 14px 16px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.agent-form__option:hover,
.agent-form__option:has(:checked) {
  border-color: var(--bohr-color-frame);
}

.agent-form__option:has(:checked) {
  background: hsl(var(--bohr-hsl-orange) / 0.08);
}

.agent-form__radio {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.agent-form__option-name {
  font-weight: 700;
}

.agent-form__option-text {
  grid-column: 2;
  font-size: 13px;
  line-height: 1.5;
  color: var(--bohr-color-text-muted);
}

.agent-form__subscription {
  display: grid;
  gap: 16px;
}

.agent-form__connected {
  margin: 0;
  font-weight: 700;
}

.agent-form__login {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--bohr-color-frame);
  border-radius: var(--bohr-radius-md);
}

.agent-form__steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  line-height: 1.5;
}

.agent-form__fallback-summary {
  cursor: pointer;
  font-weight: 700;
}

.agent-form__fallback[open] > .agent-form__fallback-summary {
  margin-bottom: 12px;
}

.agent-form__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 20px;
}
</style>
