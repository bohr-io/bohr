<template>
  <li class="entry" :class="[`entry--${entry.kind}`, { 'entry--decision': isDecision, 'is-active': decisionActive }]">
    <p v-if="entry.kind === 'system'" class="entry__system">
      <LinkifiedText :text="entry.text" />
      <time class="entry__time" :datetime="entry.at" :title="fullTime">{{ time }}</time>
    </p>

    <p v-else-if="entry.kind === 'progress'" class="entry__progress">
      <LinkifiedText :text="entry.text" />
      <time class="entry__time" :datetime="entry.at" :title="fullTime">{{ time }}</time>
    </p>

    <template v-else>
      <p class="entry__meta">
        <span class="entry__author">{{ author }}</span>
        <time class="entry__time" :datetime="entry.at" :title="fullTime">{{ time }}</time>
      </p>
      <div class="entry__bubble">
        <p v-if="decisionActive" class="entry__decision-title">{{ t('chat.decisionTitle', { version }) }}</p>
        <p class="entry__text"><LinkifiedText :text="entry.text" /></p>

        <div v-if="decisionActive" class="entry__actions">
          <BohrButton size="sm" color="secondary" :disabled="busy !== null" @click="emit('decide', 'approve')">
            {{ busy === 'approve' ? t('common.working') : t('chat.approve') }}
          </BohrButton>
          <BohrButton size="sm" variant="ghost" danger :disabled="busy !== null" @click="emit('decide', 'discard')">
            {{ busy === 'discard' ? t('common.working') : t('chat.discard') }}
          </BohrButton>
          <BohrButton size="sm" variant="text" @click="emit('preview')">{{ t('chat.viewPreview') }}</BohrButton>
          <BohrButton v-if="diffUrl" size="sm" variant="text" :href="diffUrl" target="_blank" rel="noopener noreferrer">
            {{ t('chat.viewDiff') }}
          </BohrButton>
        </div>
        <p v-else-if="isDecision" class="entry__closed">{{ t('chat.decisionClosed') }}</p>

        <div v-if="questionActive" class="entry__actions" role="group" :aria-label="t('chat.options')">
          <BohrButton
            v-for="(option, index) in entry.options"
            :key="index"
            size="sm"
            variant="ghost"
            color="secondary"
            :disabled="busy !== null"
            @click="emit('answer', index)"
          >
            {{ option }}
          </BohrButton>
        </div>

        <div v-if="cancelActive" class="entry__actions">
          <BohrButton size="sm" variant="text" danger :disabled="busy !== null" @click="emit('cancel')">
            {{ t('chat.cancelRequest') }}
          </BohrButton>
        </div>
      </div>
    </template>
  </li>
</template>

<script setup lang="ts">
import type { ChatEntry } from '@bohr/shared';
import { BohrButton } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime, formatTime } from '../../lib/format';
import LinkifiedText from '../LinkifiedText.vue';

const props = defineProps<{
  entry: ChatEntry;
  /** Member key of the reader, to label their own messages. */
  youKey: string;
  /** Preview version the approve/discard buttons decide on. */
  version: number;
  /** GitHub's diff of what approving publishes. */
  diffUrl: string | null;
  decisionActive: boolean;
  questionActive: boolean;
  cancelActive: boolean;
  /** Action in progress anywhere in the chat; buttons wait for it. */
  busy: string | null;
}>();

const emit = defineEmits<{
  decide: [action: 'approve' | 'discard'];
  answer: [option: number];
  cancel: [];
  preview: [];
}>();

const { t, locale } = useI18n();

const isDecision = computed(() => props.entry.actions.includes('approve') || props.entry.actions.includes('discard'));
const author = computed(() => {
  if (props.entry.kind === 'agent') return t('chat.agent');
  if (props.entry.author === null) return t('chat.someone');
  return props.entry.author.key === props.youKey ? t('chat.you') : props.entry.author.name;
});
const time = computed(() => formatTime(props.entry.at, locale.value));
const fullTime = computed(() => formatDateTime(props.entry.at, locale.value));
</script>

<style scoped>
.entry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.entry--user {
  align-items: flex-end;
}

.entry__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 4px 4px;
  font-size: 12px;
}

.entry__author {
  font-weight: 700;
}

.entry__time {
  font-size: 11px;
  color: var(--bohr-color-text-subtle);
}

.entry__bubble {
  max-width: min(620px, 92%);
  padding: 12px 16px;
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 18px 18px 18px 6px;
  font-size: 15px;
  line-height: 1.5;
  background: hsl(0 0% 100% / 0.07);
}

.entry--user .entry__bubble {
  border: none;
  border-radius: 18px 18px 6px;
  background: linear-gradient(180deg, #3b6680 0%, #2b4a5d 100%);
}

.entry__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* A preview ready for review: the decision card. */
.entry--decision.is-active .entry__bubble {
  border-color: hsl(var(--bohr-hsl-orange) / 0.6);
  background:
    radial-gradient(120% 120% at 0% 0%, hsl(var(--bohr-hsl-orange) / 0.14) 0%, transparent 60%),
    hsl(0 0% 100% / 0.07);
  box-shadow: 0 16px 40px -24px rgb(241 105 35 / 0.7);
}

.entry__decision-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bohr-color-amber);
}

.entry__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.entry__closed {
  margin-top: 8px;
  font-size: 12px;
  color: var(--bohr-color-text-subtle);
}

.entry__system {
  align-self: center;
  max-width: 92%;
  padding: 6px 14px;
  border-radius: var(--bohr-radius-full);
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--bohr-color-text-muted);
  background: hsl(0 0% 0% / 0.3);
}

.entry__system .entry__time,
.entry__progress .entry__time {
  margin-left: 6px;
}

.entry__progress {
  max-width: 92%;
  margin-left: 4px;
  padding-left: 14px;
  border-left: 2px solid hsl(var(--bohr-hsl-cyan) / 0.4);
  font-size: 13px;
  font-style: italic;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--bohr-color-text-muted);
}
</style>
