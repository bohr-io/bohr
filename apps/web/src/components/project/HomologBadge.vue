<template>
  <span class="homolog-badge" :class="`homolog-badge--${status}`">
    <StatusIndicator :status="indicator.status" :label="t(indicator.label)" />
    <span aria-hidden="true">{{ t(indicator.label) }}</span>
    <span v-if="status === 'pending'" class="homolog-badge__version">{{ t('homolog.version', { version }) }}</span>
  </span>
</template>

<script setup lang="ts">
import type { HomologStatus } from '@bohr/shared';
import { StatusIndicator } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { HOMOLOG_INDICATORS } from '../../lib/status';

const props = defineProps<{
  status: HomologStatus;
  version: number;
}>();

const { t } = useI18n();
const indicator = computed(() => HOMOLOG_INDICATORS[props.status]);
</script>

<style scoped>
.homolog-badge {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 8px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: var(--bohr-radius-full);
  font-size: 13px;
  font-weight: 700;
  background: hsl(0 0% 0% / 0.25);
}

.homolog-badge--pending {
  border-color: hsl(var(--bohr-hsl-amber) / 0.45);
}

.homolog-badge--publishing {
  border-color: hsl(var(--bohr-hsl-green) / 0.45);
}

.homolog-badge__version {
  font-weight: 400;
  color: var(--bohr-color-text-muted);
}
</style>
