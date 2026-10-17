<template>
  <section id="community" class="section" aria-labelledby="community-title">
    <div class="container">
      <h2 id="community-title" class="section-title">{{ t('community.title') }}</h2>
      <p class="section-lead">{{ t('community.text') }}</p>

      <AvatarWall
        v-if="contributors.length > 0"
        class="community__wall"
        :people="contributors"
        :size="64"
        :label="t('community.contributors')"
      />

      <BohrBox color="purple" class="discord">
        <DiscordIcon class="discord__icon" :size="112" />
        <div class="discord__content">
          <h3 class="discord__title gradient-text gradient-text--purple">{{ t('community.discordTitle') }}</h3>
          <BohrButton size="lg" :href="DISCORD_URL">
            <template #iconLeft><DiscordIcon :size="16" /></template>
            {{ t('community.discordCta') }}
          </BohrButton>
        </div>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { AvatarWall, BohrBox, BohrButton, DiscordIcon } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import { useContributors } from '../../composables/useContributors';
import { DISCORD_URL } from '../../config';

const { t } = useI18n();
const contributors = useContributors();
</script>

<style scoped>
.community__wall {
  max-width: 900px;
  margin: clamp(32px, 5vw, 56px) auto 0;
}

/* v1's purple "Join our community" box */
.discord {
  display: grid;
  gap: 32px;
  align-items: center;
  justify-items: center;
  max-width: 900px;
  margin: clamp(40px, 6vw, 72px) auto 0;
  padding: clamp(28px, 6vw, 72px);
  text-align: center;
  background: linear-gradient(180deg, hsl(var(--bohr-hsl-purple) / 0.16) 0%, transparent 70%);
}

.discord__icon {
  color: var(--bohr-color-purple);
  filter: drop-shadow(0 0 24px rgb(141 90 223 / 0.55));
}

.discord__title {
  margin-bottom: 24px;
  font-size: clamp(28px, 4vw, 40px);
}

@media (min-width: 768px) {
  .discord {
    grid-template-columns: auto 1fr;
    justify-items: start;
    text-align: left;
  }
}
</style>
