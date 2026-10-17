<template>
  <div class="page page--narrow new-project">
    <BohrPageTitle :title="t('newProject.title')" />
    <p v-if="org !== null" class="new-project__org" data-org>
      <OrgAvatar :name="orgName" :url="orgDetail?.org.avatarUrl ?? null" :size="24" />
      <I18nT keypath="orgs.newProject.in" scope="global">
        <template #org>
          <RouterLink :to="{ name: 'org', params: { slug: org } }" class="text-link">{{ orgName }}</RouterLink>
        </template>
      </I18nT>
    </p>
    <p class="page-lead">{{ org !== null ? t('orgs.newProject.lead') : t('newProject.lead') }}</p>

    <ErrorState
      v-if="setup === null && loadError !== null"
      class="new-project__error"
      :message="errorText(loadError)"
      @retry="load"
    />
    <SettingsCard v-else-if="notReady" class="new-project__error" data-notice="org-not-ready">
      <h2 class="card-title">{{ t('orgs.newProject.notReadyTitle') }}</h2>
      <p class="card-text">{{ t('orgs.notReady') }}</p>
      <div class="actions new-project__actions">
        <BohrButton v-if="org !== null" :as="RouterLink" :to="{ name: 'org', params: { slug: org } }">{{ t('orgs.newProject.back') }}</BohrButton>
      </div>
    </SettingsCard>
    <div v-else-if="setup === null" class="new-project__loading" aria-busy="true">
      <BohrSkeleton class="new-project__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <template v-else>
      <div v-if="!setup.agentConfigured" class="notice notice--warn new-project__agent" data-notice="agent">
        <strong class="notice__title">{{ t('newProject.agentMissingTitle') }}</strong>
        <template v-if="org === null">
          <p>{{ t('newProject.agentMissing') }}</p>
          <RouterLink :to="{ name: 'account-agent' }" class="text-link">{{ t('newProject.agentLink') }}</RouterLink>
        </template>
        <template v-else-if="orgDetail?.org.role === 'admin'">
          <p>{{ t('orgs.newProject.agentMissingAdmin') }}</p>
          <RouterLink :to="{ name: 'org-settings', params: { slug: org } }" class="text-link">{{ t('newProject.agentLink') }}</RouterLink>
        </template>
        <p v-else>{{ t('orgs.newProject.agentMissing') }}</p>
      </div>

      <WizardProgress class="new-project__progress" :steps="steps" :current="view === 'unavailable' ? 'provisioning' : view" />
      <div v-if="projectId === null" class="new-project__source" role="group" :aria-label="t('newProject.source.legend')" data-source>
        <button
          v-for="option in SOURCES"
          :key="option"
          type="button"
          class="new-project__source-option"
          :data-option="option"
          :aria-pressed="source === option"
          @click="chooseSource(option)"
        >
          <span class="new-project__source-name">{{ t(`newProject.source.${option}`) }}</span>
          <span class="new-project__source-hint">{{ t(`newProject.source.${option}Hint`) }}</span>
        </button>
      </div>
      <TemplateCreated v-if="projectId !== null && templateSlug !== null" :key="projectId" class="new-project__created" :project-id="projectId" />
      <div ref="stepArea" class="new-project__step" :data-view="view">
        <StepTemplate
          v-if="projectId === null && source === 'template'"
          :org="org ?? undefined"
          :template="templateSlug ?? undefined"
          :error="queryText('error')"
          :error-code="queryText('code')"
        />
        <StepRepository v-else-if="projectId === null" :install-url="installUrl" :org="org ?? undefined" @created="onCreated" />
        <!-- No runtime: the Cloudflare account cannot run the agent's sandbox (a self-hosted instance) -->
        <SettingsCard v-else-if="view === 'unavailable'" data-notice="agent-unavailable">
          <h2 class="card-title" tabindex="-1">{{ t('activation.containersTitle') }}</h2>
          <p class="card-text">{{ t('activation.containersText') }}</p>
          <div class="actions new-project__actions">
            <BohrButton @click="openProject">{{ t('newProject.openProject') }}</BohrButton>
          </div>
        </SettingsCard>
        <StepProvisioning v-else-if="view === 'provisioning'" :project-id="projectId" @ready="onReady" />
        <StepBot v-else :project-id="projectId" @connected="onBot" @skip="openProject" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, BohrSkeleton, SettingsCard, useToast } from '@bohr/ui';
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, type OrgDetail } from '../api';
import ErrorState from '../components/ErrorState.vue';
import StepBot from '../components/new-project/StepBot.vue';
import StepProvisioning from '../components/new-project/StepProvisioning.vue';
import StepRepository from '../components/new-project/StepRepository.vue';
import StepTemplate from '../components/new-project/StepTemplate.vue';
import TemplateCreated from '../components/new-project/TemplateCreated.vue';
import WizardProgress from '../components/onboarding/WizardProgress.vue';
import OrgAvatar from '../components/org/OrgAvatar.vue';
import { useErrorText } from '../composables/useErrorText';
import { orgReady } from '../lib/org';
import { orgs } from '../orgs';

// A new project after the onboarding: pick a repository (or a template, ?source=template), follow the setup of
// its runtime, then optionally connect a Telegram bot. Where the user is lives in the query (?project=, &step=bot,
// &agent=unavailable when the account cannot run the agent's sandbox),
// so a reload resumes. With ?org=<slug>, the project is the organization's: its repositories, subscription,
// Cloudflare account and agent. A template's project comes back from GitHub's authorization with &template=<slug>
// (its admin password is shown once), or to the template's form with ?error= (&code=).
type View = 'repository' | 'provisioning' | 'unavailable' | 'bot';
type Source = 'repository' | 'template';
const SOURCES: readonly Source[] = ['repository', 'template'];

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const errorText = useErrorText();
const stepArea = useTemplateRef<HTMLElement>('stepArea');

/** What the page needs once the account (or the organization) is ready for projects. */
const setup = ref<{ agentConfigured: boolean; installUrl: string | null } | null>(null);
const loadError = ref<unknown>(null);
const orgDetail = ref<OrgDetail | null>(null);
/** A member of an organization that is not set up yet: only its admins can finish it. */
const notReady = ref(false);
/** The GitHub App's page for more repositories, from the instance when the onboarding has no link. */
const appInstallUrl = ref<string | null>(null);

const org = computed(() => (typeof route.query.org === 'string' && route.query.org ? route.query.org : null));
const orgName = computed(
  () => orgDetail.value?.org.name ?? orgs.list?.find((entry) => entry.slug === org.value)?.name ?? org.value ?? '',
);
const projectId = computed(() => (typeof route.query.project === 'string' ? route.query.project : null));
const templateSlug = computed(() =>
  typeof route.query.template === 'string' && route.query.template ? route.query.template : null,
);
const source = computed<Source>(() =>
  route.query.source === 'template' || templateSlug.value !== null ? 'template' : 'repository',
);
const view = computed<View>(() => {
  if (projectId.value === null) return 'repository';
  if (route.query.agent === 'unavailable') return 'unavailable';
  return route.query.step === 'bot' ? 'bot' : 'provisioning';
});
const steps = computed(() => [
  {
    id: 'repository',
    label: source.value === 'template' ? t('newProject.steps.template') : t('newProject.steps.repository'),
  },
  { id: 'provisioning', label: t('newProject.steps.provisioning') },
  { id: 'bot', label: t('newProject.steps.bot') },
]);
const installUrl = computed(() => setup.value?.installUrl ?? appInstallUrl.value);

async function loadOrg(slug: string) {
  const detail = await api.org(slug);
  orgDetail.value = detail;
  if (!orgReady(detail)) {
    // Admins finish the organization's setup on its page; members wait for them.
    if (detail.org.role === 'admin') await router.replace({ name: 'org', params: { slug } });
    else notReady.value = true;
    return;
  }
  setup.value = { agentConfigured: detail.org.status.agent, installUrl: null };
}

async function load() {
  loadError.value = null;
  try {
    const instancePromise = api.instance().catch(() => null);
    if (org.value !== null) {
      await loadOrg(org.value);
    } else {
      const data = await api.onboarding();
      // Projects need the Cloudflare account and the GitHub App (and the subscription on bohr.io Cloud) first.
      if (data.step !== 'done') {
        await router.replace({ name: 'start' });
        return;
      }
      setup.value = { agentConfigured: data.agent.configured, installUrl: data.github.installUrl };
    }
    const instance = await instancePromise;
    if (instance?.githubAppSlug) {
      appInstallUrl.value = `https://github.com/apps/${encodeURIComponent(instance.githubAppSlug)}/installations/new`;
    }
  } catch (caught) {
    loadError.value = caught;
  }
}

/** The query keeps the organization (and the template the project came from) along the steps. */
function stepQuery(query: Record<string, string>) {
  return {
    ...(org.value === null ? {} : { org: org.value }),
    ...query,
    ...(templateSlug.value === null || query.project === undefined ? {} : { template: templateSlug.value }),
  };
}

/** A text from the query (?error=, &code=), when there is one. */
function queryText(name: string) {
  const value = route.query[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function chooseSource(next: Source) {
  void router.replace({ query: stepQuery(next === 'template' ? { source: 'template' } : {}) });
}

function onCreated(id: string, runtime: boolean) {
  void router.replace({ query: stepQuery(runtime ? { project: id } : { project: id, agent: 'unavailable' }) });
}

/**
 * Connecting the Telegram bot is for the project's owners: in an organization, its admins. A member who created the
 * project goes straight to it.
 */
function onReady() {
  if (projectId.value === null) return;
  if (org.value !== null && orgDetail.value?.org.role !== 'admin') {
    openProject();
    return;
  }
  void router.replace({ query: stepQuery({ project: projectId.value, step: 'bot' }) });
}

function onBot(username: string) {
  toast.success(t('newProject.bot.connected', { bot: `@${username}` }));
  openProject();
}

function openProject() {
  if (projectId.value !== null) void router.push({ name: 'project', params: { id: projectId.value } });
}

// A new step: move focus to its heading, so keyboard and screen reader users start there.
watch(view, async (next, previous) => {
  if (next === previous) return;
  await nextTick();
  stepArea.value?.querySelector<HTMLElement>('h2')?.focus();
});

onMounted(load);
</script>

<style scoped>
.new-project__org {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-weight: 700;
}

.new-project__agent,
.new-project__progress,
.new-project__loading,
.new-project__error {
  margin-top: 36px;
}

.new-project__agent + .new-project__progress {
  margin-top: 28px;
}

.new-project__step {
  margin-top: 28px;
}

.new-project__created {
  margin-top: 28px;
}

.new-project__source {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 10px;
  margin-top: 28px;
}

.new-project__source-option {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.new-project__source-option:hover,
.new-project__source-option[aria-pressed='true'] {
  border-color: var(--bohr-color-frame);
}

.new-project__source-option[aria-pressed='true'] {
  background: hsl(var(--bohr-hsl-orange) / 0.08);
}

.new-project__source-option:focus-visible {
  outline: 2px solid var(--bohr-color-orange);
  outline-offset: 2px;
}

.new-project__source-name {
  font-weight: 700;
}

.new-project__source-hint {
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.new-project__actions {
  margin-top: 20px;
}

.new-project__skeleton {
  width: 100%;
  height: 320px;
}
</style>
