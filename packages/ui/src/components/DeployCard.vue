<template>
  <article class="bohr-deploy-card" :aria-busy="loading || undefined">
    <div class="bohr-deploy-card__status">
      <BohrSkeleton :loading="loading" radius="circle" height="17px" width="17px">
        <StatusIndicator :status="status" :label="statusLabel" />
      </BohrSkeleton>
    </div>

    <div class="bohr-deploy-card__identification">
      <div class="bohr-deploy-card__title">
        <BohrSkeleton :loading="loading" inline>
          <BohrTypography tag="p" variant="subtitle2">{{ name }}</BohrTypography>
        </BohrSkeleton>
        <BohrSkeleton v-if="type" :loading="loading" inline>
          <span class="bohr-deploy-card__tag">{{ type }}</span>
        </BohrSkeleton>
      </div>
      <div class="bohr-deploy-card__commit">
        <BohrTypography tag="p" variant="body3" color="var(--bohr-color-text-subtle)">
          <BohrSkeleton :loading="loading" inline>
            {{ text.updated }} {{ relativeTime }} {{ text.by }}
            <span class="bohr-deploy-card__highlight">{{ author || '------' }}</span>
          </BohrSkeleton>
        </BohrTypography>
        <BohrTypography tag="p" variant="body3" color="var(--bohr-color-text-subtle)">
          <BohrSkeleton :loading="loading" inline>
            {{ text.hash }}: <span class="bohr-deploy-card__highlight">{{ hash?.slice(0, 7) || '------' }}</span>
          </BohrSkeleton>
        </BohrTypography>
      </div>
    </div>

    <div class="bohr-deploy-card__buttons">
      <BohrSkeleton :loading="loading" inline>
        <BohrButton
          variant="ghost"
          size="sm"
          class="bohr-deploy-card__button"
          :href="logsHref"
          :disabled="!logsHref"
          target="_blank"
          rel="noreferrer"
        >
          {{ text.viewLogs }}
        </BohrButton>
      </BohrSkeleton>
      <BohrSkeleton :loading="loading" inline>
        <BohrButton
          v-if="projectHref"
          size="sm"
          class="bohr-deploy-card__button"
          :href="projectHref"
          target="_blank"
          rel="noreferrer"
        >
          {{ text.viewProject }}
        </BohrButton>
        <BohrButton v-else size="sm" class="bohr-deploy-card__button" @click="emit('viewProject')">
          {{ text.viewProject }}
        </BohrButton>
      </BohrSkeleton>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DeployCardLabels, DeployStatus } from '../types';
import BohrButton from './BohrButton.vue';
import BohrSkeleton from './BohrSkeleton.vue';
import BohrTypography from './BohrTypography.vue';
import StatusIndicator from './StatusIndicator.vue';

const props = withDefaults(
  defineProps<{
    name?: string;
    /** Small tag next to the name, e.g. BRANCH. */
    type?: string;
    status?: DeployStatus;
    statusLabel?: string;
    author?: string;
    hash?: string;
    updatedAt?: string | number | Date;
    /** Locale for the relative date. */
    locale?: string;
    logsHref?: string;
    /** When missing, "view project" emits `viewProject` instead of linking. */
    projectHref?: string;
    loading?: boolean;
    labels?: Partial<DeployCardLabels>;
  }>(),
  { name: '', status: 'off', locale: 'en', labels: () => ({}) },
);

const emit = defineEmits<{ viewProject: [] }>();

const DEFAULT_LABELS: DeployCardLabels = {
  updated: 'Updated',
  by: 'by',
  hash: 'Hash',
  viewLogs: 'View logs',
  viewProject: 'View project',
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

const text = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }));

// Replaces v1's javascript-time-ago dependency with Intl.
const relativeTime = computed(() => {
  if (props.updatedAt === undefined) return '';
  const date = new Date(props.updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = (date.getTime() - Date.now()) / 1000;
  const [unit, size] = UNITS.find(([, unitSize]) => Math.abs(seconds) >= unitSize) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(props.locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
});
</script>

<style scoped>
.bohr-deploy-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 22px;
  margin-inline: 20px;
  padding-block: 24px;
  padding-left: 10px;
}

.bohr-deploy-card + .bohr-deploy-card {
  border-top: 1px solid rgb(255 255 255 / 0.1);
}

.bohr-deploy-card__status {
  display: flex;
  align-items: center;
}

.bohr-deploy-card__identification {
  display: flex;
  flex-grow: 1;
  align-items: center;
  gap: 7px;
}

.bohr-deploy-card__title {
  display: flex;
  align-items: center;
  gap: 7px;
}

.bohr-deploy-card__tag {
  display: inline-block;
  padding: 3px 6px;
  border: 1px solid rgb(255 255 255 / 0.6);
  border-radius: var(--bohr-radius-xs);
  font-size: 8px;
  font-weight: 700;
  line-height: 9px;
  text-align: center;
  text-transform: uppercase;
  background: rgb(0 0 0 / 0.6);
}

.bohr-deploy-card__commit {
  margin-left: auto;
  text-align: center;
}

.bohr-deploy-card__highlight {
  font-weight: 700;
  color: var(--bohr-color-amber);
}

.bohr-deploy-card__buttons {
  display: flex;
  align-items: center;
  gap: 5px;
}

.bohr-deploy-card__button {
  min-width: 100px;
}

@media (max-width: 767px) {
  .bohr-deploy-card {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      "status info"
      "status buttons";
  }

  .bohr-deploy-card__status {
    grid-area: status;
  }

  .bohr-deploy-card__identification {
    grid-area: info;
    flex-direction: column;
    align-items: flex-start;
  }

  .bohr-deploy-card__buttons {
    grid-area: buttons;
    flex-wrap: wrap;
  }

  .bohr-deploy-card__commit {
    margin-left: 0;
    text-align: left;
  }
}
</style>
