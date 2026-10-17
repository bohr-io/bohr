<template>
  <div class="page page--narrow account-agent">
    <RouterLink :to="{ name: 'account' }" class="account-agent__back">
      <ArrowIcon direction="left" :size="9" />
      <span>{{ t('agentSettings.back') }}</span>
    </RouterLink>
    <BohrPageTitle :title="t('agentSettings.title')" />
    <p class="page-lead">{{ t('agentSettings.lead') }}</p>

    <div class="stack account-agent__cards">
      <ErrorState v-if="settings === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
      <div v-else-if="settings === null" aria-busy="true">
        <BohrSkeleton class="account-agent__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>
      <SettingsCard v-else>
        <div class="account-agent__heading">
          <h2 class="card-title">{{ t('agentSettings.cardTitle') }}</h2>
          <span v-if="settings.configured" class="badge badge--green">{{ t('agentSettings.on') }}</span>
          <span v-else class="badge badge--amber">{{ t('agentSettings.off') }}</span>
        </div>
        <p class="card-text">{{ settings.configured ? t('agentSettings.textOn') : t('agentSettings.textOff') }}</p>
        <AgentSettingsForm v-model:settings="settings" />
      </SettingsCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrPageTitle, BohrSkeleton, SettingsCard } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { type AgentSettings, api } from '../api';
import AgentSettingsForm from '../components/AgentSettingsForm.vue';
import ErrorState from '../components/ErrorState.vue';
import { useErrorText } from '../composables/useErrorText';

// The agent's model provider for every project the user owns (account settings).
const { t } = useI18n();
const errorText = useErrorText();

const settings = ref<AgentSettings | null>(null);
const loadError = ref<unknown>(null);

async function load() {
  loadError.value = null;
  try {
    settings.value = (await api.agentSettings()).agent;
  } catch (caught) {
    loadError.value = caught;
  }
}

onMounted(load);
</script>

<style scoped>
.account-agent__back {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 24px;
  padding: 6px 17px 6px 10px;
  border-radius: var(--bohr-radius-full);
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
  text-transform: uppercase;
  color: #fff;
  background-color: hsl(0 0% 0% / 0.25);
  transition: background-color var(--bohr-transition);
}

.account-agent__back:hover,
.account-agent__back:focus-visible {
  background-color: hsl(0 0% 0% / 1);
}

.account-agent__cards {
  margin-top: 36px;
}

.account-agent__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.account-agent__skeleton {
  width: 100%;
  height: 420px;
}
</style>
