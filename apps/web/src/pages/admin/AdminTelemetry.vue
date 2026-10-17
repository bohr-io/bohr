<template>
  <div class="stack admin-telemetry">
    <ErrorState v-if="telemetry === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
    <div v-else-if="telemetry === null" aria-busy="true">
      <BohrSkeleton class="admin-telemetry__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <p v-else-if="!telemetry.available" class="notice" data-notice="unavailable">{{ t('admin.telemetry.unavailable') }}</p>

    <SettingsCard v-else data-card="telemetry">
      <div class="admin-telemetry__heading">
        <h2 class="card-title">{{ t('admin.telemetry.title') }}</h2>
        <span v-if="telemetry.enabled" class="badge badge--green">{{ t('admin.telemetry.on') }}</span>
        <span v-else class="badge">{{ t('admin.telemetry.off') }}</span>
      </div>
      <p class="card-text">{{ t('admin.telemetry.text') }}</p>
      <ul class="admin-telemetry__points">
        <li>{{ t('admin.telemetry.anonymous') }}</li>
        <li>{{ t('admin.telemetry.optIn') }}</li>
        <li>{{ t('admin.telemetry.daily') }}</li>
        <li>{{ t('admin.telemetry.exactly') }}</li>
      </ul>

      <div class="admin-telemetry__switch">
        <BohrSwitch
          :model-value="telemetry.enabled"
          :label="t('admin.telemetry.switch')"
          :disabled="saving || telemetry.forcedOff === true"
          name="telemetry"
          @update:model-value="toggle"
        />
      </div>
      <p v-if="telemetry.forcedOff" class="notice" data-notice="forced-off">{{ t('admin.telemetry.forcedOff') }}</p>

      <dl class="facts admin-telemetry__facts">
        <div>
          <dt>{{ t('admin.telemetry.instanceId') }}</dt>
          <dd><code class="inline-code">{{ telemetry.instanceId }}</code></dd>
        </div>
        <div>
          <dt>{{ t('admin.telemetry.lastSent') }}</dt>
          <dd>{{ telemetry.lastSentAt ? formatDateTime(telemetry.lastSentAt, locale) : t('admin.telemetry.never') }}</dd>
        </div>
        <div>
          <dt>{{ t('admin.telemetry.endpoint') }}</dt>
          <dd><code class="inline-code">{{ telemetry.endpoint }}</code></dd>
        </div>
      </dl>

      <h3 class="admin-telemetry__payload-title">{{ t('admin.telemetry.payload') }}</h3>
      <pre class="admin-telemetry__payload" data-payload>{{ JSON.stringify(telemetry.payload, null, 2) }}</pre>

      <p class="card-text admin-telemetry__docs">
        <a :href="DOCS_URL" class="text-link" target="_blank" rel="noopener noreferrer">{{ t('admin.telemetry.docs') }}</a>
      </p>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import { BohrSkeleton, BohrSwitch, SettingsCard, useToast } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Telemetry } from '../../api';
import ErrorState from '../../components/ErrorState.vue';
import { useErrorText, useErrorToast } from '../../composables/useErrorText';
import { formatDateTime } from '../../lib/format';

const DOCS_URL = 'https://github.com/bohr-io/bohr#telemetry';

const { t, locale } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();

const telemetry = ref<Telemetry | null>(null);
const loadError = ref<unknown>(null);
const saving = ref(false);

async function load() {
  loadError.value = null;
  try {
    telemetry.value = await api.telemetry();
  } catch (caught) {
    loadError.value = caught;
  }
}

async function toggle(enabled: boolean) {
  if (saving.value) return;
  saving.value = true;
  try {
    telemetry.value = await api.setTelemetry(enabled);
    toast.success(enabled ? t('admin.telemetry.enabled') : t('admin.telemetry.disabled'));
  } catch (caught) {
    showError(caught);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.admin-telemetry__skeleton {
  width: 100%;
  height: 420px;
}

.admin-telemetry__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.admin-telemetry__points {
  display: grid;
  gap: 6px;
  margin: 12px 0 0;
  padding-left: 20px;
  font-size: 15px;
  line-height: 1.55;
}

.admin-telemetry__switch,
.admin-telemetry__facts {
  margin-top: 24px;
}

.admin-telemetry__payload-title {
  margin-top: 24px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.admin-telemetry__payload {
  margin-top: 8px;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-sm);
  font-family: var(--bohr-font-family-mono);
  font-size: 13px;
  line-height: 1.5;
  background: hsl(0 0% 0% / 0.3);
}

.admin-telemetry__docs {
  margin-top: 16px;
}
</style>
