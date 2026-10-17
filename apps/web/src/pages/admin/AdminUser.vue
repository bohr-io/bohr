<template>
  <div class="stack admin-user">
    <RouterLink :to="{ name: 'admin-users' }" class="admin-user__back">
      <ArrowIcon direction="left" :size="9" />
      <span>{{ t('admin.user.back') }}</span>
    </RouterLink>

    <ErrorState v-if="detail === null && loadError !== null" :message="errorText(loadError)" @retry="load" />
    <div v-else-if="detail === null" aria-busy="true">
      <BohrSkeleton class="admin-user__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <SettingsCard data-card="profile">
        <div class="admin-user__heading">
          <h2 class="card-title">{{ displayName }}</h2>
          <span v-if="detail.user.role === 'admin'" class="badge badge--cyan">{{ t('admin.role.admin') }}</span>
          <span v-if="isSelf" class="badge">{{ t('admin.user.you') }}</span>
        </div>
        <dl class="facts admin-user__facts">
          <div>
            <dt>{{ t('account.email') }}</dt>
            <dd>{{ detail.user.email ?? t('account.unknown') }}</dd>
          </div>
          <div>
            <dt>{{ t('admin.users.signIn') }}</dt>
            <dd>
              <span v-for="(entry, index) in detail.user.identities" :key="entry.provider">
                {{ index > 0 ? ', ' : '' }}{{ t(`connections.${entry.provider}`) }}<template v-if="entry.username"> ({{ entry.username }})</template>
              </span>
              <span v-if="detail.user.identities.length === 0">—</span>
            </dd>
          </div>
          <div>
            <dt>{{ t('admin.users.subscription') }}</dt>
            <dd>{{ detail.user.subscription ? subscriptionLabel(detail.user.subscription) : '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('admin.users.created') }}</dt>
            <dd>{{ formatDateTime(detail.user.createdAt, locale) }}</dd>
          </div>
        </dl>
        <div class="actions admin-user__actions">
          <BohrButton variant="ghost" :disabled="savingRole" data-action="role" @click="toggleRole">
            {{
              savingRole
                ? t('common.working')
                : detail.user.role === 'admin'
                  ? t('admin.user.removeAdmin')
                  : t('admin.user.makeAdmin')
            }}
          </BohrButton>
        </div>
      </SettingsCard>

      <SettingsCard data-card="connections">
        <h2 class="card-title">{{ t('connections.title') }}</h2>
        <dl class="facts admin-user__facts">
          <div>
            <dt>{{ t('connections.githubAppTitle') }}</dt>
            <dd>{{ detail.connections.githubInstallations.map((entry) => entry.account).join(', ') || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('connections.cloudflareTitle') }}</dt>
            <dd>
              {{ detail.connections.cloudflare.map((entry) => entry.accountName ?? entry.accountId).join(', ') || '—' }}
            </dd>
          </div>
          <div>
            <dt>{{ t('connections.telegramTitle') }}</dt>
            <dd>
              {{
                detail.connections.telegram === null
                  ? '—'
                  : detail.connections.telegram.username
                    ? `@${detail.connections.telegram.username}`
                    : t('connections.connected')
              }}
            </dd>
          </div>
          <div v-if="detail.orgs !== undefined" data-fact="orgs">
            <dt>{{ t('admin.user.orgs') }}</dt>
            <dd>
              <template v-if="detail.orgs.length > 0">
                <span v-for="(org, index) in detail.orgs" :key="org.slug">
                  {{ index > 0 ? ', ' : '' }}{{ org.name }} ({{ t(`orgs.role.${org.role}`) }})
                </span>
              </template>
              <template v-else>—</template>
            </dd>
          </div>
          <div>
            <dt>{{ t('account.agentTitle') }}</dt>
            <dd>{{ detail.connections.agent.configured ? t('agentSettings.on') : t('agentSettings.off') }}</dd>
          </div>
        </dl>
      </SettingsCard>

      <section class="stack" aria-labelledby="user-projects">
        <h2 id="user-projects" class="card-title">{{ t('admin.user.projects', { count: detail.projects.length }) }}</h2>
        <AdminProjectsTable v-if="detail.projects.length > 0" :projects="detail.projects" :show-owner="false" />
        <p v-else class="notice">{{ t('admin.user.noProjects') }}</p>
      </section>

      <SettingsCard danger data-card="danger">
        <h2 class="card-title admin-user__danger">{{ t('deleteAccount.title') }}</h2>
        <p class="card-text">{{ isSelf ? t('admin.user.deleteSelf') : t('admin.user.deleteText') }}</p>
        <div v-if="!isSelf" class="actions admin-user__actions">
          <BohrButton danger @click="deleteOpen = true">{{ t('deleteAccount.button') }}</BohrButton>
        </div>
      </SettingsCard>

      <DeleteAccountDialog
        :open="deleteOpen"
        :title="t('admin.user.deleteTitle', { name: displayName })"
        :intro="t('admin.user.deleteIntro', { name: displayName })"
        :remove="deleteUser"
        @cancel="deleteOpen = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ArrowIcon, BohrButton, BohrSkeleton, SettingsCard, useToast } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, api, type ManagedUserDetail } from '../../api';
import DeleteAccountDialog from '../../components/account/DeleteAccountDialog.vue';
import AdminProjectsTable from '../../components/admin/AdminProjectsTable.vue';
import ErrorState from '../../components/ErrorState.vue';
import { useErrorText } from '../../composables/useErrorText';
import { usePageTitle } from '../../composables/usePageTitle';
import { isKnownStatus } from '../../lib/billing';
import { formatDateTime } from '../../lib/format';
import { loadSession, session } from '../../session';

const props = defineProps<{ userId: string }>();

const { t, locale } = useI18n();
const router = useRouter();
const toast = useToast();
const errorText = useErrorText();

const detail = ref<ManagedUserDetail | null>(null);
const loadError = ref<unknown>(null);
const savingRole = ref(false);
const deleteOpen = ref(false);

const displayName = computed(() => detail.value?.user.name ?? detail.value?.user.email ?? props.userId);
/** Your own account is deleted from the account page, which also signs you out. */
const isSelf = computed(() => session.me?.user.id === props.userId);
const subscriptionLabel = (status: string) => (isKnownStatus(status) ? t(`billing.statuses.${status}`) : status);

usePageTitle(() => (detail.value !== null ? `${displayName.value} · ${t('admin.title')}` : null));

async function load() {
  loadError.value = null;
  try {
    detail.value = await api.manageUser(props.userId);
  } catch (caught) {
    loadError.value = caught;
  }
}

async function toggleRole() {
  const current = detail.value;
  if (current === null || savingRole.value) return;
  const role = current.user.role === 'admin' ? 'user' : 'admin';
  savingRole.value = true;
  try {
    await api.setUserRole(props.userId, role);
    current.user.role = role;
    toast.success(
      role === 'admin'
        ? t('admin.user.madeAdmin', { name: displayName.value })
        : t('admin.user.removedAdmin', { name: displayName.value }),
    );
    // Without the role, you no longer see the admin area.
    if (isSelf.value && role === 'user') {
      await loadSession(true).catch(() => null);
      await router.replace({ name: 'projects' });
    }
  } catch (caught) {
    toast.error(caught instanceof ApiError && caught.status === 409 ? t('admin.user.lastAdmin') : errorText(caught));
  } finally {
    savingRole.value = false;
  }
}

async function deleteUser(deleteSites: boolean) {
  const name = displayName.value;
  const { warnings } = await api.deleteUser(props.userId, { deleteSites });
  deleteOpen.value = false;
  toast.success(t('admin.user.deleted', { name }));
  if (warnings.length > 0) {
    toast.warn(t('deleteAccount.warnings', { list: warnings.join('; ') }), { persistent: true });
  }
  await router.push({ name: 'admin-users' });
}

onMounted(load);
</script>

<style scoped>
.admin-user__back {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 13px;
  padding: 6px 17px 6px 10px;
  border-radius: var(--bohr-radius-full);
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
  text-transform: uppercase;
  color: #fff;
  background-color: hsl(0 0% 0% / 0.25);
  transition: background-color var(--bohr-transition);
}

.admin-user__back:hover,
.admin-user__back:focus-visible {
  background-color: hsl(0 0% 0% / 1);
}

.admin-user__skeleton {
  width: 100%;
  height: 420px;
}

.admin-user__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.admin-user__facts,
.admin-user__actions {
  margin-top: 20px;
}

.admin-user__danger {
  color: var(--bohr-color-red);
}
</style>
