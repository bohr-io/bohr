<template>
  <div class="builds">
    <!-- One run: its jobs, steps and logs -->
    <SettingsCard v-if="runId !== null" class="builds__card" data-view="run">
      <RouterLink :to="{ query: {} }" class="builds__back text-link">{{ t('builds.all') }}</RouterLink>
      <div class="builds__heading">
        <h2 class="card-title builds__title">
          {{ selected ? runTitle(selected) : t('builds.run', { number: runId }) }}
        </h2>
        <BohrButton size="sm" variant="ghost" :disabled="jobsLoading" @click="loadJobs">
          <template #iconLeft><RefreshIcon :size="12" /></template>
          {{ jobsLoading ? t('common.loading') : t('builds.refresh') }}
        </BohrButton>
      </div>
      <p v-if="selected" class="builds__meta">
        <span class="badge" :class="BADGE_OF[indicator(selected).status]">{{ t(indicator(selected).label) }}</span>
        <span v-if="selected.workflow">{{ selected.workflow }}</span>
        <span v-if="selected.branch">{{ selected.branch }}</span>
        <code class="inline-code">{{ selected.commit.slice(0, 7) }}</code>
        <time :datetime="selected.createdAt" :title="formatDateTime(selected.createdAt, locale)">{{ formatRelative(selected.createdAt, locale) }}</time>
        <a :href="selected.url" target="_blank" rel="noopener noreferrer" class="text-link">{{ t('builds.openGithub') }}</a>
      </p>
      <p v-if="selected && running(selected)" class="field-hint" role="status">{{ t('builds.autoRefresh') }}</p>

      <ErrorState v-if="jobs === null && jobsError !== null" class="builds__state" :message="errorText(jobsError)" @retry="loadJobs" />
      <div v-else-if="jobs === null" class="builds__state" aria-busy="true">
        <BohrSkeleton class="builds__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>
      <p v-else-if="jobs.length === 0" class="card-text">{{ t('builds.noJobs') }}</p>
      <div v-else ref="jobsArea" class="jobs">
        <details v-for="job in jobs" :key="job.id" class="job" :open="jobs.length === 1 || indicator(job).status === 'error'" :data-job="job.id">
          <summary class="job__summary">
            <StatusIndicator :status="indicator(job).status" :label="t(indicator(job).label)" />
            <span class="job__name">{{ job.name }}</span>
            <span class="badge" :class="BADGE_OF[indicator(job).status]">{{ t(indicator(job).label) }}</span>
            <span v-if="duration(job)" class="job__duration">{{ duration(job) }}</span>
          </summary>
          <ol v-if="job.steps.length > 0" class="job__steps" role="list">
            <li v-for="step in job.steps" :key="step.number" class="job__step">
              <StatusIndicator :status="indicator(step).status" :label="t(indicator(step).label)" />
              <span>{{ step.name }}</span>
            </li>
          </ol>
          <div class="job__log-head">
            <span class="field-label">{{ t('builds.log') }}</span>
            <a :href="job.url" target="_blank" rel="noopener noreferrer" class="text-link">{{ t('builds.openJob') }}</a>
          </div>
          <pre
            v-if="job.log"
            class="build-log"
            :data-log="job.id"
            tabindex="0"
            :aria-label="t('builds.logLabel', { job: job.name })"
          ><span v-for="(line, index) in parseLog(job.log)" :key="index" class="build-log__line" :class="`is-${line.kind}`">{{ line.text }}
</span></pre>
          <p v-else class="field-hint">{{ t('builds.noLog') }}</p>
        </details>
      </div>
    </SettingsCard>

    <!-- The list of runs -->
    <SettingsCard v-else class="builds__card" data-view="list">
      <div class="builds__heading">
        <h2 class="card-title">{{ t('builds.title') }}</h2>
        <BohrButton size="sm" variant="ghost" :disabled="listLoading" @click="refreshList">
          <template #iconLeft><RefreshIcon :size="12" /></template>
          {{ listLoading ? t('common.loading') : t('builds.refresh') }}
        </BohrButton>
      </div>
      <p class="card-text">{{ t('builds.text') }}</p>

      <ErrorState v-if="builds === null && listError !== null" class="builds__state" :message="errorText(listError)" @retry="loadBuilds" />
      <div v-else-if="builds === null" class="builds__state" aria-busy="true">
        <BohrSkeleton class="builds__skeleton" radius="8px" />
        <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
      </div>
      <p v-else-if="builds.length === 0" class="notice builds__state" data-empty>{{ t('builds.empty') }}</p>
      <ul v-else class="runs" role="list">
        <li v-for="build in builds" :key="build.id" class="run" :data-run="build.id">
          <StatusIndicator class="run__dot" :status="indicator(build).status" :label="t(indicator(build).label)" />
          <div class="run__main">
            <RouterLink :to="{ query: { run: String(build.id) } }" class="run__title">{{ runTitle(build) }}</RouterLink>
            <p class="run__meta">
              <span class="badge" :class="BADGE_OF[indicator(build).status]">{{ t(indicator(build).label) }}</span>
              <span v-if="build.workflow">{{ build.workflow }}</span>
              <span v-if="build.branch" class="run__branch">{{ build.branch }}</span>
              <code class="inline-code">{{ build.commit.slice(0, 7) }}</code>
              <time :datetime="build.createdAt" :title="formatDateTime(build.createdAt, locale)">{{ formatRelative(build.createdAt, locale) }}</time>
            </p>
          </div>
          <a
            :href="build.url"
            target="_blank"
            rel="noopener noreferrer"
            class="run__github"
            :aria-label="t('builds.openGithubNamed', { title: runTitle(build) })"
            :title="t('builds.openGithub')"
          >
            <NewWindowIcon :size="14" />
          </a>
        </li>
      </ul>
    </SettingsCard>

    <!-- What `bohr deploy` published with wrangler in the owner's Cloudflare account (no GitHub Actions run) -->
    <SettingsCard v-if="runId === null && cliDeploys.length > 0" class="builds__card" data-view="cli">
      <h2 class="card-title">{{ t('builds.cli.title') }}</h2>
      <p class="card-text">{{ t('builds.cli.text') }}</p>
      <ul class="runs" role="list">
        <li v-for="deploy in cliDeploys" :key="deploy.id" class="run" :data-cli-deploy="deploy.id">
          <span class="badge">{{ t('builds.cli.source') }}</span>
          <div class="run__main">
            <p class="run__title run__branch">{{ deploy.branch }}</p>
            <p class="run__meta">
              <span class="badge" :class="{ 'badge--green': deploy.production }" data-target>
                {{ deploy.production ? t('builds.cli.production') : t('builds.cli.preview') }}
              </span>
              <code v-if="deploy.commitSha" class="inline-code">{{ deploy.commitSha.slice(0, 7) }}</code>
              <span v-else>{{ t('builds.cli.noCommit') }}</span>
              <time :datetime="deploy.createdAt" :title="formatDateTime(deploy.createdAt, locale)">{{ formatRelative(deploy.createdAt, locale) }}</time>
              <a
                v-if="deploy.url"
                :href="deploy.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-link run__url"
              >{{ deploy.url.replace(/^https:\/\//, '') }}</a>
            </p>
          </div>
        </li>
      </ul>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, NewWindowIcon, SettingsCard, StatusIndicator } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { api, type Build, type BuildJob, type CliDeploy } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import { RefreshIcon } from '../../components/icons';
import { useErrorText } from '../../composables/useErrorText';
import { useProject } from '../../composables/useProject';
import { parseLog } from '../../lib/build-log';
import { formatDateTime, formatRelative } from '../../lib/format';
import { createPoller } from '../../lib/poller';
import { BADGE_OF, buildIndicator } from '../../lib/status';

// The repository's GitHub Actions runs (the deploys) and, for one of them (?run=), its jobs and logs.
// Both refresh by themselves while something is still running. Projects in their owner's Cloudflare account
// also list what `bohr deploy` published there with wrangler, which runs no workflow.

/** How often a running list or run is read again. */
const LIST_POLL_MS = 10_000;
const JOBS_POLL_MS = 5_000;

const { t, locale } = useI18n();
const route = useRoute();
const errorText = useErrorText();
const { id, summary } = useProject();
const jobsArea = useTemplateRef<HTMLElement>('jobsArea');

const builds = ref<Build[] | null>(null);
const listError = ref<unknown>(null);
const listLoading = ref(false);
const cliDeploys = ref<CliDeploy[]>([]);
const jobs = ref<BuildJob[] | null>(null);
const jobsError = ref<unknown>(null);
const jobsLoading = ref(false);

const runId = computed(() => {
  const value = Number(route.query.run);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const selected = computed(() => builds.value?.find((build) => build.id === runId.value) ?? null);

function indicator(item: { status: string | null; conclusion: string | null }) {
  return buildIndicator(item.status, item.conclusion);
}

function running(item: { status: string | null }) {
  return item.status !== 'completed';
}

function runTitle(build: Build) {
  const title = build.title ?? build.workflow ?? t('builds.untitled');
  return build.number === null ? title : `#${build.number} ${title}`;
}

function duration(job: BuildJob): string | null {
  if (job.startedAt === null || job.completedAt === null) return null;
  const seconds = Math.max(0, Math.round((Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function loadBuilds() {
  listLoading.value = true;
  try {
    builds.value = (await api.builds(id)).builds;
    listError.value = null;
  } catch (caught) {
    listError.value = caught;
  } finally {
    listLoading.value = false;
  }
}

/** Only projects in their owner's account have CLI deploys; a failure leaves the GitHub runs on their own. */
async function loadCliDeploys() {
  if (summary.value?.mode !== 'byo') return;
  try {
    cliDeploys.value = (await api.cliDeploys(id)).deploys;
  } catch {
    // The list keeps what it had: the runs above are the page's subject
  }
}

async function refreshList() {
  await Promise.all([loadBuilds(), loadCliDeploys()]);
}

async function loadJobs() {
  const run = runId.value;
  if (run === null) return;
  jobsLoading.value = true;
  try {
    const result = (await api.buildJobs(id, run)).jobs;
    if (runId.value === run) {
      jobs.value = result;
      jobsError.value = null;
    }
  } catch (caught) {
    if (runId.value === run) jobsError.value = caught;
  } finally {
    jobsLoading.value = false;
  }
}

// Auto-refresh while a run is queued or in progress.
const listPoller = createPoller(loadBuilds, () => LIST_POLL_MS);
const jobsPoller = createPoller(
  () => Promise.all([loadJobs(), loadBuilds()]).then(() => undefined),
  () => JOBS_POLL_MS,
);

const listRunning = computed(() => runId.value === null && (builds.value ?? []).some(running));
const runRunning = computed(() => runId.value !== null && selected.value !== null && running(selected.value));
watch(listRunning, (active) => (active ? listPoller.start(false) : listPoller.stop()));
watch(runRunning, (active) => (active ? jobsPoller.start(false) : jobsPoller.stop()));

/**
 * Logs grow with the page, which scrolls instead of the log. While new lines arrive, a reader at the end of the
 * page stays at the end; one who scrolled up stays where they are.
 */
watch(jobs, async (current, previous) => {
  if (previous === null || current === null) return;
  const root = document.documentElement;
  const atEnd = root.scrollHeight - window.scrollY - window.innerHeight < 40;
  await nextTick();
  if (atEnd) window.scrollTo({ top: root.scrollHeight });
});

watch(runId, (run, previous) => {
  if (run === previous) return;
  jobs.value = null;
  jobsError.value = null;
  if (run !== null) void loadJobs();
});

// The project's summary (its mode) may still be loading when the page opens
watch(
  () => summary.value?.mode,
  (mode) => {
    if (mode === 'byo') void loadCliDeploys();
  },
  { immediate: true },
);

onMounted(() => {
  void loadBuilds();
  if (runId.value !== null) void loadJobs();
});

onBeforeUnmount(() => {
  listPoller.stop();
  jobsPoller.stop();
});
</script>

<style scoped>
.builds {
  display: grid;
  gap: 24px;
}

.builds__card :deep(.bohr-settings-card__content) {
  padding: clamp(20px, 3vw, 32px);
}

.builds__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.builds__title {
  overflow-wrap: anywhere;
}

.builds__back {
  display: inline-block;
  margin-bottom: 16px;
  font-size: 14px;
}

.builds__state {
  margin-top: 20px;
}

.builds__skeleton {
  width: 100%;
  height: 240px;
}

.builds__meta,
.run__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.runs {
  display: grid;
  margin-top: 20px;
}

.run {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}

.run + .run {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.run__title {
  font-weight: 700;
  overflow-wrap: anywhere;
  color: inherit;
  transition: color var(--bohr-transition);
}

.run__title:hover,
.run__title:focus-visible {
  color: #f26419;
}

.run__meta {
  margin-top: 4px;
}

.run__branch,
.run__url {
  overflow-wrap: anywhere;
}

.run__github {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-text-muted);
  transition: color var(--bohr-transition), background-color var(--bohr-transition);
}

.run__github:hover,
.run__github:focus-visible {
  color: #fff;
  background-color: hsl(0 0% 100% / 0.08);
}

.jobs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin-top: 20px;
}

.job {
  min-width: 0;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
}

.job__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
}

.job__name {
  flex: 1;
  min-width: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.job__duration {
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.job__steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 4px 16px 12px;
  font-size: 14px;
}

.job__step {
  display: flex;
  align-items: center;
  gap: 10px;
}

.job__log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px 0;
  font-size: 13px;
}

.job__log-head .field-label {
  margin-bottom: 0;
}

.job > .field-hint {
  padding: 0 16px 14px;
}

.build-log {
  margin: 8px 16px 16px;
  padding: 12px 14px;
  /* As tall as the log (the page scrolls); long lines scroll sideways */
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: var(--bohr-radius-sm);
  font-family: var(--bohr-font-family-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
  color: hsl(0 0% 100% / 0.85);
  background: hsl(0 0% 0% / 0.45);
}

.build-log:focus-visible {
  outline: 2px solid var(--bohr-color-frame);
}

.build-log__line.is-group {
  font-weight: 700;
  color: var(--bohr-color-cyan);
}

.build-log__line.is-error {
  color: var(--bohr-color-red);
}

.build-log__line.is-warning {
  color: var(--bohr-color-amber);
}

.build-log__line.is-command {
  color: hsl(0 0% 100% / 0.55);
}
</style>
