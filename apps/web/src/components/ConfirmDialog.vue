<template>
  <ModalBase
    :open="open"
    :labelledby="titleId"
    with-close-button
    :close-label="t('common.close')"
    :close-on-backdrop="!busy"
    max-width="min(520px, calc(100vw - 32px))"
    @close="cancel"
  >
    <div class="confirm">
      <h2 :id="titleId" class="confirm__title">{{ title }}</h2>
      <div class="confirm__text">
        <slot />
      </div>
      <div class="confirm__actions">
        <BohrButton variant="text" color="black" :disabled="busy" @click="cancel">
          {{ t('common.cancel') }}
        </BohrButton>
        <BohrButton :danger="danger" :disabled="busy || confirmDisabled" @click="emit('confirm')">
          {{ busy ? t('common.working') : confirmLabel }}
        </BohrButton>
      </div>
    </div>
  </ModalBase>
</template>

<script setup lang="ts">
import { BohrButton, ModalBase } from '@bohr/ui';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  open: boolean;
  title: string;
  confirmLabel: string;
  /** Red confirm button, for destructive actions. */
  danger?: boolean;
  /** The action is running: buttons are disabled and the dialog stays open. */
  busy?: boolean;
  /** The confirm button waits for something in the dialog (a typed name). */
  confirmDisabled?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useI18n();
const titleId = `confirm-${useId()}`;

function cancel() {
  if (!props.busy) emit('cancel');
}
</script>

<style scoped>
.confirm {
  display: grid;
  gap: 16px;
  max-width: 420px;
}

.confirm__title {
  padding-right: 32px;
  font-size: 22px;
  line-height: 1.25;
}

.confirm__text {
  font-size: 15px;
  line-height: 1.55;
  color: hsl(0 0% 20%);
}

.confirm__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
