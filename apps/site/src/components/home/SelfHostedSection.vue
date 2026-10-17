<template>
  <section id="self-hosted" class="section" aria-labelledby="self-hosted-title">
    <div class="container">
      <BohrBox color="green" class="self-hosted">
        <div class="self-hosted__intro">
          <h2 id="self-hosted-title" class="box-title gradient-text gradient-text--secondary">
            {{ t('selfHosted.title') }}
          </h2>
          <p class="box-lead self-hosted__text">{{ t('selfHosted.text') }}</p>
          <ul class="self-hosted__bullets" role="list">
            <li v-for="bullet in BULLETS" :key="bullet">
              <CheckIcon class="self-hosted__check" :size="16" />
              <I18nT :keypath="`selfHosted.bullets.${bullet}`" tag="span" scope="global">
                <template #command><code class="inline-code">npx wrangler deploy</code></template>
              </I18nT>
            </li>
          </ul>
          <div class="self-hosted__actions">
            <BohrButton size="lg" color="secondary" :href="DEPLOY_BUTTON_URL">{{ t('selfHosted.deployButton') }}</BohrButton>
            <BohrButton size="lg" color="secondary" variant="ghost" :href="GITHUB_URL">
              <template #iconLeft><GithubIcon :size="16" /></template>
              {{ t('selfHosted.githubButton') }}
            </BohrButton>
          </div>
        </div>
        <TerminalWindow
          class="self-hosted__terminal"
          :title="t('selfHosted.terminal')"
          :commands="COMMANDS"
          :copy-label="t('selfHosted.copy')"
          :copied-label="t('selfHosted.copied')"
        />
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrBox, BohrButton, CheckIcon, GithubIcon } from '@bohr/ui';
import { I18nT, useI18n } from 'vue-i18n';
import { DEPLOY_BUTTON_URL, GITHUB_URL } from '../../config';
import TerminalWindow from './TerminalWindow.vue';

const BULLETS = ['deploy', 'multi', 'noLockIn', 'contribute'] as const;
const COMMANDS = [`git clone ${GITHUB_URL}`, 'cd bohr && pnpm install', 'npx wrangler deploy'] as const;

const { t } = useI18n();
</script>

<style scoped>
/* The most prominent box: stronger green tint and glow than the others. */
.self-hosted {
  display: grid;
  gap: clamp(32px, 5vw, 64px);
  align-items: center;
  padding: clamp(24px, 7vw, 96px) clamp(24px, 6vw, 72px);
  background: linear-gradient(180deg, hsl(var(--bohr-hsl-green) / 0.12) 0%, transparent 70%);
  box-shadow: 0 40px 140px -50px hsl(var(--bohr-hsl-green) / 0.55);
}

.self-hosted__text {
  margin-top: 20px;
}

.self-hosted__bullets {
  display: grid;
  gap: 14px;
  margin-top: 28px;
  font-size: 17px;
  line-height: 1.5;
}

.self-hosted__bullets li {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 12px;
  align-items: start;
}

.self-hosted__check {
  box-sizing: content-box;
  padding: 6px;
  border-radius: var(--bohr-radius-full);
  color: var(--bohr-color-green);
  background: hsl(var(--bohr-hsl-green) / 0.14);
  filter: drop-shadow(0 0 6px hsl(var(--bohr-hsl-green) / 0.5));
}

.self-hosted__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 36px;
}

@media (min-width: 1024px) {
  .self-hosted {
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  }
}

@media (max-width: 479px) {
  .self-hosted__actions > * {
    width: 100%;
  }
}
</style>
