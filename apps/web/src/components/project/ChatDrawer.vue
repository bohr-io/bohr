<template>
  <aside
    ref="panel"
    class="chat-drawer"
    :class="{ 'is-docked': docked }"
    :aria-label="t('project.site.chatLabel')"
    tabindex="-1"
    data-chat-drawer
    @keydown.esc.stop="emit('close')"
  >
    <div class="chat-drawer__head">
      <p class="chat-drawer__title">
        <ChatIcon :size="16" />
        <span>{{ t('project.nav.agent') }}</span>
      </p>
      <button type="button" class="chat-drawer__close" :aria-label="t('project.site.closeChat')" :title="t('project.site.closeChat')" @click="emit('close')">
        <XIcon :size="14" />
      </button>
    </div>
    <div class="chat-drawer__body">
      <!-- The agent page's gate: loading, the activation of a project that only deploys, or what went wrong -->
      <RuntimeGate v-slot="{ state }">
        <ChatPanel
          class="chat-drawer__chat"
          :feed="feed"
          :project="state"
          :actions="actions"
          @decide="requestDecision"
          @preview="emit('preview')"
        />
      </RuntimeGate>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { XIcon } from '@bohr/ui';
import { useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProject } from '../../composables/useProject';
import ChatPanel from '../chat/ChatPanel.vue';
import { ChatIcon } from '../icons';
import RuntimeGate from './RuntimeGate.vue';

// The agent page's chat in a side panel, a third of the screen wide (all of it on phones): beside the site in
// full screen, or over the overview. The same feed and actions as the agent page, from the project page.
defineProps<{
  /** Beside the full-screen view, under its bar. */
  docked: boolean;
}>();

const emit = defineEmits<{ close: []; preview: [] }>();

const { t } = useI18n();
const { feed, actions, requestDecision } = useProject();
const panel = useTemplateRef<HTMLElement>('panel');

defineExpose({ focus: () => panel.value?.focus({ preventScroll: true }) });
</script>

<style scoped>
.chat-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  width: var(--site-chat-width, 100vw);
  border-left: 1px solid hsl(0 0% 100% / 0.1);
  background: var(--bohr-color-bg);
  box-shadow: -12px 0 36px hsl(0 0% 0% / 0.45);
}

.chat-drawer.is-docked {
  top: 64px;
}

.chat-drawer:focus {
  outline: none;
}

.chat-drawer__head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 8px 0 16px;
  background: linear-gradient(180deg, #20333e 0%, #0e171d 100%);
}

.chat-drawer__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--bohr-color-cyan);
}

.chat-drawer__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--bohr-radius-full);
  color: #fff;
  background: none;
  cursor: pointer;
  transition: background-color var(--bohr-transition);
}

.chat-drawer__close:hover,
.chat-drawer__close:focus-visible {
  background-color: hsl(0 0% 100% / 0.1);
}

.chat-drawer__close:focus-visible {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

.chat-drawer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.chat-drawer__chat {
  flex: 1;
  min-height: 0;
}
</style>
