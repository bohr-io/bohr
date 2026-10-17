<template>
  <div class="error-state notice notice--error" role="alert">
    <strong class="notice__title">{{ title ?? t('errors.title') }}</strong>
    <p>{{ message }}</p>
    <BohrButton v-if="retryable" size="sm" variant="ghost" class="error-state__retry" @click="emit('retry')">
      {{ t('common.retry') }}
    </BohrButton>
  </div>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { useI18n } from 'vue-i18n';

withDefaults(
  defineProps<{
    message: string;
    title?: string;
    retryable?: boolean;
  }>(),
  { retryable: true },
);

const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<style scoped>
.error-state__retry {
  margin-top: 12px;
}
</style>
