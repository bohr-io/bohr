<template>
  <div class="telegram-link">
    <div class="actions">
      <BohrButton v-if="url === null" :variant="variant" :disabled="loading" @click="create">
        {{ loading ? t('common.working') : t('telegramLink.create') }}
      </BohrButton>
      <BohrButton v-else :href="url" target="_blank" rel="noopener noreferrer">
        <template #iconLeft><NewWindowIcon :size="12" /></template>
        {{ t('telegramLink.open') }}
      </BohrButton>
      <slot />
    </div>
    <p v-if="url !== null" class="field-hint" role="status">{{ t('telegramLink.hint') }}</p>
    <p v-if="error !== null" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, NewWindowIcon } from '@bohr/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api } from '../api';
import { useErrorText } from '../composables/useErrorText';

withDefaults(defineProps<{ variant?: 'default' | 'ghost' }>(), { variant: 'default' });

const { t } = useI18n();
const errorText = useErrorText();
// A one-time deep link to the platform bot, valid for a few minutes. Opening it is a separate click,
// so no popup blocker gets in the way.
const url = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function create() {
  loading.value = true;
  error.value = null;
  try {
    url.value = (await api.telegramLink()).url;
  } catch (caught) {
    error.value =
      caught instanceof ApiError && caught.status === 404 ? t('telegramLink.unavailable') : errorText(caught);
  } finally {
    loading.value = false;
  }
}
</script>
