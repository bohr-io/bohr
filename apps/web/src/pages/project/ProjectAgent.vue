<template>
  <RuntimeGate v-slot="{ state }">
    <ChatPanel
      class="project-agent__chat"
      :feed="feed"
      :project="state"
      :actions="actions"
      @decide="requestDecision"
      @preview="openPreview"
    />
  </RuntimeGate>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import ChatPanel from '../../components/chat/ChatPanel.vue';
import RuntimeGate from '../../components/project/RuntimeGate.vue';
import { useProject } from '../../composables/useProject';

// The conversation with the agent: the only sub-page with the chat.
const router = useRouter();
const { id, feed, actions, requestDecision, previewReady, explainNoPreview } = useProject();

/**
 * The preview in the overview's full-screen view, with this chat beside it; a toast says why there is none yet.
 * A navigation that fails (its code went stale with a deploy) is the router's onError's.
 */
function openPreview() {
  if (!previewReady.value) return explainNoPreview();
  router.push({ name: 'project-site', params: { id }, query: { deploy: 'preview', chat: '1' } }).catch(() => {});
}
</script>

<style scoped>
.project-agent__chat {
  height: max(520px, calc(100dvh - 260px));
}
</style>
