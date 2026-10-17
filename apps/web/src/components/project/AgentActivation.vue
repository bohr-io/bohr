<template>
  <SettingsCard class="activation" :data-phase="phase">
    <!-- Starts by itself: only a missing subscription or a failure stops here -->
    <!-- A self-hosted instance whose Cloudflare account cannot run the agent's sandbox (no Workers Paid) -->
    <template v-if="phase === 'intro' && needsContainers">
      <h2 class="card-title">{{ t('activation.containersTitle') }}</h2>
      <p class="card-text" data-notice="containers">{{ t('activation.containersText') }}</p>
      <div class="actions activation__actions">
        <BohrButton :disabled="enabling" @click="enable">
          {{ enabling ? t('common.working') : t('activation.checkAgain') }}
        </BohrButton>
      </div>
    </template>
    <template v-else-if="phase === 'intro'">
      <h2 class="card-title">{{ error === null ? t('activation.provisioningTitle') : t('activation.title') }}</h2>
      <p class="card-text">{{ error === null ? t('newProject.provisioning.text') : t('activation.text') }}</p>
      <p v-if="error !== null" class="field-error" role="alert">{{ error }}</p>
      <div v-if="error !== null" class="actions activation__actions">
        <BohrButton :disabled="enabling" @click="enable">
          {{ enabling ? t('common.working') : t('activation.enable') }}
        </BohrButton>
        <BohrButton v-if="needsSubscription" :as="RouterLink" to="/billing" variant="ghost">
          {{ t('activation.subscribe') }}
        </BohrButton>
      </div>
    </template>

    <template v-else-if="phase === 'provisioning'">
      <h2 class="card-title">
        {{ initialPhase === 'provisioning' ? t('newProject.provisioning.title') : t('activation.provisioningTitle') }}
      </h2>
      <p class="card-text">{{ t('newProject.provisioning.text') }}</p>
      <RuntimeProgress :project-id="projectId" @ready="onReady" />
    </template>

    <!-- The agent's provider is set once, in the account settings, for every project -->
    <template v-else-if="phase === 'agent'">
      <h2 class="card-title">{{ t('activation.agentTitle') }}</h2>
      <p class="card-text">{{ t('activation.agentText') }}</p>
      <div class="actions activation__actions">
        <BohrButton :as="RouterLink" :to="{ name: 'account-agent' }">{{ t('activation.agentLink') }}</BohrButton>
        <BohrButton variant="text" @click="emit('activated')">{{ t('activation.agentLater') }}</BohrButton>
      </div>
    </template>
  </SettingsCard>
</template>

<script setup lang="ts">
import { BohrButton, SettingsCard } from '@bohr/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError, api } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import RuntimeProgress from '../RuntimeProgress.vue';

type Phase = 'intro' | 'provisioning' | 'agent';

// A project without a runtime (migrated from bohr v1, moved to its owner's account, or created while that
// account could not run Containers) gets one as soon as its owner opens it: the instance sets up the project
// Worker and gives it the owner's agent settings, asking for them only when there are none yet. The Telegram bot
// stays optional, in the overview's checklist.
const props = withDefaults(defineProps<{ projectId: string; initialPhase?: Phase }>(), { initialPhase: 'intro' });
const emit = defineEmits<{ activated: [] }>();

const { t } = useI18n();
const errorText = useErrorText();
const phase = ref<Phase>(props.initialPhase);
const enabling = ref(false);
const error = ref<string | null>(null);
/**
 * Migrated projects run on bohr's Cloudflare account, which needs a current subscription (402); the
 * billing page sends the owner to Stripe.
 */
const needsSubscription = ref(false);
/** The owner's Cloudflare account cannot run Containers: the panel explains it instead of Cloudflare's error. */
const needsContainers = ref(false);

async function enable() {
  enabling.value = true;
  error.value = null;
  needsSubscription.value = false;
  try {
    await api.enableRuntime(props.projectId);
    phase.value = 'provisioning';
  } catch (caught) {
    const status = caught instanceof ApiError ? caught.status : 0;
    const code = caught instanceof ApiError ? (caught.body as { code?: unknown } | null)?.code : undefined;
    // 422 containers_unavailable: "Check again" asks once more, after the owner upgrades the account
    needsContainers.value = code === 'containers_unavailable';
    if (needsContainers.value) return;
    // 409: the project already has a runtime, so just follow it.
    if (status === 409) phase.value = 'provisioning';
    else if (status === 402) {
      needsSubscription.value = true;
      error.value = t('activation.paymentRequired');
    } else error.value = errorText(caught);
  } finally {
    enabling.value = false;
  }
}

/** Once the runtime is ready, the instance gives it the owner's agent settings; without them, ask for them. */
async function onReady() {
  let configured = true;
  try {
    configured = (await api.agentSettings()).agent.configured;
  } catch {
    // Unknown: go on, the overview's checklist says it again.
  }
  if (configured) emit('activated');
  else phase.value = 'agent';
}

onMounted(() => {
  if (phase.value === 'intro') void enable();
});
</script>

<style scoped>
.activation {
  max-width: 760px;
}

.activation__actions {
  margin-top: 24px;
}
</style>
