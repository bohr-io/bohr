<template>
  <div class="page page--narrow not-found">
    <BohrPageTitle :title="t('notFound.title')" shadow-text="404" />
    <p class="page-lead">{{ t('notFound.text') }}</p>
    <div class="actions not-found__actions">
      <BohrButton :as="RouterLink" :to="signedIn ? '/projects' : '/login'">
        {{ signedIn ? t('notFound.back') : t('notFound.signIn') }}
      </BohrButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle } from '@bohr/ui';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { loadSession, session } from '../session';

const { t } = useI18n();
const signedIn = computed(() => session.status === 'signed-in');

// The page is public; knowing the user brings back the main bar and the right way out.
onMounted(() => {
  loadSession().catch(() => undefined);
});
</script>

<style scoped>
.not-found {
  padding-top: clamp(64px, 12vw, 160px);
}

.not-found__actions {
  margin-top: 32px;
}
</style>
