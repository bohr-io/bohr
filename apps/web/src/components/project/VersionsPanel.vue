<template>
  <section class="versions">
    <div class="versions__intro">
      <p class="card-text">{{ t('versions.text') }}</p>
      <BohrButton v-if="rollbackTarget !== null" size="sm" variant="ghost" danger @click="confirming = true">
        {{ t('versions.rollback') }}
      </BohrButton>
    </div>

    <p v-if="project.releases.length === 0" class="notice versions__empty">{{ t('versions.empty') }}</p>
    <ul v-else class="versions__list" role="list">
      <li v-for="release in project.releases" :key="release.id" class="versions__item">
        <DeployCard
          :name="release.summary"
          :type="t(RELEASE_INDICATORS[release.status].label)"
          :status="RELEASE_INDICATORS[release.status].status"
          :status-label="t(RELEASE_INDICATORS[release.status].label)"
          :author="release.pullRequest === null ? t('versions.direct') : t('versions.pr', { number: release.pullRequest })"
          :hash="release.commitSha ?? undefined"
          :updated-at="release.createdAt"
          :locale="locale"
          :logs-href="release.pullRequest === null ? undefined : `${repoUrl}/pull/${release.pullRequest}`"
          :project-href="release.commitSha === null ? repoUrl : `${repoUrl}/commit/${release.commitSha}`"
          :labels="labels"
        />
      </li>
    </ul>

    <ConfirmDialog
      :open="confirming"
      :title="t('versions.confirmTitle')"
      :confirm-label="t('versions.confirm')"
      danger
      :busy="rollingBack"
      @confirm="rollback"
      @cancel="confirming = false"
    >
      <p>{{ t('versions.confirmText', { number: rollbackTarget?.pullRequest ?? '?' }) }}</p>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import type { ProjectState } from '@bohr/shared';
import { BohrButton, DeployCard, useToast } from '@bohr/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatFeed } from '../../chat/feed';
import { useErrorToast } from '../../composables/useErrorText';
import { RELEASE_INDICATORS } from '../../lib/status';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{
  feed: ChatFeed;
  project: ProjectState;
}>();

const { t, locale } = useI18n();
const toast = useToast();
const showError = useErrorToast();

const repoUrl = computed(() => `https://github.com/${props.project.project.repository}`);
const labels = computed(() => ({
  updated: t('versions.published'),
  by: t('versions.via'),
  hash: t('versions.commit'),
  viewLogs: t('versions.viewPr'),
  viewProject: t('versions.viewCommit'),
}));

/** The release a rollback reverts: the newest one in production (or going there) that came from a pull request. */
const rollbackTarget = computed(() => {
  if (props.project.homolog.status === 'publishing') return null;
  return (
    props.project.releases.find(
      (release) => (release.status === 'live' || release.status === 'deploying') && release.pullRequest !== null,
    ) ?? null
  );
});

const confirming = ref(false);
const rollingBack = ref(false);

async function rollback() {
  rollingBack.value = true;
  try {
    const { message } = await props.feed.api.rollback();
    if (message) toast.tip(message);
    confirming.value = false;
    await props.feed.refresh();
  } catch (error) {
    showError(error);
  } finally {
    rollingBack.value = false;
  }
}
</script>

<style scoped>
.versions__intro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.versions__intro .card-text {
  max-width: 560px;
  margin: 0;
}

.versions__empty {
  margin-top: 20px;
}

.versions__list {
  margin-top: 16px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  background: hsl(0 0% 0% / 0.2);
}

.versions__item + .versions__item {
  border-top: 1px solid rgb(255 255 255 / 0.1);
}

.versions__item :deep(.bohr-deploy-card) {
  margin-inline: 12px;
}
</style>
