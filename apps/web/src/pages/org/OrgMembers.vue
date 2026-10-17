<template>
  <div class="stack org-members">
    <div class="org-members__heading">
      <div>
        <h2 class="org-members__title">{{ t('orgs.members.title') }}</h2>
        <p class="card-text">{{ t('orgs.members.text') }}</p>
      </div>
      <BohrButton v-if="isAdmin" variant="ghost" :disabled="syncing" data-action="sync" @click="sync">
        <template #iconLeft><GithubIcon :size="12" /></template>
        {{ syncing ? t('orgs.members.syncing') : t('orgs.members.sync') }}
      </BohrButton>
    </div>

    <div v-if="detail !== null && !detail.org.membersPermission" class="notice notice--warn" role="status" data-notice="permission">
      <strong class="notice__title">{{ t('orgs.members.permissionTitle') }}</strong>
      <p>{{ t('orgs.members.permission') }}</p>
    </div>

    <ErrorState v-if="members === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
    <div v-else-if="members === null" aria-busy="true">
      <BohrSkeleton class="org-members__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>
    <p v-else-if="members.length === 0" class="notice" data-empty>{{ t('orgs.members.none') }}</p>

    <div v-else class="admin-table-wrap">
      <table class="admin-table" data-table="members">
        <thead>
          <tr>
            <th scope="col">{{ t('orgs.members.member') }}</th>
            <th scope="col">{{ t('orgs.members.role') }}</th>
            <th scope="col">{{ t('orgs.members.status') }}</th>
            <th scope="col">{{ t('orgs.members.source') }}</th>
            <th v-if="isAdmin" scope="col"><span class="bohr-visually-hidden">{{ t('orgs.members.actions') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="member in members" :key="member.githubUserId" :data-member="member.githubLogin">
            <td>
              <div class="org-members__person">
                <OrgAvatar :name="member.githubLogin" :url="avatar(member.githubLogin)" :size="32" />
                <div class="org-members__names">
                  <a
                    :href="`https://github.com/${encodeURIComponent(member.githubLogin)}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="admin-table__strong text-link"
                  >{{ member.githubLogin }}</a>
                  <span v-if="member.userId !== null && member.userId === me" class="badge org-members__you">{{ t('admin.user.you') }}</span>
                  <span v-if="member.name || member.email" class="admin-table__muted">
                    {{ [member.name, member.email].filter(Boolean).join(' · ') }}
                  </span>
                </div>
              </div>
            </td>
            <td>
              <span class="badge" :class="{ 'badge--cyan': member.role === 'admin' }" data-role>{{ t(`orgs.role.${member.role}`) }}</span>
            </td>
            <td>
              <span class="badge" :class="member.status === 'active' ? 'badge--green' : 'badge--amber'" data-status>
                {{ t(`orgs.members.statuses.${member.status}`) }}
              </span>
              <span v-if="member.status === 'pending'" class="admin-table__muted">{{ t('orgs.members.pendingHint') }}</span>
            </td>
            <td>
              <span class="admin-table__muted" data-source>{{ t(`orgs.members.sources.${member.source}`) }}</span>
            </td>
            <td v-if="isAdmin">
              <div class="org-members__actions">
                <BohrButton size="sm" variant="ghost" :disabled="busy !== null" data-action="role" @click="toggleRole(member)">
                  {{ member.role === 'admin' ? t('orgs.members.makeMember') : t('orgs.members.makeAdmin') }}
                </BohrButton>
                <BohrButton size="sm" variant="ghost" danger :disabled="busy !== null" data-action="remove" @click="askRemove(member)">
                  {{ t('orgs.members.remove') }}
                </BohrButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="isAdmin && members !== null && members.length > 0" class="field-hint">{{ t('orgs.members.githubHint') }}</p>

    <ConfirmDialog
      :open="removing !== null"
      :title="t('orgs.members.removeTitle', { login: removing?.githubLogin ?? '' })"
      :confirm-label="t('orgs.members.remove')"
      danger
      :busy="busy === 'remove'"
      @confirm="remove"
      @cancel="removing = null"
    >
      <div class="org-members__confirm">
        <p>{{ t('orgs.members.removeText', { login: removing?.githubLogin ?? '' }) }}</p>
        <p v-if="removeError !== null" class="org-members__error" role="alert">{{ removeError }}</p>
      </div>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrSkeleton, GithubIcon, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api, type OrgMember } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ErrorState from '../../components/ErrorState.vue';
import OrgAvatar from '../../components/org/OrgAvatar.vue';
import { useErrorText, useErrorToast } from '../../composables/useErrorText';
import { useOrg } from '../../composables/useOrg';
import { session } from '../../session';

// The organization's members, mirrored from GitHub. Admins change roles, remove access in bohr and sync again.
const { t } = useI18n();
const toast = useToast();
const errorText = useErrorText();
const showError = useErrorToast();
const { slug, detail, isAdmin, reload } = useOrg();

const members = ref<OrgMember[] | null>(null);
const loadError = ref<unknown>(null);
const syncing = ref(false);
const busy = ref<'role' | 'remove' | null>(null);
const removing = ref<OrgMember | null>(null);
const removeError = ref<string | null>(null);
const me = computed(() => session.me?.user.id ?? null);

const ORDER = { admin: 0, member: 1 } as const;

function show(list: OrgMember[]) {
  members.value = [...list].sort(
    (a, b) =>
      Number(a.status === 'pending') - Number(b.status === 'pending') ||
      ORDER[a.role] - ORDER[b.role] ||
      a.githubLogin.localeCompare(b.githubLogin),
  );
}

function avatar(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
}

async function load() {
  loadError.value = null;
  try {
    show((await api.orgMembers(slug)).members);
  } catch (caught) {
    loadError.value = caught;
  }
}

async function sync() {
  syncing.value = true;
  try {
    const result = await api.syncOrgMembers(slug);
    show(result.members);
    toast.success(t('orgs.members.synced', { added: result.added, removed: result.removed, updated: result.updated }));
    // The permission to read the members may have been granted meanwhile.
    void reload();
  } catch (caught) {
    showError(caught);
  } finally {
    syncing.value = false;
  }
}

async function toggleRole(member: OrgMember) {
  const role = member.role === 'admin' ? 'member' : 'admin';
  busy.value = 'role';
  try {
    await api.setOrgMemberRole(slug, member.githubUserId, role);
    toast.success(
      role === 'admin'
        ? t('orgs.members.madeAdmin', { login: member.githubLogin })
        : t('orgs.members.madeMember', { login: member.githubLogin }),
    );
    await load();
    // Demoting oneself takes away the admin pages.
    if (member.userId !== null && member.userId === me.value) await reload();
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 409) toast.error(t('orgs.members.lastAdmin'));
    else showError(caught);
  } finally {
    busy.value = null;
  }
}

function askRemove(member: OrgMember) {
  removeError.value = null;
  removing.value = member;
}

async function remove() {
  const member = removing.value;
  if (member === null || busy.value !== null) return;
  busy.value = 'remove';
  removeError.value = null;
  try {
    await api.removeOrgMember(slug, member.githubUserId);
    removing.value = null;
    toast.success(t('orgs.members.removed', { login: member.githubLogin }));
    await load();
  } catch (caught) {
    removeError.value =
      caught instanceof ApiError && caught.status === 409 ? t('orgs.members.lastAdmin') : errorText(caught);
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.org-members__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.org-members__title {
  font-size: 22px;
}

.org-members__skeleton {
  width: 100%;
  height: 280px;
}

.org-members__person {
  display: flex;
  align-items: center;
  gap: 12px;
}

.org-members__names {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.org-members__you {
  justify-self: start;
}

.org-members__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.org-members__confirm {
  display: grid;
  gap: 10px;
}

.org-members__error {
  font-size: 13px;
  font-weight: 700;
  color: hsl(355 78% 42%);
}
</style>
