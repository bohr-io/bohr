<template>
  <form class="composer" @submit.prevent="submit">
    <label :for="id" class="bohr-visually-hidden">{{ t('chat.composerLabel') }}</label>
    <div class="composer__row">
      <textarea
        :id="id"
        ref="textarea"
        v-model="text"
        class="control composer__input"
        rows="1"
        :maxlength="MAX_MESSAGE_LENGTH"
        :placeholder="disabled ? '' : t('chat.placeholder')"
        :disabled="disabled"
        :aria-describedby="`${id}-hint`"
        @keydown="onKeydown"
        @input="resize"
      />
      <BohrButton type="submit" class="composer__send" :disabled="disabled || sending || text.trim() === ''">
        <template #iconLeft><SendIcon :size="12" /></template>
        {{ sending ? t('chat.sending') : t('chat.send') }}
      </BohrButton>
    </div>
    <p :id="`${id}-hint`" class="composer__hint" :class="{ 'is-warning': disabled }">
      {{ disabled ? disabledReason : t('chat.hint') }}
    </p>
  </form>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { nextTick, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MAX_MESSAGE_LENGTH } from '../../lib/validation';
import { SendIcon } from '../icons';

const props = defineProps<{
  disabled: boolean;
  /** Shown instead of the keyboard hint while the composer is disabled. */
  disabledReason: string;
  sending: boolean;
}>();

const emit = defineEmits<{ send: [text: string] }>();
const text = defineModel<string>({ required: true });

const { t } = useI18n();
const id = `composer-${useId()}`;
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');

/** Grows with the text, up to a limit; then it scrolls. */
function resize() {
  const element = textarea.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight + 2, 220)}px`;
}

function submit() {
  const value = text.value.trim();
  if (props.disabled || props.sending || value === '') return;
  emit('send', value);
}

// Enter sends, Shift+Enter breaks the line. Keys pressed while composing text (IME) are left alone.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  submit();
}

// Cleared after sending: shrink back.
watch(text, () => nextTick(resize));

defineExpose({ focus: () => textarea.value?.focus() });
</script>

<style scoped>
.composer {
  padding: 12px 16px 14px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
  background: hsl(0 0% 0% / 0.25);
}

.composer__row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.composer__input {
  flex: 1;
  min-height: 44px;
  max-height: 220px;
  font-size: 15px;
  line-height: 1.45;
  resize: none;
}

.composer__send {
  flex-shrink: 0;
  min-height: 44px;
}

.composer__hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--bohr-color-text-subtle);
}

.composer__hint.is-warning {
  font-size: 13px;
  color: var(--bohr-color-amber);
}

@media (max-width: 479px) {
  .composer__send {
    padding-inline: 14px;
  }
}
</style>
