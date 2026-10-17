<template>
  <div class="page org">
    <header class="org__header">
      <OrgAvatar :name="name" :url="org?.avatarUrl ?? null" :size="52" class="org__avatar" />
      <div class="org__text">
        <BohrPageTitle :title="name" />
        <p v-if="org !== null" class="org__meta">
          <a :href="`https://github.com/${encodeURIComponent(org.githubLogin)}`" target="_blank" rel="noopener noreferrer" class="text-link org__github">
            <GithubIcon :size="14" />
            {{ `github.com/${org.githubLogin}` }}
          </a>
          <span class="badge" :class="{ 'badge--cyan': org.role === 'admin' }" data-role>{{ t(`orgs.role.${org.role}`) }}</span>
        </p>
      </div>
    </header>

    <ErrorState v-if="detail === null && loadError !== null && !notFound" :message="errorText(loadError)" @retry="load" />

    <SettingsCard v-else-if="notFound" class="org__alone" data-card="not-found">
      <h2 class="card-title">{{ t('orgs.notFoundTitle') }}</h2>
      <p class="card-text">{{ t('orgs.notFound') }}</p>
      <div class="actions org__actions">
        <BohrButton :as="RouterLink" to="/projects">{{ t('notFound.back') }}</BohrButton>
      </div>
    </SettingsCard>

    <div v-else-if="detail === null" aria-busy="true">
      <BohrSkeleton class="org__skeleton" radius="8px" />
      <span class="bohr-visually-hidden">{{ t('common.loading') }}</span>
    </div>

    <template v-else>
      <div v-if="!detail.org.status.installation" class="notice notice--warn org__notice" role="status" data-notice="installation">
        <strong class="notice__title">{{ t('orgs.uninstalledTitle') }}</strong>
        <p>{{ t('orgs.uninstalled') }}</p>
        <BohrButton v-if="isAdmin" size="sm" :disabled="installing" @click="reinstall">
          {{ t('orgs.reinstall') }}
        </BohrButton>
      </div>

      <!-- Its pages (projects, members, settings) are in the main bar while the organization is the scope. -->
      <RouterView />
    </template>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrPageTitle, BohrSkeleton, GithubIcon, SettingsCard } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { ApiError, api, type OrgDetail } from '../api';
import ErrorState from '../components/ErrorState.vue';
import OrgAvatar from '../components/org/OrgAvatar.vue';
import { useErrorText, useErrorToast } from '../composables/useErrorText';
import { provideOrg } from '../composables/useOrg';
import { usePageTitle } from '../composables/usePageTitle';
import { loadOrgs, orgs, setContext } from '../orgs';

// An organization: a header and the current page (projects, members or settings, in the main bar).
const props = defineProps<{ slug: string }>();

const { t } = useI18n();
const route = useRoute();
const errorText = useErrorText();
const showError = useErrorToast();

const detail = ref<OrgDetail | null>(null);
const loadError = ref<unknown>(null);
const installing = ref(false);

const org = computed(() => detail.value?.org ?? null);
const name = computed(
  () => org.value?.name ?? orgs.list?.find((entry) => entry.slug === props.slug)?.name ?? props.slug,
);
const isAdmin = computed(() => org.value?.role === 'admin');
/** Not a member (or no such organization): the instance answers 404 or 403. */
const notFound = computed(
  () => loadError.value instanceof ApiError && (loadError.value.status === 404 || loadError.value.status === 403),
);

async function load() {
  loadError.value = null;
  try {
    detail.value = await api.org(props.slug);
    // The organization in the URL becomes the remembered context.
    setContext(props.slug);
  } catch (caught) {
    loadError.value = caught;
    if (caught instanceof ApiError && (caught.status === 404 || caught.status === 403) && orgs.context === props.slug) {
      setContext(null);
    }
  }
}

async function reload() {
  try {
    detail.value = await api.org(props.slug);
  } catch (caught) {
    showError(caught);
  }
  // The switcher shows the setup too.
  void loadOrgs(true);
}

/** The GitHub App was uninstalled from the GitHub organization: installing it again links it back. */
async function reinstall() {
  installing.value = true;
  try {
    window.location.assign((await api.orgInstallUrl()).url);
  } catch (caught) {
    showError(caught);
    installing.value = false;
  }
}

const pageName = computed(() => t(route.meta.orgPage ?? 'orgs.nav.projects'));
usePageTitle(() => (detail.value !== null ? `${pageName.value} · ${name.value}` : null));

provideOrg({ slug: props.slug, detail, isAdmin, reload });

onMounted(load);
</script>

<style scoped>
.org {
  max-width: calc(1152px + 2 * var(--gutter));
}

.org__header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 36px;
}

.org__avatar {
  border-radius: 16px;
}

.org__text {
  min-width: 0;
}

.org__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 6px;
  font-size: 14px;
}

.org__github {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.org__notice {
  margin-bottom: 28px;
}

.org__alone {
  max-width: 760px;
}

.org__actions {
  margin-top: 20px;
}

.org__skeleton {
  width: 100%;
  height: 360px;
}
</style>
