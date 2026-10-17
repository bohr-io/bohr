<template>
  <span class="copy-button">
    <BohrButton size="sm" variant="ghost" color="secondary" @click="copy">
      <template #iconLeft>
        <CheckIcon v-if="copied" :size="12" />
        <CopyIcon v-else :size="12" />
      </template>
      {{ copied ? t('common.copied') : (label ?? t('common.copy')) }}
    </BohrButton>
    <span class="bohr-visually-hidden" aria-live="polite">{{ copied ? t('common.copied') : '' }}</span>
  </span>
</template>

<script setup lang="ts">
import { BohrButton, CheckIcon, useToast } from '@bohr/ui';
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CopyIcon } from './icons';

const props = defineProps<{
  value: string;
  label?: string;
}>();

const { t } = useI18n();
const toast = useToast();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    toast.error(t('common.copyFailed'));
  }
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.copy-button {
  display: inline-flex;
}
</style>
