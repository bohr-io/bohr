<template>
  <header class="project-header">
    <div class="project-header__main">
      <figure class="project-header__icon">
        <img src="/favicon.svg" alt="" />
      </figure>
      <div class="project-header__text">
        <BohrPageTitle :title="title" />
        <RouterLink v-if="org" :to="{ name: 'org', params: { slug: org.slug } }" class="project-header__org" data-org-badge>
          <span class="bohr-visually-hidden">{{ t('orgs.badge') }}</span>
          {{ org.name }}
        </RouterLink>
        <p v-if="owner || repo" class="project-header__breadcrumbs">
          <BohrTypography v-if="owner" variant="title3" color="#C3A32E" class="project-header__crumb">{{ owner }}</BohrTypography>
          <BohrTypography v-if="repo" variant="title3" color="#C3A32E" class="project-header__crumb">{{ repo }}</BohrTypography>
        </p>
      </div>
    </div>

    <ul class="project-header__links" role="list">
      <li v-if="productionUrl">
        <a
          :href="productionUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="project-header__link project-header__link--production"
          :aria-label="t('project.links.production', { url: productionUrl })"
          :title="productionUrl"
        >
          <NewWindowIcon :size="16" color="#111b22" />
        </a>
      </li>
      <li v-if="previewUrl">
        <a
          :href="previewUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="project-header__link project-header__link--preview"
          :aria-label="t('project.links.preview', { url: previewUrl })"
          :title="previewUrl"
        >
          <EyeIcon />
        </a>
      </li>
      <li v-if="repository">
        <a
          :href="`https://github.com/${repository}`"
          target="_blank"
          rel="noopener noreferrer"
          class="project-header__link"
          :aria-label="t('project.links.github', { repository })"
          :title="`https://github.com/${repository}`"
        >
          <GithubIcon :size="32" />
        </a>
      </li>
    </ul>
  </header>
</template>

<script setup lang="ts">
import { BohrPageTitle, BohrTypography, EyeIcon, GithubIcon, NewWindowIcon } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { OrgRef } from '../../api';

// bohr v1's BohrSiteHeader and its links: production, preview and GitHub, separated by thin gradient bars.
const props = defineProps<{
  /** The current sub-page's name. */
  title: string;
  /** owner/repo */
  repository: string;
  productionUrl: string | null;
  previewUrl: string | null;
  /** The organization the project belongs to. */
  org?: OrgRef | null;
}>();

const { t } = useI18n();
const owner = computed(() => props.repository.split('/')[0] ?? '');
const repo = computed(() => props.repository.split('/')[1] ?? '');
</script>

<style scoped>
.project-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px 24px;
  margin-bottom: 40px;
}

.project-header__main {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}

.project-header__icon {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  margin: 0;
  padding: 10px;
  overflow: hidden;
  border-radius: 16px;
  background-color: #000;
}

.project-header__icon img {
  width: 100%;
  height: 100%;
}

.project-header__text {
  min-width: 0;
}

.project-header__org {
  display: inline-flex;
  align-items: center;
  margin: 4px 0 6px;
  padding: 3px 10px;
  border: 1px solid hsl(var(--bohr-hsl-cyan) / 0.45);
  border-radius: var(--bohr-radius-full);
  font-size: 12px;
  font-weight: 700;
  color: var(--bohr-color-cyan);
  transition: background-color var(--bohr-transition);
}

.project-header__org:hover,
.project-header__org:focus-visible {
  background: hsl(var(--bohr-hsl-cyan) / 0.12);
}

.project-header__breadcrumbs {
  margin: 0;
  overflow-wrap: anywhere;
}

.project-header__crumb {
  display: inline-block;
}

.project-header__crumb + .project-header__crumb::before {
  content: "/";
  display: inline-block;
  margin: 8px;
  color: #625217;
}

.project-header__links {
  display: flex;
  align-items: center;
  gap: 16px;
}

.project-header__links > li {
  display: flex;
  align-items: center;
  gap: 16px;
}

.project-header__links > li + li::before {
  content: "";
  width: 1px;
  height: 32px;
  border-radius: 1px;
  background: linear-gradient(180deg, hsl(39 92% 57%) 0%, hsl(21 89% 52%) 15.15%, hsl(355 78% 60%) 100%);
}

.project-header__link {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--bohr-radius-full);
  color: #fff;
  transition:
    transform var(--bohr-transition),
    opacity var(--bohr-transition);
}

.project-header__link:hover,
.project-header__link:focus-visible {
  transform: scale(1.08);
}

.project-header__link--production {
  background-color: #f6ae2d;
}

.project-header__link--preview {
  background-color: hsl(0 0% 0% / 0.45);
}
</style>
