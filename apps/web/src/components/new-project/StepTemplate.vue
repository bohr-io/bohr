<template>
  <WizardStep step="template" :title="t('newProject.template.title')">
    <p class="card-text">{{ t('newProject.template.text') }}</p>

    <ErrorState v-if="loadError !== null" class="template__error" :message="errorText(loadError)" @retry="load" />

    <form v-else class="form" novalidate @submit.prevent="create">
      <fieldset class="templates" :aria-busy="templates === null">
        <legend class="bohr-visually-hidden">{{ t('newProject.template.legend') }}</legend>
        <p v-if="templates === null" class="muted">{{ t('newProject.template.loading') }}</p>
        <ul v-else class="templates__grid" role="list">
          <li v-for="template in templates" :key="template.slug">
            <label class="templates__card" :data-template="template.slug">
              <input
                type="radio"
                name="template"
                class="templates__radio"
                :value="template.slug"
                :checked="selected?.slug === template.slug"
                @change="select(template)"
              />
              <span class="templates__name">{{ text(template).name }}</span>
              <span class="templates__description">{{ text(template).description }}</span>
              <span class="templates__tags">
                <span v-for="tag in template.tags" :key="tag" class="badge">{{ tagLabel(tag) }}</span>
              </span>
            </label>
          </li>
        </ul>
      </fieldset>

      <template v-if="selected !== null">
        <div class="template__fields">
          <div class="form-field">
            <BohrTextField
              v-model="name"
              :label="t('newProject.template.name')"
              maxlength="100"
              spellcheck="false"
              autocomplete="off"
              required
              :aria-describedby="`${id}-name-hint`"
            />
            <p :id="`${id}-name-hint`" class="field-hint">{{ t('newProject.template.nameHint') }}</p>
          </div>
          <div class="form-field">
            <label :for="`${id}-owner`" class="field-label">{{ t('newProject.template.owner') }}</label>
            <select :id="`${id}-owner`" v-model="owner" class="control" :aria-describedby="`${id}-owner-hint`">
              <option value="">{{ t('newProject.template.personal') }}</option>
              <option v-for="org in owners" :key="org.slug" :value="org.slug">{{ org.name }}</option>
            </select>
            <p :id="`${id}-owner-hint`" class="field-hint">{{ t('newProject.template.ownerHint') }}</p>
          </div>
        </div>
        <div class="form-field template__private">
          <BohrSwitch v-model="privateRepository" :label="t('newProject.template.private')" name="private" />
          <p class="field-hint">{{ t('newProject.template.privateHint') }}</p>
        </div>
      </template>

      <div v-if="failure !== null" class="notice notice--error" role="alert" data-notice="template-error">
        <p>{{ failure.message }}</p>
        <a
          v-if="failure.d1"
          href="https://dash.cloudflare.com/profile/api-tokens"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
        >{{ t('newProject.template.editToken') }}</a>
      </div>

      <div class="actions">
        <BohrButton type="submit" :disabled="selected === null || creating">
          {{ creating ? t('newProject.template.creating') : t('newProject.template.create') }}
        </BohrButton>
      </div>
      <p v-if="selected !== null" class="field-hint">{{ t('newProject.template.githubNote') }}</p>
    </form>
  </WizardStep>
</template>

<script setup lang="ts">
import { LOCALES, type Locale } from '@bohr/shared';
import { BohrButton, BohrSwitch, BohrTextField } from '@bohr/ui';
import { computed, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, api, type OrgSummary, type ProjectTemplate } from '../../api';
import { useErrorText } from '../../composables/useErrorText';
import { readJson, writeJson } from '../../lib/storage';
import { loadOrgs } from '../../orgs';
import ErrorState from '../ErrorState.vue';
import WizardStep from '../onboarding/WizardStep.vue';

const props = defineProps<{
  /** The organization the page is in: the default owner. */
  org?: string;
  /** The template to select (from the query, when GitHub's return brings the form back). */
  template?: string;
  /** Why the last attempt failed, as the instance's return from GitHub said (?error=, &code=). */
  error?: string;
  errorCode?: string;
}>();

const { t, te, locale } = useI18n();
const errorText = useErrorText();
const id = `template-${useId()}`;
/** What the form had when the browser left for GitHub, so a failure brings it back. */
const FORM_KEY = 'bohr.templateForm';
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

const templates = ref<ProjectTemplate[] | null>(null);
const loadError = ref<unknown>(null);
const orgList = ref<OrgSummary[]>([]);
const selected = ref<ProjectTemplate | null>(null);
const name = ref('');
const owner = ref(props.org ?? '');
const privateRepository = ref(true);
const creating = ref(false);
const failure = ref<{ message: string; d1: boolean } | null>(
  props.error === undefined
    ? null
    : {
        message: props.errorCode === 'd1_permission' ? t('newProject.template.d1Permission') : props.error,
        d1: props.errorCode === 'd1_permission',
      },
);

/** Organizations that can have projects: subscribed, with a Cloudflare account and the GitHub App. */
const owners = computed(() =>
  orgList.value.filter(
    (org) => org.slug === props.org || (org.status.subscription && org.status.cloudflare && org.status.installation),
  ),
);

function text(template: ProjectTemplate) {
  const current = LOCALES.find((code) => code === locale.value) as Locale | undefined;
  return template.locales[current ?? 'en'] ?? template.locales.en;
}

function tagLabel(tag: string) {
  const key = `newProject.template.tags.${tag}`;
  return te(key) ? t(key) : tag;
}

function select(template: ProjectTemplate) {
  selected.value = template;
  if (name.value.trim() === '') name.value = template.slug;
}

async function load() {
  templates.value = null;
  loadError.value = null;
  try {
    const [list, orgs] = await Promise.all([api.templates(), loadOrgs()]);
    templates.value = list.templates;
    orgList.value = orgs;
    const initial = list.templates.find((template) => template.slug === props.template);
    if (initial !== undefined) {
      const saved = readJson<{ template?: string; name?: string; owner?: string; private?: boolean } | null>(
        FORM_KEY,
        null,
      );
      if (saved?.template === initial.slug) {
        name.value = saved.name ?? '';
        owner.value = saved.owner ?? owner.value;
        privateRepository.value = saved.private ?? true;
      }
      select(initial);
    }
  } catch (caught) {
    loadError.value = caught;
  }
}

async function create() {
  if (selected.value === null) return;
  const trimmed = name.value.trim();
  if (!NAME.test(trimmed) || trimmed === '.' || trimmed === '..') {
    failure.value = { message: t('newProject.template.invalidName'), d1: false };
    return;
  }
  creating.value = true;
  failure.value = null;
  try {
    const form = { template: selected.value.slug, name: trimmed, owner: owner.value, private: privateRepository.value };
    writeJson(FORM_KEY, form);
    const { url } = await api.startTemplateProject({
      template: form.template,
      name: form.name,
      org: form.owner || undefined,
      private: form.private,
      locale: locale.value,
    });
    // GitHub asks the user to authorize bohr, then the instance creates the project and brings them back
    window.location.assign(url);
  } catch (caught) {
    const code = caught instanceof ApiError ? (caught.body as { code?: unknown } | null)?.code : undefined;
    if (caught instanceof ApiError && caught.status === 402) {
      failure.value = {
        message: owner.value ? t('orgs.newProject.paymentRequired') : t('newProject.repository.paymentRequired'),
        d1: false,
      };
    } else if (code === 'd1_permission') {
      failure.value = { message: t('newProject.template.d1Permission'), d1: true };
    } else {
      failure.value = { message: errorText(caught), d1: false };
    }
    creating.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.template__error {
  margin-top: 20px;
}

.templates {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.templates__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 10px;
  padding: 2px;
}

.templates__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  padding: 14px 14px 12px;
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: var(--bohr-radius-md);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.templates__card:hover,
.templates__card:has(:checked) {
  border-color: var(--bohr-color-frame);
}

.templates__card:has(:checked) {
  background: hsl(var(--bohr-hsl-orange) / 0.08);
}

.templates__card:has(:focus-visible) {
  outline: 2px solid var(--bohr-color-orange);
  outline-offset: 2px;
}

.templates__radio {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--bohr-color-orange);
}

.templates__name {
  padding-right: 28px;
  font-weight: 700;
}

.templates__description {
  flex: 1;
  font-size: 14px;
  line-height: 1.45;
  color: var(--bohr-color-text-muted);
}

.templates__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.template__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 20px;
}

.template__private {
  margin-top: 4px;
}
</style>
