<template>
  <WizardStep step="repository" :title="t('newProject.repository.title')">
    <p class="card-text">{{ t('newProject.repository.text') }}</p>

    <ErrorState v-if="loadError !== null" class="repository__error" :message="errorText(loadError)" @retry="load" />

    <form v-else class="form" novalidate @submit.prevent="create">
      <div class="form-field">
        <BohrTextField
          v-model="search"
          :label="t('newProject.repository.search')"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('newProject.repository.searchPlaceholder')"
          :aria-controls="`${id}-list`"
          :loading="repositories === null"
        />
      </div>

      <fieldset class="repositories" :aria-busy="repositories === null">
        <legend class="bohr-visually-hidden">{{ t('newProject.repository.legend') }}</legend>
        <p v-if="repositories === null" class="muted">{{ t('newProject.repository.loading') }}</p>
        <template v-else-if="repositories.length === 0">
          <p class="muted">{{ t('newProject.repository.empty') }}</p>
        </template>
        <p v-else-if="filtered.length === 0" class="muted">{{ t('newProject.repository.noMatch', { search }) }}</p>
        <ul v-else :id="`${id}-list`" class="repositories__list" role="list">
          <li v-for="repository in filtered" :key="repository.id">
            <label class="repositories__option">
              <input
                type="radio"
                name="repository"
                class="repositories__radio"
                :value="repository.fullName"
                :checked="selected?.fullName === repository.fullName"
                @change="select(repository)"
              />
              <span class="repositories__name">{{ repository.fullName }}</span>
              <span class="repositories__meta">
                <span v-if="repository.private" class="badge">{{ t('newProject.repository.private') }}</span>
                <span>{{ t('newProject.repository.defaultBranch', { branch: repository.defaultBranch }) }}</span>
              </span>
            </label>
          </li>
        </ul>
        <p v-if="repositories !== null" class="field-hint">
          {{ t('newProject.repository.missing') }}
          <a
            v-if="installUrl !== null"
            :href="installUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
          >{{ t('newProject.repository.installMore') }}</a>
          <button type="button" class="repositories__reload text-link" @click="load">{{ t('newProject.repository.reload') }}</button>
        </p>
      </fieldset>

      <template v-if="selected !== null">
        <div class="repository__fields">
          <div class="form-field">
            <BohrTextField v-model="name" :label="t('newProject.repository.name')" maxlength="100" required />
          </div>
          <div class="form-field">
            <BohrTextField
              v-model="branch"
              :label="t('newProject.repository.branch')"
              maxlength="200"
              spellcheck="false"
              autocomplete="off"
              required
              :aria-describedby="`${id}-branch-hint`"
            />
            <p :id="`${id}-branch-hint`" class="field-hint">{{ t('newProject.repository.branchHint') }}</p>
          </div>
        </div>
      </template>

      <div v-if="createError !== null" class="notice notice--error" role="alert">
        <p>{{ createError }}</p>
        <BohrButton v-if="needsSubscription && org === undefined" size="sm" class="repository__subscribe" :disabled="subscribing" @click="subscribe">
          {{ t('newProject.repository.subscribe') }}
        </BohrButton>
      </div>

      <div class="actions">
        <BohrButton type="submit" :disabled="selected === null || creating">
          {{ creating ? t('newProject.repository.creating') : t('newProject.repository.create') }}
        </BohrButton>
      </div>
    </form>
  </WizardStep>
</template>

<script setup lang="ts">
import { BohrButton, BohrTextField } from '@bohr/ui';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api, type Repository } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import ErrorState from '../ErrorState.vue';
import WizardStep from '../onboarding/WizardStep.vue';

const props = defineProps<{
  /** Where to give the GitHub App access to more repositories, when the instance knows it. */
  installUrl: string | null;
  /** An organization's slug: its repositories, and the project is the organization's. */
  org?: string;
}>();
const emit = defineEmits<{ created: [projectId: string, runtime: boolean] }>();

const { t, locale } = useI18n();
const errorText = useErrorText();
const id = `repository-${useId()}`;

const repositories = ref<Repository[] | null>(null);
const loadError = ref<unknown>(null);
const search = ref('');
const selected = ref<Repository | null>(null);
const name = ref('');
const branch = ref('');
const creating = ref(false);
const createError = ref<string | null>(null);
const needsSubscription = ref(false);
const subscribing = ref(false);

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  const list = repositories.value ?? [];
  return query ? list.filter((repository) => repository.fullName.toLowerCase().includes(query)) : list;
});

async function load() {
  repositories.value = null;
  loadError.value = null;
  try {
    repositories.value = (await api.repositories(props.org)).repositories;
  } catch (caught) {
    loadError.value = caught;
  }
}

function select(repository: Repository) {
  selected.value = repository;
  name.value = repository.fullName.split('/')[1] ?? repository.fullName;
  branch.value = repository.defaultBranch;
}

async function create() {
  if (selected.value === null) return;
  creating.value = true;
  createError.value = null;
  needsSubscription.value = false;
  try {
    const { projectId, runtime } = await api.createProject({
      repository: selected.value.fullName,
      org: props.org,
      name: name.value.trim() || undefined,
      productionBranch: branch.value.trim() || undefined,
      locale: locale.value,
    });
    emit('created', projectId, runtime !== false);
  } catch (caught) {
    // bohr.io Cloud: the subscription is not active (or a v1 subscription lapsed).
    needsSubscription.value = caught instanceof ApiError && caught.status === 402;
    createError.value = needsSubscription.value
      ? props.org
        ? t('orgs.newProject.paymentRequired')
        : t('newProject.repository.paymentRequired')
      : errorText(caught);
  } finally {
    creating.value = false;
  }
}

async function subscribe() {
  subscribing.value = true;
  try {
    const result = await api.checkSubscription();
    if (result.status === 'payment_required') {
      window.location.assign(result.checkoutUrl);
      return;
    }
    // Already subscribed after all: try again.
    await create();
  } catch (caught) {
    createError.value = errorText(caught);
  } finally {
    subscribing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.repository__error {
  margin-top: 20px;
}

.repositories {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.repositories__list {
  display: grid;
  gap: 6px;
  max-height: 340px;
  overflow-y: auto;
  padding: 2px;
}

.repositories__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 2px 12px;
  padding: 10px 12px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.repositories__option:hover,
.repositories__option:has(:checked) {
  border-color: var(--bohr-color-frame);
}

.repositories__option:has(:checked) {
  background: hsl(var(--bohr-hsl-orange) / 0.08);
}

.repositories__radio {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.repositories__name {
  overflow: hidden;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.repositories__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--bohr-color-text-muted);
}

.repositories__reload {
  margin-left: 8px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
}

.repository__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 20px;
}

.repository__subscribe {
  margin-top: 12px;
}
</style>
