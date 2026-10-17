<template>
  <SettingsCard class="join">
    <h2 class="card-title">{{ t('join.title') }}</h2>
    <p class="card-text">{{ unlisted ? t('join.textUnlisted') : t('join.text') }}</p>
    <form class="form" novalidate @submit.prevent="join">
      <div class="form-field">
        <BohrTextField
          ref="field"
          v-model="code"
          :label="t('join.code')"
          :placeholder="t('join.placeholder')"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="40"
          required
          :has-error="error !== null"
          :aria-describedby="error !== null ? `${id}-error` : `${id}-hint`"
        />
        <p v-if="error !== null" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>
        <p :id="`${id}-hint`" class="field-hint">{{ t('join.hint') }}</p>
      </div>
      <div class="actions">
        <BohrButton type="submit" :disabled="joining">{{ joining ? t('common.working') : t('join.submit') }}</BohrButton>
      </div>
    </form>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField, SettingsCard, useToast } from '@bohr/ui';
import { nextTick, ref, useId, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { agentApi } from '../../api';
import { useErrorText } from '../../composables/useErrorText';

const props = defineProps<{
  projectId: string;
  /**
   * The instance answered "not found": it hides projects from non-members, so this is either a project
   * the user was invited to or one that does not exist.
   */
  unlisted?: boolean;
}>();
const emit = defineEmits<{ joined: [] }>();

const { t } = useI18n();
const route = useRoute();
const toast = useToast();
const errorText = useErrorText();
const id = `join-${useId()}`;
const field = useTemplateRef<{ focus: () => void }>('field');

// An invite link carries the code (?code=).
const code = ref(typeof route.query.code === 'string' ? route.query.code : '');
const joining = ref(false);
const error = ref<string | null>(null);

async function join() {
  const value = code.value.trim();
  error.value = null;
  if (value.length < 4) {
    error.value = t('join.tooShort');
    await nextTick();
    field.value?.focus();
    return;
  }
  joining.value = true;
  try {
    const { joined } = await agentApi(props.projectId).join(value);
    toast.success(joined ? t('join.joined') : t('join.alreadyMember'));
    emit('joined');
  } catch (caught) {
    error.value = errorText(caught);
    await nextTick();
    field.value?.focus();
  } finally {
    joining.value = false;
  }
}
</script>

<style scoped>
.join {
  max-width: 640px;
}
</style>
