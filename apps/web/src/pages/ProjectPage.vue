<template>
  <div class="page project">
    <RouterLink :to="org ? { name: 'org', params: { slug: org.slug } } : '/projects'" class="project__back">
      <ArrowIcon direction="left" :size="9" />
      <span>{{ t('common.back') }}</span>
    </RouterLink>

    <ProjectHeader
      :title="pageName"
      :repository="repository"
      :production-url="productionUrl"
      :preview-url="previewUrl"
      :org="org"
    />

    <p v-if="access === 'admin'" class="project__admin" role="note" data-banner="admin">
      <ShieldIcon :size="14" />
      <span>{{ t('project.adminAccess') }}</span>
    </p>

    <!-- The instance hides projects from non-members (404); the runtime may still say not_a_member (403). -->
    <div v-if="joinable" class="project__alone">
      <JoinProject :project-id="id" :unlisted="feed.state.status === 'not_found'" @joined="joined" />
    </div>

    <div v-else-if="feed.state.status === 'not_found'" class="project__alone">
      <SettingsCard>
        <h2 class="card-title">{{ t('project.notFoundTitle') }}</h2>
        <p class="card-text">{{ t('project.notFound') }}</p>
        <div class="actions project__actions">
          <BohrButton :as="RouterLink" to="/projects">{{ t('notFound.back') }}</BohrButton>
        </div>
      </SettingsCard>
    </div>

    <div v-else class="project__grid">
      <ProjectNav
        class="project__nav"
        :label="inSettings ? t('project.nav.settingsLabel') : t('project.nav.label')"
        :links="links"
        :back="inSettings ? { to: { name: 'project', params: { id } }, label: t('common.back') } : undefined"
      />
      <div class="project__main">
        <RouterView />
      </div>
    </div>

    <ConfirmDialog
      :open="confirmDiscard"
      :title="t('chat.discardTitle')"
      :confirm-label="t('chat.discard')"
      danger
      :busy="actions.busy.value === 'discard'"
      @confirm="discard"
      @cancel="confirmDiscard = false"
    >
      <p>{{ t('chat.discardText') }}</p>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrButton, SettingsCard, useToast } from '@bohr/ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  api,
  detailAccess,
  detailOrg,
  type OrgRef,
  type ProjectAccess,
  type ProjectDetail,
  type ProjectSummary,
} from '../api';
import { useProjectActions } from '../chat/actions';
import { createChatFeed } from '../chat/feed';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { ShieldIcon } from '../components/icons';
import JoinProject from '../components/project/JoinProject.vue';
import ProjectHeader from '../components/project/ProjectHeader.vue';
import ProjectNav, { type NavLink } from '../components/project/ProjectNav.vue';
import { useErrorToast } from '../composables/useErrorText';
import { usePageTitle } from '../composables/usePageTitle';
import { type ProjectMode, provideProject } from '../composables/useProject';
import { setContext } from '../orgs';
import { session } from '../session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const route = useRoute();

const feed = createChatFeed(props.id);
const actions = useProjectActions(feed);
const state = computed(() => feed.state.project);

// GET /api/projects/:id: the instance admin's access and the organization the project belongs to.
let detailCall: Promise<ProjectDetail | null> | null = null;
function loadDetail(): Promise<ProjectDetail | null> {
  detailCall ??= api.project(props.id).catch(() => null);
  return detailCall;
}

// The instance's view of the project (GET /api/projects): runtime status, bot and production URL.
// Someone who joined with an invite may not be listed yet; the runtime decides for them.
const summary = ref<ProjectSummary | null>(null);
const summaryLoaded = ref(false);

async function loadSummary() {
  try {
    const find = (list: ProjectSummary[]) => list.find((project) => project.id === props.id) ?? null;
    let found = find((await api.projects()).projects);
    // An organization's project is listed with the organization's projects.
    const detail = found === null ? await loadDetail() : null;
    const slug = detail === null ? undefined : detailOrg(detail)?.slug;
    if (slug) found = find((await api.projects(slug)).projects);
    summary.value = found;
  } catch {
    summary.value = null;
  } finally {
    summaryLoaded.value = true;
  }
}

/** admin: an instance admin looking at someone else's project (the actions still work). */
const access = ref<ProjectAccess | null>(null);
/** The organization the project belongs to; null for a personal project. */
const org = ref<OrgRef | null>(null);

async function loadAccess() {
  const detail = await loadDetail();
  access.value = detail === null ? null : detailAccess(detail);
  org.value = detail === null ? null : detailOrg(detail);
  // Opening a project (a deep link too) selects its scope: its organization or the personal account. Not for an
  // instance admin looking at someone else's project.
  if (detail !== null && access.value !== 'admin') setContext(org.value?.slug ?? null);
}

const mode = computed<ProjectMode>(() => {
  if (!summaryLoaded.value) return 'loading';
  const project = summary.value;
  if (project === null) return 'agent';
  if (project.runtime === null) return 'deploy-only';
  if (project.runtime.status !== 'ready' && project.role === 'owner') return 'activating';
  return 'agent';
});

const isOwner = computed(() => (state.value?.you.role ?? summary.value?.role) === 'owner');
const canActivate = computed(() => summary.value?.role === 'owner');

/**
 * Projects migrated from v1 that bohr still hosts: the owner can move them to their own Cloudflare account.
 * Stays on once shown, so the result of a finished move (the project is no longer hosted by bohr) remains.
 */
const canMove = ref(false);
watch(summary, (project) => {
  if (project?.role === 'owner' && project.mode === 'managed') canMove.value = true;
});

watch(mode, (current) => (current === 'agent' ? feed.start() : feed.stop()));

const repository = computed(() => state.value?.project.repository ?? summary.value?.repository ?? '');
const productionUrl = computed(() => state.value?.project.productionUrl ?? summary.value?.productionUrl ?? null);
const previewUrl = computed(() => state.value?.project.previewUrl ?? summary.value?.runtime?.previewUrl ?? null);
const name = computed(() => state.value?.project.name ?? summary.value?.name ?? t('project.title'));
const previewReady = computed(
  () => previewUrl.value !== null && state.value?.project.previewState !== 'not_configured',
);

const toast = useToast();

function explainNoPreview() {
  if (previewUrl.value === null) toast.tip(t('preview.none'));
  else if (state.value?.project.importStatus === 'running') toast.tip(t('preview.importRunning'));
  else toast.tip(t('preview.notConfigured'));
}

const inSettings = computed(() => route.meta.projectSettings === true);
const pageName = computed(() => t(route.meta.projectPage ?? 'project.nav.overview'));

usePageTitle(() => (summaryLoaded.value ? `${pageName.value} · ${name.value}` : null));

const joinable = computed(
  () =>
    feed.state.status === 'not_member' ||
    (feed.state.status === 'not_found' && summaryLoaded.value && summary.value === null),
);

function link(routeName: string, label: string, current = route.name === routeName): NavLink {
  return { to: { name: routeName, params: { id: props.id } }, label, current };
}

const links = computed<NavLink[]>(() => {
  if (inSettings.value) {
    return [
      link('project-settings-general', t('project.settingsNav.general')),
      link('project-settings-domains', t('project.settingsNav.domains')),
      link('project-settings-variables', t('project.settingsNav.variables')),
      link('project-settings-auth', t('project.settingsNav.auth')),
      link('project-settings-agent', t('project.settingsNav.agent')),
      ...(canMove.value ? [link('project-settings-hosting', t('project.settingsNav.hosting'))] : []),
    ];
  }
  return [
    link('project', t('project.nav.overview'), route.name === 'project' || route.name === 'project-site'),
    link('project-versions', t('project.nav.versions')),
    link('project-builds', t('project.nav.builds')),
    link('project-members', t('project.nav.members')),
    link('project-settings-general', t('project.nav.settings'), false),
  ];
});

// Discarding drops every change in the preview, so it asks first. Approving publishes right away,
// as the project bot's button does.
const confirmDiscard = ref(false);

function requestDecision(action: 'approve' | 'discard') {
  if (action === 'discard') confirmDiscard.value = true;
  else void actions.decide('approve');
}

// The agent prepares the repository (the import) when the project is created; the owner can ask again.
const showError = useErrorToast();
const preparing = ref(false);

async function prepareRepository() {
  preparing.value = true;
  try {
    await api.importRepository(props.id);
    await feed.refresh();
  } catch (error) {
    showError(error);
  } finally {
    preparing.value = false;
  }
}

async function discard() {
  await actions.decide('discard');
  confirmDiscard.value = false;
}

async function joined() {
  feed.restart();
  await loadSummary();
}

provideProject({
  id: props.id,
  feed,
  actions,
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
  requestDecision,
  prepareRepository,
  preparing,
});

function onVisibility() {
  feed.visibilityChanged();
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility);
  void loadSummary();
  void loadAccess();
});

onBeforeUnmount(() => {
  feed.stop();
  document.removeEventListener('visibilitychange', onVisibility);
});

// Signed out elsewhere: the global 401 handling takes over; nothing to poll meanwhile.
watch(
  () => session.status,
  (status) => {
    if (status === 'signed-out') feed.stop();
  },
);
</script>

<style scoped>
/* bohr v1's project page: 1152px wide, a sticky menu on the left and the sub-page on the right. */
.project {
  max-width: calc(1152px + 2 * var(--gutter));
}

.project__back {
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

.project__back:hover,
.project__back:focus-visible {
  background-color: hsl(0 0% 0% / 1);
}

.project__admin {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: -8px 0 24px;
  padding: 4px 12px;
  border: 1px solid hsl(var(--bohr-hsl-amber) / 0.45);
  border-radius: var(--bohr-radius-full);
  font-size: 13px;
  color: var(--bohr-color-amber);
  background: hsl(var(--bohr-hsl-amber) / 0.08);
}

.project__grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: 'sidebar main';
  align-items: start;
}

.project__nav {
  grid-area: sidebar;
}

.project__main {
  grid-area: main;
  min-width: 0;
}

.project__alone {
  max-width: 760px;
}

.project__actions {
  margin-top: 20px;
}

@media (max-width: 1023px) {
  .project__grid {
    display: block;
  }

  .project__main {
    margin-top: 24px;
  }
}
</style>
