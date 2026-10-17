<template>
  <div class="runtime-progress">
    <template v-if="runtime?.status === 'error'">
      <div class="notice notice--error" role="alert">
        <strong class="notice__title">{{ t('runtime.failed') }}</strong>
        <p v-if="runtime.error">{{ runtime.error }}</p>
      </div>
      <div class="actions runtime-progress__actions">
        <BohrButton :disabled="retrying" @click="retry">
          {{ retrying ? t('common.working') : t('common.retry') }}
        </BohrButton>
      </div>
    </template>
    <template v-else>
      <LoadingAnimation class="runtime-progress__animation" :steps="steps" :step-interval="8000" logo-size="120px" />
      <p class="field-hint runtime-progress__status" role="status">
        {{ t(`runtime.status.${runtime?.status ?? 'pending'}`) }}
      </p>
    </template>
    <p v-if="pollError !== null" class="field-error">{{ pollError }}</p>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, LoadingAnimation } from '@bohr/ui';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Runtime } from '../api';
import { useErrorText } from '../composables/useErrorText';
import { createPoller } from '../lib/poller';

/** How often the runtime status is checked while it is being set up. */
const POLL_MS = 3_000;

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ ready: [runtime: Runtime] }>();

const { t } = useI18n();
const errorText = useErrorText();
const runtime = ref<Runtime | null>(null);
const pollError = ref<string | null>(null);
const retrying = ref(false);

const steps = computed(() => [
  t('runtime.steps.worker'),
  t('runtime.steps.sandbox'),
  t('runtime.steps.preview'),
  t('runtime.steps.almost'),
]);

const poller = createPoller(
  async () => {
    try {
      const current = await api.runtime(props.projectId);
      runtime.value = current;
      pollError.value = null;
      if (current.status === 'ready') {
        poller.stop();
        emit('ready', current);
      } else if (current.status === 'error') {
        poller.stop();
      }
    } catch (caught) {
      pollError.value = errorText(caught);
    }
  },
  () => POLL_MS,
);

async function retry() {
  retrying.value = true;
  try {
    await api.retryRuntime(props.projectId);
    if (runtime.value !== null) runtime.value = { ...runtime.value, status: 'provisioning', error: null };
    poller.start();
  } catch (caught) {
    pollError.value = errorText(caught);
  } finally {
    retrying.value = false;
  }
}

onMounted(() => poller.start());
onBeforeUnmount(() => poller.stop());
</script>

<style scoped>
.runtime-progress {
  margin-top: 16px;
}

.runtime-progress__animation :deep(.bohr-loading__step) {
  font-size: clamp(20px, 3vw, 28px);
}

.runtime-progress__animation :deep(.bohr-loading__logo) {
  margin-top: 32px;
}

.runtime-progress__status {
  text-align: center;
}

.runtime-progress__actions {
  margin-top: 16px;
}
</style>
