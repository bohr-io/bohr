<template>
  <section
    ref="root"
    class="site-bar"
    :class="{ 'is-open': open, 'is-instant': instant }"
    :aria-label="t('project.site.bar')"
    :inert="!open"
    :aria-hidden="open ? undefined : 'true'"
    data-site-bar
  >
    <button ref="logo" type="button" class="site-bar__logo" :aria-label="t('project.site.close')" :title="t('project.site.close')" @click="emit('close')">
      <BohrLogo icon-color="hsl(0 0% 100%)" />
    </button>

    <p v-if="owner || repo" class="site-bar__crumbs">
      <span v-if="owner" class="site-bar__crumb">{{ owner }}</span>
      <span v-if="repo" class="site-bar__crumb">{{ repo }}</span>
    </p>

    <!-- Which deployment the view shows: production or the preview -->
    <label v-if="selected" class="site-bar__deploy">
      <span class="bohr-visually-hidden">{{ t('project.site.deploy') }}</span>
      <span class="site-bar__deploy-view" aria-hidden="true">
        <span class="site-bar__deploy-icon"><BranchIcon :size="16" color="#1b2a34" /></span>
        <span class="site-bar__deploy-text">{{ deployLabel(selected) }}</span>
        <ArrowIcon v-if="targets.length > 1" direction="bottom" :size="12" />
      </span>
      <select
        class="site-bar__select"
        :value="selected"
        :disabled="targets.length < 2"
        @change="emit('select', ($event.target as HTMLSelectElement).value as SiteKind)"
      >
        <option v-for="target in targets" :key="target.kind" :value="target.kind">{{ deployLabel(target.kind) }}</option>
      </select>
    </label>

    <!-- Whether the preview is the same as production or has changes to review (their summaries on hover) -->
    <p
      v-if="previewDiff"
      class="site-bar__diff"
      :class="`is-${previewDiff.status}`"
      role="status"
      :title="diffTitle"
      data-preview-diff
    >
      <span class="site-bar__diff-dot" aria-hidden="true" />
      <span class="site-bar__diff-text">{{ diffLabel }}</span>
    </p>

    <div class="site-bar__devices site-bar__divided" role="group" :aria-label="t('preview.device')">
      <button
        v-for="option in DEVICES"
        :key="option.kind"
        type="button"
        class="site-bar__device"
        :class="{ 'is-selected': kindOf(device) === option.kind }"
        :aria-pressed="kindOf(device) === option.kind"
        :aria-label="deviceLabel(option)"
        :title="deviceLabel(option)"
        @click="pick(option.kind)"
      >
        <component :is="option.icon" :size="20" />
      </button>
    </div>

    <div class="site-bar__actions site-bar__divided">
      <BohrButton v-if="canChat" size="sm" :color="chat ? 'secondary' : 'primary'" :aria-pressed="chat" data-site-chat @click="emit('chat')">
        <template #iconLeft><ChatIcon :size="14" /></template>
        {{ t('project.site.chat') }}
      </BohrButton>
      <a
        v-if="url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="site-bar__round site-bar__round--open"
        :aria-label="t('project.site.openTab', { url })"
        :title="url"
      >
        <NewWindowIcon :size="16" color="#111b22" />
      </a>
      <a
        v-if="repository"
        :href="`https://github.com/${repository}`"
        target="_blank"
        rel="noopener noreferrer"
        class="site-bar__round"
        :aria-label="t('project.links.github', { repository })"
        :title="`https://github.com/${repository}`"
      >
        <GithubIcon :size="32" />
      </a>
    </div>

    <div class="site-bar__divided">
      <button type="button" class="site-bar__round" :aria-label="t('project.site.close')" :title="t('project.site.close')" @click="emit('close')">
        <XIcon :size="20" color="#e84855" />
      </button>
    </div>
  </section>
</template>

<script lang="ts">
/** The deployments the full-screen view can show. */
export type SiteKind = 'production' | 'preview';

export interface SiteTarget {
  kind: SiteKind;
  url: string;
}
</script>

<script setup lang="ts">
import type { HomologStatus } from '@bohr/shared';
import {
  ArrowIcon,
  BohrButton,
  BohrLogo,
  GithubIcon,
  NewWindowIcon,
  type SitePreviewDevice,
  XIcon,
} from '@bohr/ui';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { BranchIcon, ChatIcon, DesktopIcon, PhoneIcon, TabletIcon } from '../icons';

// bohr v1's BohrPreviewBar, which slides down over the full-screen view: the way back, the project, which
// deployment is shown, the device sizes, the chat with the agent and links out. Its editing tools (edit and save,
// the code view, VS Code, the others' cursors and the tour) are gone.
const props = defineProps<{
  open: boolean;
  /** owner/repo */
  repository: string;
  targets: SiteTarget[];
  selected: SiteKind | null;
  /** The production branch, for its label. */
  branch: string | null;
  /** The preview against production: its status and the summaries of its changes; null without a preview. */
  previewDiff: { status: HomologStatus; changes: string[] } | null;
  /** The shown deployment's address. */
  url: string | null;
  device: SitePreviewDevice;
  /** The user can use the agent here. */
  canChat: boolean;
  chat: boolean;
}>();

const emit = defineEmits<{ close: []; select: [kind: SiteKind]; device: [device: SitePreviewDevice]; chat: [] }>();

type DeviceKind = 'desktop' | 'tablet' | 'phone';

const DEVICES = [
  { kind: 'desktop', icon: DesktopIcon, label: 'preview.desktop' },
  { kind: 'tablet', icon: TabletIcon, label: 'preview.tablet' },
  { kind: 'phone', icon: PhoneIcon, label: 'preview.mobile' },
] as const satisfies readonly { kind: DeviceKind; icon: unknown; label: string }[];

const { t } = useI18n();
const root = useTemplateRef<HTMLElement>('root');
const logo = useTemplateRef<HTMLButtonElement>('logo');

const owner = computed(() => props.repository.split('/')[0] ?? '');
const repo = computed(() => props.repository.split('/')[1] ?? '');

function deployLabel(kind: SiteKind): string {
  if (kind === 'preview') return t('project.overview.preview');
  return props.branch ? t('project.site.branch', { branch: props.branch }) : t('project.overview.production');
}

const diffLabel = computed(() => {
  const diff = props.previewDiff;
  if (diff === null || diff.status === 'clean') return t('homolog.clean');
  if (diff.status === 'publishing') return t('homolog.publishing');
  return t('project.site.previewChanges', { count: diff.changes.length }, diff.changes.length);
});
const diffTitle = computed(() =>
  props.previewDiff?.status === 'pending' && props.previewDiff.changes.length > 0
    ? props.previewDiff.changes.map((change) => `• ${change}`).join('\n')
    : undefined,
);

function kindOf(device: SitePreviewDevice): DeviceKind {
  return device.startsWith('tablet') ? 'tablet' : device.startsWith('phone') ? 'phone' : 'desktop';
}

/** A tablet or a phone that is already shown turns around when chosen again, as in v1. */
function pick(kind: DeviceKind) {
  if (kind === 'desktop') return emit('device', 'desktop');
  const landscape: SitePreviewDevice = kind === 'tablet' ? 'tabletLandscape' : 'phoneLandscape';
  const portrait: SitePreviewDevice = kind === 'tablet' ? 'tabletPortrait' : 'phonePortrait';
  if (props.device === landscape) emit('device', portrait);
  else if (props.device === portrait) emit('device', landscape);
  else emit('device', kind === 'tablet' ? landscape : portrait);
}

function deviceLabel(option: (typeof DEVICES)[number]): string {
  const name = t(option.label);
  return option.kind !== 'desktop' && kindOf(props.device) === option.kind ? t('project.site.rotate', { device: name }) : name;
}

/** A deep link opens the view with the bar already down. */
const instant = ref(false);
let instantTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  if (!props.open) return;
  instant.value = true;
  instantTimer = setTimeout(() => {
    instant.value = false;
  }, 1000);
});

onBeforeUnmount(() => clearTimeout(instantTimer));

defineExpose({
  /** Into the view, after it opens. */
  focus: () => logo.value?.focus({ preventScroll: true }),
  /** Back to the chat button, after the chat closes. */
  focusChat: () => root.value?.querySelector<HTMLElement>('[data-site-chat]')?.focus({ preventScroll: true }),
});
</script>

<style scoped>
.site-bar {
  position: fixed;
  top: -64px;
  right: 0;
  left: 0;
  z-index: 201;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 64px;
  padding-right: 16px;
  font-size: 12px;
  line-height: 14px;
  background: linear-gradient(180deg, #20333e 0%, #0e171d 100%);
  transition: top 1s linear;
}

.site-bar.is-open {
  top: 0;
}

.site-bar.is-instant {
  transition-duration: 0s;
}

.site-bar__logo {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 150px;
  height: 100%;
  padding: 0;
  border: none;
  background: radial-gradient(150px 250px at 0 50%, transparent 69%, hsl(0 0% 0% / 0.25) 100%);
  cursor: pointer;
}

.site-bar__logo :deep(svg) {
  height: 28px;
}

.site-bar__crumbs {
  flex-shrink: 0;
  margin: 0;
  white-space: nowrap;
}

.site-bar__crumb::before {
  content: "/ ";
}

.site-bar__crumb {
  margin-left: 0.4em;
}

.site-bar__crumb:last-child::after {
  content: " /";
}

.site-bar__deploy {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
  min-width: 250px;
}

.site-bar__deploy-view {
  display: flex;
  align-items: center;
  height: 30px;
  padding-right: 12px;
  border: 2px solid var(--bohr-color-steel);
  border-radius: 34px;
  font-weight: 700;
  background: var(--bohr-color-steel);
}

.site-bar__deploy-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 12px;
  border-radius: 50%;
  background: var(--bohr-color-amber);
}

.site-bar__deploy-text {
  flex-grow: 1;
}

/* The native select over the pill: it takes the clicks and the keyboard */
.site-bar__select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.site-bar__select:disabled {
  cursor: default;
}

.site-bar__deploy:has(.site-bar__select:focus-visible) .site-bar__deploy-view {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

.site-bar__diff {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-weight: 700;
  white-space: nowrap;
  color: hsl(0 0% 100% / 0.75);
}

.site-bar__diff-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(0 0% 100% / 0.45);
}

.site-bar__diff.is-pending {
  color: var(--bohr-color-amber);
}

.site-bar__diff.is-pending .site-bar__diff-dot {
  background: var(--bohr-color-amber);
  box-shadow: 0 0 8px var(--bohr-color-amber);
}

.site-bar__diff.is-publishing .site-bar__diff-dot {
  background: var(--bohr-color-green);
}

.site-bar__devices {
  justify-content: center;
  margin-inline: auto;
}

.site-bar__device {
  display: grid;
  place-items: center;
  width: 40px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--bohr-radius-sm);
  color: hsl(0 0% 100% / 0.45);
  background: none;
  cursor: pointer;
  transition: color var(--bohr-transition);
}

.site-bar__device:hover,
.site-bar__device.is-selected {
  color: #fff;
}

.site-bar__device.is-selected {
  background: hsl(0 0% 100% / 0.08);
}

.site-bar__actions {
  margin-left: auto;
}

.site-bar__devices + .site-bar__actions {
  margin-left: 0;
}

/* v1's .left__divider: a thin bar before each group */
.site-bar__divided {
  display: flex;
  align-items: center;
  gap: 16px;
}

.site-bar__divided::before {
  content: "";
  flex-shrink: 0;
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: #fff;
  opacity: 0.15;
}

.site-bar__round {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--bohr-radius-full);
  color: #fff;
  background: none;
  cursor: pointer;
  transition: transform var(--bohr-transition);
}

.site-bar__round:hover,
.site-bar__round:focus-visible {
  transform: scale(1.08);
}

.site-bar__round--open {
  background-color: var(--bohr-color-amber);
}

.site-bar button:focus-visible,
.site-bar a:focus-visible {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .site-bar {
    transition: none;
  }
}

/* Smaller screens keep the way back, the deployment and the actions */
@media (max-width: 1023px) {
  .site-bar__crumbs,
  .site-bar__devices {
    display: none;
  }

  .site-bar__logo {
    width: 72px;
  }

  .site-bar__deploy {
    min-width: 0;
  }
}

@media (max-width: 559px) {
  .site-bar {
    gap: 8px;
  }

  .site-bar__deploy-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .site-bar__deploy {
    flex-shrink: 1;
    min-width: 0;
  }

  .site-bar__divided::before {
    display: none;
  }

  /* Only the dot on phones; its text stays for screen readers and the tooltip */
  .site-bar__diff-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
