<template>
  <section class="members">
    <p class="card-text members__intro">{{ isOwner ? t('members.textOwner') : t('members.text') }}</p>

    <ErrorState v-if="error !== null" class="members__error" :message="errorText(error)" @retry="load" />
    <ul v-else class="members__list" role="list" :aria-busy="members === null">
      <template v-if="members === null">
        <li v-for="index in 2" :key="`skeleton-${index}`" class="members__item">
          <BohrSkeleton class="members__skeleton" />
        </li>
      </template>
      <li v-for="member in members ?? []" :key="member.key" class="members__item">
        <span class="members__avatar" aria-hidden="true">{{ initials(member.name) }}</span>
        <div class="members__info">
          <p class="members__name">
            {{ member.name }}
            <span v-if="member.key === you.key" class="badge">{{ t('members.you') }}</span>
          </p>
          <p class="members__meta">
            {{ t(`members.role.${member.role}`) }} · {{ t('members.joined', { date: formatDateTime(member.joinedAt, locale) }) }}
          </p>
        </div>
        <BohrButton
          v-if="isOwner && member.role !== 'owner'"
          size="sm"
          variant="text"
          danger
          :aria-label="t('members.revokeNamed', { name: member.name })"
          @click="revoking = member"
        >
          {{ t('members.revoke') }}
        </BohrButton>
      </li>
    </ul>

    <SettingsCard v-if="isOwner" class="members__invite">
      <h3 class="members__invite-title">{{ t('members.inviteTitle') }}</h3>
      <p class="card-text">{{ t('members.inviteText') }}</p>
      <div v-if="invite !== null" class="invite" role="status">
        <p class="invite__label">{{ t('members.code') }}</p>
        <p class="invite__code">{{ invite.code }}</p>
        <p class="invite__expiry">
          {{ t('members.expires', { date: formatDateTime(invite.expiresAt, locale), relative: formatRelative(invite.expiresAt, locale) }) }}
        </p>
        <div class="actions">
          <CopyButton :value="invite.code" :label="t('members.copyCode')" />
          <CopyButton :value="inviteLink" :label="t('members.copyLink')" />
        </div>
        <p class="field-hint">{{ t('members.howToJoin', { code: invite.code }) }}</p>
      </div>
      <div class="actions members__invite-actions">
        <BohrButton :variant="invite === null ? 'default' : 'ghost'" :disabled="inviting" @click="createInvite">
          {{ inviting ? t('common.working') : invite === null ? t('members.invite') : t('members.inviteAgain') }}
        </BohrButton>
      </div>
    </SettingsCard>

    <ConfirmDialog
      :open="revoking !== null"
      :title="t('members.revokeTitle')"
      :confirm-label="t('members.revoke')"
      danger
      :busy="revokingBusy"
      @confirm="revoke"
      @cancel="revoking = null"
    >
      <p>{{ t('members.revokeText', { name: revoking?.name ?? '' }) }}</p>
    </ConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import type { MemberView, ProjectState } from '@bohr/shared';
import { BohrButton, BohrSkeleton, SettingsCard, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Invite } from '../../api';
import type { ChatFeed } from '../../chat/feed';
import { useErrorText, useErrorToast } from '../../composables/useErrorText';
import { formatDateTime, formatRelative } from '../../lib/format';
import ConfirmDialog from '../ConfirmDialog.vue';
import CopyButton from '../CopyButton.vue';
import ErrorState from '../ErrorState.vue';

const props = defineProps<{
  feed: ChatFeed;
  projectId: string;
  you: ProjectState['you'];
}>();

const { t, locale } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();

const isOwner = computed(() => props.you.role === 'owner');
const members = ref<MemberView[] | null>(null);
const error = ref<unknown>(null);
const invite = ref<Invite | null>(null);
const inviting = ref(false);
const revoking = ref<MemberView | null>(null);
const revokingBusy = ref(false);

/** Opens the project with the code filled in; the join screen reads ?code=. */
const inviteLink = computed(() =>
  invite.value === null
    ? ''
    : `${window.location.origin}/projects/${encodeURIComponent(props.projectId)}?code=${encodeURIComponent(invite.value.code)}`,
);

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

async function load() {
  error.value = null;
  members.value = null;
  try {
    members.value = (await props.feed.api.members()).members;
  } catch (caught) {
    error.value = caught;
  }
}

async function createInvite() {
  inviting.value = true;
  try {
    invite.value = await props.feed.api.createInvite();
  } catch (caught) {
    showError(caught);
  } finally {
    inviting.value = false;
  }
}

async function revoke() {
  const member = revoking.value;
  if (member === null) return;
  revokingBusy.value = true;
  try {
    await props.feed.api.revoke(member.key);
    toast.success(t('members.revoked', { name: member.name }));
    revoking.value = null;
    await load();
  } catch (caught) {
    showError(caught);
  } finally {
    revokingBusy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.members__intro {
  margin: 0;
}

.members__error {
  margin-top: 16px;
}

.members__list {
  display: grid;
  gap: 2px;
  margin-top: 16px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  background: hsl(0 0% 0% / 0.2);
}

.members__item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}

.members__item + .members__item {
  border-top: 1px solid hsl(0 0% 100% / 0.08);
}

.members__skeleton {
  width: 100%;
  height: 40px;
}

.members__avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--bohr-radius-full);
  font-size: 14px;
  font-weight: 700;
  color: #0e171d;
  background: var(--bohr-gradient-fire);
}

.members__info {
  flex: 1;
  min-width: 0;
}

.members__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.members__meta {
  margin-top: 2px;
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.members__invite {
  margin-top: 28px;
}

.members__invite-title {
  font-size: 18px;
}

.invite {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  padding: 16px;
  border: 1px dashed hsl(var(--bohr-hsl-cyan) / 0.5);
  border-radius: var(--bohr-radius-md);
}

.invite__label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.invite__code {
  font-family: var(--bohr-font-family-mono);
  font-size: clamp(24px, 4vw, 32px);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--bohr-color-cyan);
}

.invite__expiry {
  font-size: 13px;
  color: var(--bohr-color-text-muted);
}

.members__invite-actions {
  margin-top: 20px;
}
</style>
