<template>
  <section class="chat" :aria-labelledby="`${id}-title`">
    <header class="chat__header">
      <h2 :id="`${id}-title`" class="chat__title">{{ t('chat.title') }}</h2>
      <span v-if="feed.state.error !== null" class="badge badge--amber" role="status">{{ t('chat.reconnecting') }}</span>
    </header>

    <div ref="scroller" class="chat__scroller" @scroll="onScroll">
      <div v-if="feed.state.hasOlder" class="chat__older">
        <BohrButton size="sm" variant="text" :disabled="feed.state.loadingOlder" @click="loadOlder">
          {{ feed.state.loadingOlder ? t('common.loading') : t('chat.loadOlder') }}
        </BohrButton>
      </div>

      <div v-if="entries.length === 0" class="chat__empty">
        <BohrLogo icon-only class="chat__empty-logo" />
        <p class="chat__empty-title">{{ t('chat.emptyTitle') }}</p>
        <p class="chat__empty-text">{{ t('chat.emptyText') }}</p>
        <template v-if="canImport">
          <p class="chat__empty-text">{{ t('chat.importText') }}</p>
          <BohrButton size="sm" :disabled="importing" @click="startImport">
            {{ importing ? t('common.working') : t('chat.import') }}
          </BohrButton>
        </template>
      </div>

      <div v-else role="log" :aria-label="t('chat.log')" aria-relevant="additions">
        <ol class="chat__entries" role="list">
          <ChatEntryItem
            v-for="entry in entries"
            :key="entry.seq"
            :entry="entry"
            :you-key="project.you.key"
            :version="project.homolog.version"
            :diff-url="previewDiffUrl(project)"
            :decision-active="entry.seq === activeDecision"
            :question-active="entry.seq === activeQuestion"
            :cancel-active="entry.actions.includes('cancel') && canCancel(project, entry.requestId)"
            :busy="actions.busy.value"
            @decide="(action) => emit('decide', action)"
            @answer="(option) => actions.answer(entry, option)"
            @cancel="entry.requestId !== null && actions.cancel(entry.requestId)"
            @preview="emit('preview')"
          />
        </ol>
      </div>
    </div>

    <div v-if="project.current !== null" class="chat__working">
      <BohrAnimatedLogo class="chat__spinner" />
      <div class="chat__working-text">
        <p class="chat__working-title">{{ t('chat.working') }}</p>
        <p class="chat__working-progress">{{ project.current.progress ?? t('chat.workingDefault') }}</p>
      </div>
      <BohrButton
        v-if="canCancel(project, project.current.id)"
        size="sm"
        variant="text"
        danger
        :disabled="actions.busy.value !== null"
        @click="project.current !== null && actions.cancel(project.current.id)"
      >
        {{ t('chat.cancelRequest') }}
      </BohrButton>
    </div>
    <p v-if="project.queue.length > 0 || project.homolog.status === 'publishing'" class="chat__status">
      <span v-if="project.queue.length > 0">{{ t('chat.queue', { count: project.queue.length }) }}</span>
      <span v-if="project.homolog.status === 'publishing'">{{ t('chat.publishing') }}</span>
    </p>

    <ChatComposer
      v-model="draft"
      :disabled="!project.project.agentEnabled"
      :disabled-reason="project.you.role === 'owner' ? t('chat.agentOffOwner') : t('chat.agentOffMember')"
      :sending="sending"
      @send="send"
    />
  </section>
</template>

<script setup lang="ts">
import type { ProjectState } from '@bohr/shared';
import { BohrAnimatedLogo, BohrButton, BohrLogo, usePrefersReducedMotion, useToast } from '@bohr/ui';
import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProjectActions } from '../../chat/actions';
import { activeDecisionSeq, activeQuestionSeq, canCancel, previewDiffUrl } from '../../chat/decisions';
import type { ChatFeed } from '../../chat/feed';
import { useErrorToast } from '../../composables/useErrorText';
import ChatComposer from './ChatComposer.vue';
import ChatEntryItem from './ChatEntryItem.vue';

const props = defineProps<{
  feed: ChatFeed;
  /** Loaded state of the project (the page shows the chat only once it is). */
  project: ProjectState;
  actions: ProjectActions;
}>();

const emit = defineEmits<{ decide: [action: 'approve' | 'discard']; preview: [] }>();

const { t } = useI18n();
const toast = useToast();
const showError = useErrorToast();
const reducedMotion = usePrefersReducedMotion();
const id = `chat-${useId()}`;
const scroller = useTemplateRef<HTMLElement>('scroller');

const entries = computed(() => props.feed.state.entries);
const activeDecision = computed(() => activeDecisionSeq(entries.value, props.project));
const activeQuestion = computed(() => activeQuestionSeq(entries.value));
/** An empty conversation in a project the agent has not prepared yet. */
const canImport = computed(
  () => props.project.you.role === 'owner' && props.project.project.agentEnabled && !props.feed.state.hasOlder,
);

const draft = ref('');
const sending = ref(false);
const importing = ref(false);

async function send(text: string) {
  sending.value = true;
  try {
    await props.feed.send(text);
    draft.value = '';
    stickToBottom = true;
  } catch (error) {
    showError(error);
  } finally {
    sending.value = false;
  }
}

async function startImport() {
  importing.value = true;
  try {
    const { message } = await props.feed.api.startImport();
    if (message) toast.tip(message);
    await props.feed.refresh();
  } catch (error) {
    showError(error);
  } finally {
    importing.value = false;
  }
}

// Scrolling: follow new entries while the reader is at the bottom; keep the place when older ones load.
let stickToBottom = true;
let keepingPlace = false;

function onScroll() {
  const element = scroller.value;
  if (element) stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function scrollToBottom(smooth: boolean) {
  const element = scroller.value;
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior: smooth && !reducedMotion.value ? 'smooth' : 'auto' });
}

async function loadOlder() {
  const element = scroller.value;
  const fromBottom = element ? element.scrollHeight - element.scrollTop : 0;
  keepingPlace = true;
  try {
    await props.feed.loadOlder();
    await nextTick();
    if (element) element.scrollTop = element.scrollHeight - fromBottom;
  } catch (error) {
    showError(error);
  } finally {
    keepingPlace = false;
  }
}

watch(
  () => entries.value.at(-1)?.seq,
  async (last, previous) => {
    if (keepingPlace || !stickToBottom) return;
    await nextTick();
    scrollToBottom(previous !== undefined && last !== undefined);
  },
);

onMounted(() => scrollToBottom(false));
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  background:
    radial-gradient(120% 60% at 50% 0%, hsl(203 30% 16%) 0%, transparent 70%),
    #0a1116;
}

.chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.08);
  background: rgb(0 0 0 / 0.35);
}

.chat__title {
  font-size: 15px;
}

.chat__scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
}

.chat__older {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.chat__entries {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  margin: clamp(24px, 8vh, 80px) auto;
  text-align: center;
}

.chat__empty-logo {
  width: 40px;
  height: 40px;
}

.chat__empty-title {
  font-size: 18px;
  font-weight: 700;
}

.chat__empty-text {
  font-size: 14px;
  line-height: 1.55;
  color: var(--bohr-color-text-muted);
}

.chat__working {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
  background: hsl(var(--bohr-hsl-cyan) / 0.06);
}

.chat__spinner {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
}

.chat__working-text {
  flex: 1;
  min-width: 0;
}

.chat__working-title {
  font-size: 13px;
  font-weight: 700;
}

.chat__working-progress {
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--bohr-color-text-muted);
}

.chat__status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 8px 16px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
  font-size: 13px;
  color: var(--bohr-color-amber);
}
</style>
