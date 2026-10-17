<template>
  <BohrBox as="article" variant="glass" interactive class="project-card">
    <!-- Behind the card's content, like bohr v1's site cards: the card keeps its size -->
    <ProjectScreenshot :project="project" />
    <div class="project-card__body">
      <div class="project-card__heading">
        <BohrLogo icon-only class="project-card__icon" />
        <div class="project-card__names">
          <p class="project-card__owner">{{ owner }}</p>
          <h2 class="project-card__name">
            <RouterLink :to="`/projects/${encodeURIComponent(project.id)}`" class="project-card__link">
              {{ project.name }}
            </RouterLink>
          </h2>
        </div>
      </div>

      <dl class="project-card__facts">
        <div>
          <dt class="bohr-visually-hidden">{{ t('projects.repository') }}</dt>
          <dd class="project-card__repo">{{ project.repository }}</dd>
        </div>
        <div>
          <dt class="bohr-visually-hidden">{{ t('projects.status') }}</dt>
          <dd class="project-card__status">
            <StatusIndicator :status="indicator.status" :label="t(indicator.label)" />
            <span aria-hidden="true">{{ t(indicator.label) }}</span>
            <span v-if="project.role === 'member'" class="badge">{{ t('projects.role.member') }}</span>
          </dd>
        </div>
      </dl>

      <ul class="project-card__links" role="list">
        <li v-if="project.runtime?.previewUrl">
          <a :href="project.runtime.previewUrl" target="_blank" rel="noopener noreferrer" class="project-card__chip">
            <NewWindowIcon :size="11" />
            {{ t('projects.preview') }}
          </a>
        </li>
        <li v-if="project.productionUrl">
          <a :href="project.productionUrl" target="_blank" rel="noopener noreferrer" class="project-card__chip">
            <NewWindowIcon :size="11" />
            {{ t('projects.production') }}
          </a>
        </li>
        <li v-if="project.runtime?.botUsername">
          <a
            :href="botUrl(project.runtime.botUsername)"
            target="_blank"
            rel="noopener noreferrer"
            class="project-card__chip"
            :aria-label="t('projects.botLink', { bot: `@${project.runtime.botUsername}` })"
          >
            {{ `@${project.runtime.botUsername}` }}
          </a>
        </li>
      </ul>
    </div>
  </BohrBox>
</template>

<script setup lang="ts">
import { BohrBox, BohrLogo, NewWindowIcon, StatusIndicator } from '@bohr/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProjectSummary } from '../../api';
import { projectIndicator } from '../../lib/status';
import { botUrl } from '../../lib/telegram';
import ProjectScreenshot from './ProjectScreenshot.vue';

const props = defineProps<{ project: ProjectSummary }>();

const { t } = useI18n();
const owner = computed(() => props.project.repository.split('/')[0] ?? '');
const indicator = computed(() => projectIndicator(props.project));
</script>

<style scoped>
.bohr-box.project-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  height: 100%;
  min-height: 190px;
  background:
    radial-gradient(120% 90% at 100% 0%, hsl(var(--bohr-hsl-orange) / 0.16) 0%, transparent 60%),
    linear-gradient(180deg, hsl(203 30% 14%) 0%, #091015 100%);
}

/* The whole card opens the project; the links inside stay clickable above it. */
.project-card:focus-within {
  box-shadow: var(--bohr-shadow-glow);
}

.project-card:focus-within::before {
  opacity: 1;
}

.project-card__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  padding: 20px;
}

.project-card__heading {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

.project-card__icon {
  width: 36px;
  height: 36px;
}

.project-card__names {
  min-width: 0;
}

.project-card__owner {
  overflow: hidden;
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--bohr-color-text-muted);
}

.project-card__name {
  overflow: hidden;
  font-size: 20px;
  line-height: 1.25;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-card__name::before {
  content: "/";
  margin-right: 4px;
  color: #666;
}

.project-card__link {
  color: inherit;
}

.project-card__link:focus-visible {
  outline: none;
}

.project-card__link::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 3;
}

.project-card__facts {
  display: grid;
  gap: 8px;
  margin: 0;
}

.project-card__facts dd {
  margin: 0;
}

.project-card__repo {
  overflow: hidden;
  font-family: var(--bohr-font-family-mono);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--bohr-color-text-subtle);
}

.project-card__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}

.project-card__links {
  position: relative;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}

.project-card__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--bohr-radius-full);
  font-size: 13px;
  font-weight: 700;
  color: var(--bohr-color-cyan);
  background: hsl(var(--bohr-hsl-cyan) / 0.12);
  transition: background-color var(--bohr-transition);
}

.project-card__chip:hover {
  background: hsl(var(--bohr-hsl-cyan) / 0.24);
}
</style>
