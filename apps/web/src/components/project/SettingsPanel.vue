<template>
  <section class="settings">
    <!-- The agent -->
    <SettingsCard>
      <h3 class="settings__title">{{ t('settings.agentTitle') }}</h3>
      <p class="card-text">
        {{ project.project.agentEnabled ? t('settings.agentOn') : t('settings.agentOff') }}
      </p>

      <form v-if="isOwner" class="form" novalidate @submit.prevent="save">
        <div class="settings__grid">
          <div class="form-field">
            <BohrTextField
              v-model="model"
              :label="t('settings.model')"
              :list="`${id}-models`"
              autocomplete="off"
              spellcheck="false"
              maxlength="100"
              required
              :aria-describedby="`${id}-model-hint`"
            />
            <datalist :id="`${id}-models`">
              <option v-for="suggestion in MODEL_SUGGESTIONS" :key="suggestion" :value="suggestion" />
            </datalist>
            <p :id="`${id}-model-hint`" class="field-hint">{{ t('settings.modelHint') }}</p>
          </div>
          <div class="form-field">
            <label :for="`${id}-locale`" class="field-label">{{ t('settings.locale') }}</label>
            <select :id="`${id}-locale`" v-model="agentLocale" class="control">
              <option v-for="option in LOCALES" :key="option.code" :value="option.code" :lang="option.code">
                {{ option.name }}
              </option>
            </select>
            <p class="field-hint">{{ t('settings.localeHint') }}</p>
          </div>
          <div class="form-field">
            <BohrTextField
              v-model="budget"
              type="number"
              :label="t('settings.budget')"
              :min="MIN_BUDGET_USD"
              :max="MAX_BUDGET_USD"
              step="0.1"
              inputmode="decimal"
              required
              :has-error="errors.budget"
              :aria-describedby="`${id}-budget-hint`"
            />
            <p :id="`${id}-budget-hint`" class="field-hint" :class="{ 'field-error': errors.budget }">
              {{ t('settings.budgetHint', { current: formatUsd(project.settings.maxBudgetUsd, locale) }) }}
            </p>
          </div>
          <div class="form-field">
            <BohrTextField
              v-model="turns"
              type="number"
              :label="t('settings.turns')"
              min="1"
              max="1000"
              step="1"
              inputmode="numeric"
              required
              :has-error="errors.turns"
              :aria-describedby="`${id}-turns-hint`"
            />
            <p :id="`${id}-turns-hint`" class="field-hint" :class="{ 'field-error': errors.turns }">
              {{ t('settings.turnsHint') }}
            </p>
          </div>
        </div>
        <p v-if="errors.model" class="field-error" role="alert">{{ t('settings.modelRequired') }}</p>
        <div class="actions">
          <BohrButton type="submit" :disabled="saving">{{ saving ? t('common.saving') : t('common.save') }}</BohrButton>
        </div>
      </form>

      <dl v-else class="facts settings__facts">
        <div>
          <dt>{{ t('settings.model') }}</dt>
          <dd>{{ project.settings.model }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.budget') }}</dt>
          <dd>{{ formatUsd(project.settings.maxBudgetUsd, locale) }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.turns') }}</dt>
          <dd>{{ project.settings.maxTurns }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.locale') }}</dt>
          <dd>{{ localeName(project.settings.locale) }}</dd>
        </div>
      </dl>
      <p v-if="!isOwner" class="field-hint">{{ t('settings.ownerOnly') }}</p>
    </SettingsCard>

    <!-- The provider and its key: in the account settings, for every project of the owner -->
    <SettingsCard v-if="isOwner" data-card="provider">
      <h3 class="settings__title">{{ t('settings.providerTitle') }}</h3>
      <p class="card-text">{{ t('settings.providerText') }}</p>
      <div class="actions settings__telegram">
        <BohrButton :as="RouterLink" :to="{ name: 'account-agent' }" :variant="project.project.agentEnabled ? 'ghost' : 'default'">
          {{ t('settings.providerLink') }}
        </BohrButton>
      </div>
    </SettingsCard>

    <!-- Telegram -->
    <SettingsCard>
      <h3 class="settings__title">{{ t('settings.telegramTitle') }}</h3>
      <template v-if="botUsername">
        <p class="card-text">
          <I18nT keypath="settings.telegramBot" scope="global">
            <template #bot>
              <strong>{{ `@${botUsername}` }}</strong>
            </template>
          </I18nT>
        </p>
        <div class="actions settings__telegram">
          <BohrButton :href="botUrl(botUsername)" target="_blank" rel="noopener noreferrer">
            <template #iconLeft><NewWindowIcon :size="12" /></template>
            {{ t('settings.openBot') }}
          </BohrButton>
        </div>
      </template>
      <template v-else-if="isOwner">
        <p class="card-text">{{ t('settings.telegramNone') }}</p>
        <BotTokenForm :project-id="projectId" with-instructions primary @connected="botConnected" />
      </template>
      <p v-else class="card-text">{{ t('settings.telegramNoneMember') }}</p>
    </SettingsCard>
  </section>
</template>

<script setup lang="ts">
import { MAX_BUDGET_USD, MIN_BUDGET_USD, type ProjectState } from '@bohr/shared';
import { BohrButton, BohrTextField, NewWindowIcon, SettingsCard, useToast } from '@bohr/ui';
import { computed, reactive, ref, useId } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { SettingsPatch } from '../../api';
import type { ChatFeed } from '../../chat/feed';
import { useErrorToast } from '../../composables/useErrorText';
import { isLocaleCode, LOCALES, type LocaleCode } from '../../i18n/locales';
import { formatUsd } from '../../lib/format';
import { botUrl } from '../../lib/telegram';
import BotTokenForm from '../BotTokenForm.vue';

/** Suggestions only; any model name the agent accepts can be typed. */
const MODEL_SUGGESTIONS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];

const props = defineProps<{
  feed: ChatFeed;
  project: ProjectState;
  projectId: string;
  botUsername: string | null;
}>();

const emit = defineEmits<{ updated: [] }>();

const { t, locale } = useI18n();
const toast = useToast();
const showError = useErrorToast();
const id = `settings-${useId()}`;
const isOwner = computed(() => props.project.you.role === 'owner');

// The form starts from the saved settings.
const model = ref(props.project.settings.model);
const budget = ref<string | number>(props.project.settings.maxBudgetUsd);
const turns = ref<string | number>(props.project.settings.maxTurns);
const agentLocale = ref<LocaleCode>(props.project.settings.locale);
const errors = reactive({ model: false, budget: false, turns: false });
const saving = ref(false);

function localeName(code: string) {
  return LOCALES.find((option) => option.code === code)?.name ?? code;
}

async function save() {
  const settings = props.project.settings;
  const nextModel = model.value.trim();
  const nextBudget = Number(budget.value);
  const nextTurns = Number(turns.value);
  errors.model = nextModel.length === 0;
  errors.budget = !Number.isFinite(nextBudget) || nextBudget < MIN_BUDGET_USD || nextBudget > MAX_BUDGET_USD;
  errors.turns = !Number.isInteger(nextTurns) || nextTurns < 1 || nextTurns > 1000;
  if (errors.model || errors.budget || errors.turns) return;

  const patch: SettingsPatch = {};
  if (nextModel !== settings.model) patch.model = nextModel;
  if (nextBudget !== settings.maxBudgetUsd) patch.maxBudgetUsd = nextBudget;
  if (nextTurns !== settings.maxTurns) patch.maxTurns = nextTurns;
  if (agentLocale.value !== settings.locale && isLocaleCode(agentLocale.value)) patch.locale = agentLocale.value;
  if (Object.keys(patch).length === 0) {
    toast.tip(t('settings.unchanged'));
    return;
  }

  saving.value = true;
  try {
    await props.feed.api.updateSettings(patch);
    toast.success(t('settings.saved'));
    await props.feed.refresh();
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

function botConnected(username: string) {
  toast.success(t('settings.botConnected', { bot: `@${username}` }));
  emit('updated');
}
</script>

<style scoped>
.settings {
  display: grid;
  gap: 24px;
}

.settings :deep(.bohr-settings-card__content) {
  padding: clamp(20px, 3vw, 32px);
}

.settings__title {
  font-size: 18px;
}

.settings__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 20px;
}

.settings__facts {
  margin-top: 16px;
}

.settings__telegram {
  margin-top: 16px;
}
</style>
