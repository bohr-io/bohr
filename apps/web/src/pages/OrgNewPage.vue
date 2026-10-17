<template>
  <div class="page page--narrow org-new">
    <BohrPageTitle :title="t('orgs.new.title')" />
    <p class="page-lead">{{ t('orgs.new.lead') }}</p>

    <SettingsCard class="org-new__card">
      <ol class="org-new__steps">
        <li data-step="github-org">
          <h2 class="org-new__step-title">{{ t('orgs.new.step1Title') }}</h2>
          <p class="card-text">{{ t('orgs.new.step1') }}</p>
          <BohrButton
            size="sm"
            variant="ghost"
            class="org-new__link"
            href="https://github.com/account/organizations/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            <template #iconLeft><NewWindowIcon :size="12" /></template>
            {{ t('orgs.new.createGithubOrg') }}
          </BohrButton>
        </li>
        <li data-step="install">
          <h2 class="org-new__step-title">{{ t('orgs.new.step2Title') }}</h2>
          <p class="card-text">{{ t('orgs.new.step2') }}</p>
          <p class="card-text">{{ t('orgs.new.members') }}</p>
          <div class="actions org-new__actions">
            <BohrButton :disabled="busy" data-action="install" @click="install">
              <template #iconLeft><GithubIcon :size="12" /></template>
              {{ busy ? t('common.working') : t('orgs.new.install') }}
            </BohrButton>
          </div>
          <p v-if="error !== null" class="notice notice--error org-new__error" role="alert">{{ error }}</p>
        </li>
      </ol>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, GithubIcon, NewWindowIcon, SettingsCard } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useErrorText } from '../composables/useErrorText';

// A new organization: the bohr GitHub App installed on a GitHub organization. GitHub cannot create organizations
// through its API, so the user creates one there first if needed. After the installation, GitHub brings the user
// back to the instance, which creates the organization and opens /orgs/:slug, or comes back here with ?error= (the
// App went to a personal account instead).
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const errorText = useErrorText();

const busy = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
  const detail = route.query.error;
  if (typeof detail !== 'string' || detail === '') return;
  error.value = t('orgs.new.installError', { detail });
  const { error: _error, ...query } = route.query;
  void router.replace({ query });
});

async function install() {
  busy.value = true;
  error.value = null;
  try {
    window.location.assign((await api.orgInstallUrl()).url);
  } catch (caught) {
    error.value = errorText(caught);
    busy.value = false;
  }
}
</script>

<style scoped>
.org-new__card {
  margin-top: 36px;
}

.org-new__steps {
  display: grid;
  gap: 28px;
  margin: 0;
  padding-left: 24px;
}

.org-new__steps > li::marker {
  font-size: 18px;
  font-weight: 700;
  color: var(--bohr-color-amber);
}

.org-new__step-title {
  font-size: 18px;
}

.org-new__link,
.org-new__actions,
.org-new__error {
  margin-top: 14px;
}
</style>
