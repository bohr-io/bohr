<template>
  <div class="overview">
    <div v-if="mode === 'loading'" aria-busy="true">
      <BohrSkeleton class="overview__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <SiteBar
        ref="bar"
        :open="open"
        :repository="repository"
        :targets="targets"
        :selected="shown?.kind ?? null"
        :branch="branch"
        :preview-diff="previewDiff"
        :url="shown?.url ?? null"
        :device="device"
        :can-chat="canChat"
        :chat="chatOpen"
        @close="closeSite"
        @select="selectDeploy"
        @device="device = $event"
        @chat="toggleChat"
      />

      <!-- bohr v1's main deploy card: what is live, with the site tilted beside it -->
      <section class="production" data-card="production" :aria-labelledby="`${uid}-production`">
        <BohrTypography
          :id="`${uid}-production`"
          tag="h2"
          variant="title2"
          color="hsl(181 69% 61%)"
          class="production__title"
          :inert="open"
        >
          <StatusIndicator :status="liveIndicator.status" :label="t(liveIndicator.label)" />
          {{ main?.kind === 'preview' ? t('project.overview.preview') : t('project.overview.production') }}
        </BohrTypography>

        <SiteStage
          ref="stage"
          class="production__stage"
          :src="shown?.url ?? null"
          :title="frameTitle"
          :open-label="shown ? t('project.site.open', { host: host(shown.url) }) : ''"
          :empty-title="t('project.site.emptyTitle')"
          :empty-text="t('project.site.emptyText')"
          :open="open"
          :chat="chatOpen"
          :device="device"
          :reload-key="reloadKey"
          @open="openSite"
          @close="closeSite"
        />

        <div class="production__info" :inert="open">
          <template v-if="update !== null">
            <BohrTypography tag="p" variant="title4" class="production__label">{{ t('project.site.lastUpdate') }}</BohrTypography>
            <p class="production__commit">{{ update.title }}</p>
            <p class="production__meta">
              <time :datetime="update.at" :title="formatDateTime(update.at, locale)">
                {{ t('project.site.updated', { time: formatRelative(update.at, locale) }) }}
              </time>
            </p>
            <p v-if="update.sha" class="production__meta">
              {{ t('project.site.hash') }}:
              <a
                :href="`https://github.com/${repository}/commit/${update.sha}`"
                target="_blank"
                rel="noopener noreferrer"
                class="production__link"
              >{{ update.sha.slice(0, 7) }}</a>
            </p>
          </template>
          <p v-else-if="main === null" class="production__commit">{{ t('project.site.emptyTitle') }}</p>
          <p v-if="main" class="production__meta production__url">{{ main.url }}</p>

          <div class="production__buttons">
            <BohrButton size="sm" :disabled="shown === null" @click="openSite">{{ t('project.site.view') }}</BohrButton>
            <BohrButton v-if="canChat" ref="chatButton" size="sm" color="secondary" data-overview-chat @click="openChat">
              <template #iconLeft><ChatIcon :size="14" /></template>
              {{ t('project.site.chat') }}
            </BohrButton>
          </div>
        </div>
      </section>

      <!-- Out of reach while the full-screen view covers it -->
      <div class="overview__rest" :inert="open">
        <ProjectChecklist :has-builds="builds === null ? null : builds.length > 0" @retried="retries++" />

        <div class="overview__grid">
          <!-- Where the site is -->
          <SettingsCard class="overview__card" data-card="addresses">
            <h2 class="overview__title">{{ t('project.overview.addresses') }}</h2>
            <dl class="overview__facts">
              <div>
                <dt>{{ t('project.overview.production') }}</dt>
                <dd>
                  <a v-if="productionUrl" :href="productionUrl" target="_blank" rel="noopener noreferrer" class="text-link">
                    {{ host(productionUrl) }}
                  </a>
                  <span v-else class="muted">{{ t('project.general.noProduction') }}</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('project.overview.preview') }}</dt>
                <dd>
                  <a v-if="previewUrl" :href="previewUrl" target="_blank" rel="noopener noreferrer" class="text-link">
                    {{ host(previewUrl) }}
                  </a>
                  <span v-else class="muted">{{ t('project.overview.noPreview') }}</span>
                </dd>
              </div>
            </dl>
          </SettingsCard>

          <!-- The agent -->
          <SettingsCard class="overview__card" data-card="agent">
            <h2 class="overview__title">{{ t('project.overview.agent') }}</h2>
            <p class="overview__status">
              <StatusIndicator :status="agentIndicator.status" :label="t(agentIndicator.label)" />
              <span aria-hidden="true">{{ t(agentIndicator.label) }}</span>
            </p>
            <template v-if="state !== null">
              <p v-if="state.current !== null" class="card-text overview__current">
                <strong>{{ t('project.overview.working') }}</strong> {{ state.current.text }}
                <span v-if="state.current.progress" class="overview__progress">{{ state.current.progress }}</span>
              </p>
              <p v-else class="card-text">{{ t('project.overview.idle') }}</p>
              <p v-if="state.queue.length > 0" class="card-text">{{ t('project.overview.queue', { count: state.queue.length }, state.queue.length) }}</p>
            </template>
            <div v-if="mode === 'agent'" class="overview__actions">
              <BohrButton size="sm" :as="RouterLink" :to="{ name: 'project-agent', params: { id } }">
                {{ t('project.overview.openAgent') }}
              </BohrButton>
            </div>
          </SettingsCard>

          <!-- The preview -->
          <SettingsCard v-if="state !== null" class="overview__card" data-card="preview">
            <h2 class="overview__title">{{ t('project.overview.preview') }}</h2>
            <p class="overview__status">
              <StatusIndicator :status="homolog.status" :label="t(homolog.label)" />
              <span aria-hidden="true">{{ t(homolog.label) }}</span>
              <span class="badge">{{ t('homolog.version', { version: state.homolog.version }) }}</span>
            </p>
            <ul v-if="state.homolog.changes.length > 0" class="overview__changes">
              <li v-for="change in state.homolog.changes" :key="change.requestId">{{ change.summary }}</li>
            </ul>
            <p v-else class="card-text">{{ t('project.overview.noChanges') }}</p>
            <!-- The decision, as in the chat: approving publishes, discarding asks first -->
            <div v-if="state.homolog.status === 'pending'" class="overview__actions" data-preview-decision>
              <BohrButton size="sm" color="secondary" :disabled="actions.busy.value !== null" @click="requestDecision('approve')">
                {{ actions.busy.value === 'approve' ? t('common.working') : t('chat.approve') }}
              </BohrButton>
              <BohrButton size="sm" variant="ghost" danger :disabled="actions.busy.value !== null" @click="requestDecision('discard')">
                {{ actions.busy.value === 'discard' ? t('common.working') : t('chat.discard') }}
              </BohrButton>
            </div>
            <div class="overview__actions">
              <BohrButton size="sm" variant="ghost" data-open-preview @click="showPreview(chatOpen)">
                {{ t('project.overview.openPreview') }}
              </BohrButton>
              <BohrButton size="sm" variant="text" :as="RouterLink" :to="{ name: 'project-agent', params: { id } }">
                {{ t('project.overview.openAgent') }}
              </BohrButton>
            </div>
          </SettingsCard>

          <!-- The latest release -->
          <SettingsCard v-if="state !== null" class="overview__card" data-card="release">
            <h2 class="overview__title">{{ t('project.overview.release') }}</h2>
            <template v-if="latest !== null">
              <p class="overview__status">
                <StatusIndicator :status="release.status" :label="t(release.label)" />
                <span aria-hidden="true">{{ t(release.label) }}</span>
              </p>
              <p class="card-text">{{ latest.summary }}</p>
              <p class="field-hint">
                {{ latest.pullRequest === null ? t('versions.direct') : t('versions.pr', { number: latest.pullRequest }) }}
                · {{ formatDateTime(latest.createdAt, locale) }}
              </p>
            </template>
            <p v-else class="card-text">{{ t('versions.empty') }}</p>
            <div class="overview__actions">
              <BohrButton size="sm" variant="ghost" :as="RouterLink" :to="{ name: 'project-versions', params: { id } }">
                {{ t('project.overview.openVersions') }}
              </BohrButton>
            </div>
          </SettingsCard>
        </div>

        <!-- Projects without a runtime: turn the agent on; projects bohr hosts: move them -->
        <div v-if="mode !== 'agent' || canMove" class="overview__extra">
          <template v-if="mode !== 'agent'">
            <!-- While the chat panel is open it shows the activation itself: only one of them sets the runtime up -->
            <AgentActivation
              v-if="canActivate && !chatOpen"
              :key="retries"
              :project-id="id"
              :initial-phase="mode === 'activating' ? 'provisioning' : 'intro'"
              @activated="loadSummary"
            />
            <SettingsCard v-else-if="!canActivate" class="overview__notice">
              <h2 class="card-title">{{ t('activation.deployOnlyTitle') }}</h2>
              <p class="card-text">{{ t('activation.deployOnly') }}</p>
              <p class="card-text">{{ isOwner ? t('activation.unavailable') : t('activation.askOwner') }}</p>
            </SettingsCard>
          </template>
          <MoveToCloudflare v-if="canMove" :project-id="id" @moved="loadSummary" />
        </div>
      </div>

      <Transition name="chat-drawer">
        <ChatDrawer v-if="chatOpen" ref="drawer" :docked="open" @close="closeChat" @preview="showPreview(true)" />
      </Transition>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  BohrButton,
  BohrSkeleton,
  BohrTypography,
  SettingsCard,
  type SitePreviewDevice,
  StatusIndicator,
} from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { type RouteLocationRaw, RouterLink, useRoute, useRouter } from 'vue-router';
import { api, type Build } from '../../api';
import { ChatIcon } from '../../components/icons';
import AgentActivation from '../../components/project/AgentActivation.vue';
import ChatDrawer from '../../components/project/ChatDrawer.vue';
import MoveToCloudflare from '../../components/project/MoveToCloudflare.vue';
import ProjectChecklist from '../../components/project/ProjectChecklist.vue';
import SiteBar, { type SiteKind, type SiteTarget } from '../../components/project/SiteBar.vue';
import SiteStage from '../../components/project/SiteStage.vue';
import { useProject } from '../../composables/useProject';
import { formatDateTime, formatRelative } from '../../lib/format';
import {
  buildIndicator,
  HOMOLOG_INDICATORS,
  type Indicator,
  projectIndicator,
  RELEASE_INDICATORS,
} from '../../lib/status';

// The overview, laid out like bohr v1's: the live site tilted beside its card and opened in full screen at
// /projects/:id/site (?deploy=preview for the preview), with the chat with the agent beside it (?chat=1); then
// what keeps the project from working and its cards.
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const uid = `overview-${useId()}`;
const {
  id,
  summary,
  state,
  mode,
  isOwner,
  canActivate,
  canMove,
  productionUrl,
  previewUrl,
  previewReady,
  explainNoPreview,
  loadSummary,
  actions,
  requestDecision,
} = useProject();

const bar = useTemplateRef<InstanceType<typeof SiteBar>>('bar');
const stage = useTemplateRef<InstanceType<typeof SiteStage>>('stage');
const drawer = useTemplateRef<InstanceType<typeof ChatDrawer>>('drawer');
const chatButton = useTemplateRef<InstanceType<typeof BohrButton>>('chatButton');

/** Retries of the runtime setup from the checklist: the activation card starts over with each one. */
const retries = ref(0);

const agentIndicator = computed<Indicator>(() =>
  summary.value === null ? { status: 'success', label: 'projects.state.ready' } : projectIndicator(summary.value),
);
const homolog = computed(() => HOMOLOG_INDICATORS[state.value?.homolog.status ?? 'clean']);
const latest = computed(() => state.value?.releases[0] ?? null);
const release = computed(() => RELEASE_INDICATORS[latest.value?.status ?? 'live']);

/** The repository's GitHub Actions runs (the deploys): the card's last update and the checklist's "no builds yet". */
const builds = ref<Build[] | null>(null);

async function loadBuilds() {
  try {
    builds.value = (await api.builds(id)).builds;
  } catch {
    builds.value = null;
  }
}

const repository = computed(() => state.value?.project.repository ?? summary.value?.repository ?? '');
const branch = computed(() => state.value?.project.productionBranch ?? null);
const name = computed(() => state.value?.project.name ?? summary.value?.name ?? '');

/** What the site view can show: production once deployed, and the preview once it can start. */
const targets = computed<SiteTarget[]>(() => {
  const list: SiteTarget[] = [];
  if (productionUrl.value) list.push({ kind: 'production', url: productionUrl.value });
  if (previewUrl.value && previewReady.value) list.push({ kind: 'preview', url: previewUrl.value });
  return list;
});
const hasPreview = computed(() => targets.value.some((target) => target.kind === 'preview'));
/** Beside the bar's selector: whether the preview is the same as production or has changes to review. */
const previewDiff = computed(() => {
  const homolog = state.value?.homolog;
  if (homolog === undefined || !hasPreview.value) return null;
  return { status: homolog.status, changes: homolog.changes.map((change) => change.summary) };
});
/** What the card is about: production, or the preview until there is one. */
const main = computed(() => targets.value[0] ?? null);
/** What the site view shows: the bar can switch it (?deploy=preview). */
const shown = computed(() => targets.value.find((target) => target.kind === route.query.deploy) ?? main.value);
/** New preview versions load it again. */
const reloadKey = computed(() => (shown.value?.kind === 'preview' ? (state.value?.homolog.version ?? 0) : 0));
const frameTitle = computed(() =>
  shown.value?.kind === 'preview'
    ? t('preview.frameTitle', { name: name.value })
    : t('project.site.frameTitle', { name: name.value }),
);

/** The latest deploy of the production branch, or else the latest release. */
const lastBuild = computed(
  () => builds.value?.find((build) => branch.value === null || build.branch === branch.value) ?? null,
);
const update = computed<{ title: string; at: string; sha: string | null } | null>(() => {
  const build = lastBuild.value;
  if (build !== null) {
    return { title: build.title ?? build.workflow ?? t('builds.untitled'), at: build.createdAt, sha: build.commit };
  }
  const release = state.value?.releases[0];
  return release ? { title: release.summary, at: release.createdAt, sha: release.commitSha } : null;
});
const liveIndicator = computed<Indicator>(() => {
  if (lastBuild.value !== null) return buildIndicator(lastBuild.value.status, lastBuild.value.conclusion);
  return main.value === null
    ? { status: 'off', label: 'project.site.emptyTitle' }
    : { status: 'success', label: 'project.site.live' };
});
// The full-screen view and the chat live in the URL, so a reload (or a link) opens them again.
/** Users who can use the agent here, or turn it on (the chat panel shows the activation then). */
const canChat = computed(() => mode.value === 'agent' || canActivate.value);
const open = computed(() => route.name === 'project-site' && shown.value !== null);
const chatOpen = computed(() => canChat.value && route.query.chat === '1');
const device = ref<SitePreviewDevice>('desktop');

/** Below 1024px the site opens in a new tab instead, as in v1 (links to the full-screen view still open it). */
function narrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches;
}

function navigate(site: boolean, chat: boolean, deploy = shown.value?.kind, replace = false) {
  const query: Record<string, string> = {};
  if (deploy === 'preview' && main.value?.kind !== 'preview') query.deploy = 'preview';
  if (chat) query.chat = '1';
  const to = { name: site ? 'project-site' : 'project', params: { id }, query };
  // A navigation that fails (its code went stale with a deploy) is the router's onError's.
  (replace ? router.replace(to) : router.push(to)).catch(() => {});
}

function openSite() {
  if (shown.value === null) return;
  if (narrow()) window.open(shown.value.url, '_blank', 'noopener');
  else navigate(true, chatOpen.value);
}

/** Back to the overview, which shows the card's deployment again. */
function closeSite() {
  navigate(false, false, main.value?.kind);
}

function selectDeploy(kind: SiteKind) {
  navigate(open.value, chatOpen.value, kind, true);
}

/** The chat works on the preview: opening it beside the full-screen view shows the preview. */
function chatDeploy(): SiteKind | undefined {
  return hasPreview.value ? 'preview' : shown.value?.kind;
}

function toggleChat() {
  const opening = !chatOpen.value;
  navigate(open.value, opening, opening && open.value ? chatDeploy() : undefined, true);
}

/** From the card: the chat beside the site in full screen; over the overview when there is no site or no room. */
function openChat() {
  const site = shown.value !== null && !narrow();
  navigate(site, true, site ? chatDeploy() : undefined);
}

function closeChat() {
  navigate(open.value, false, undefined, true);
}

/** "See the preview" (the card's, the chat's): the preview in full screen, or a toast that says why there is none. */
function showPreview(chat: boolean) {
  const preview = targets.value.find((target) => target.kind === 'preview');
  if (preview === undefined) explainNoPreview();
  else if (narrow()) window.open(preview.url, '_blank', 'noopener');
  else navigate(true, chat, 'preview');
}

// Focus goes into what opens (the chat, else the view's bar) and back to what opened it.
watch([open, chatOpen], async ([isOpen, isChat], [wasOpen, wasChat]) => {
  await nextTick();
  if (isChat && !wasChat) drawer.value?.focus();
  else if (isOpen && !wasOpen) bar.value?.focus();
  else if (wasOpen && !isOpen) stage.value?.focus();
  else if (wasChat && !isChat) {
    if (isOpen) bar.value?.focusChat();
    else (chatButton.value?.$el as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
});

/** The rest of the page (the menu, the header) lies under the full-screen view: focus that lands there goes to its bar. */
function onFocusIn(event: FocusEvent) {
  if (!open.value || !(event.target instanceof Element)) return;
  if (event.target.closest('[data-site-bar], .site-stage, [data-chat-drawer], [role="dialog"], .bohr-toasts')) return;
  bar.value?.focus();
}

onMounted(() => {
  document.addEventListener('focusin', onFocusIn);
  void loadBuilds();
});

onBeforeUnmount(() => document.removeEventListener('focusin', onFocusIn));

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
</script>

<style scoped>
.overview {
  /* The chat panel: a third of the screen, at least 360px; all of it on phones */
  --site-chat-width: clamp(360px, 100vw / 3, 100vw);

  display: grid;
  gap: 24px;
}

.overview__rest {
  display: contents;
}

/* v1's .main__deploy */
.production {
  display: grid;
  grid-template-columns: 32.16% minmax(0, 1fr);
  grid-template-areas:
    "title stage"
    "info stage";
  align-items: start;
  min-height: 330px;
  padding: 36px;
  border-radius: 8px;
  background-image: linear-gradient(292.48deg, transparent 38.89%, hsl(0 0% 0% / 0.425) 80.13%);
}

.production__title {
  grid-area: title;
  display: flex;
  align-items: center;
  gap: 12px;
}

.production__stage {
  grid-area: stage;
}

.production__info {
  grid-area: info;
  min-width: 0;
}

.production__label {
  margin-top: 36px;
}

.production__commit {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.production__meta {
  margin-top: 12px;
  font-size: 12px;
  color: hsl(0 0% 60%);
}

.production__commit + .production__meta {
  margin-top: 24px;
}

.production__url {
  margin-top: 24px;
  overflow-wrap: anywhere;
}

.production__link {
  font-weight: 700;
  color: hsl(39 92% 57%);
}

.production__link:hover,
.production__link:focus-visible {
  text-decoration: underline;
}

.production__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin-top: 36px;
}

.production__buttons > :nth-child(1) {
  flex-grow: 1;
}

.production__buttons > :nth-child(2) {
  flex-grow: 1.25;
}

/* The chat panel slides in from the right */
.chat-drawer-enter-active,
.chat-drawer-leave-active {
  transition: transform 300ms ease-out;
}

.chat-drawer-enter-from,
.chat-drawer-leave-to {
  transform: translateX(100%);
}

@media (max-width: 767px) {
  .overview {
    --site-chat-width: 100vw;
  }

  .production {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "title"
      "stage"
      "info";
    min-height: 0;
    padding: 24px;
  }

  .production__stage {
    margin-top: 16px;
  }
}

.overview__skeleton {
  width: 100%;
  height: 280px;
}

.overview__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 24px;
}

.overview__card :deep(.bohr-settings-card__content) {
  padding: 28px;
}

.overview__title {
  margin-bottom: 14px;
  font-size: 18px;
}

.overview__facts {
  display: grid;
  gap: 12px;
  margin: 0;
}

.overview__facts dt {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.overview__facts dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.overview__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-weight: 700;
}

.overview__current {
  overflow-wrap: anywhere;
}

.overview__progress {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.overview__changes {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  line-height: 1.5;
  color: var(--bohr-color-text-muted);
}

.overview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.overview__notice {
  max-width: 760px;
}

.overview__extra {
  display: grid;
  gap: 24px;
}
</style>
