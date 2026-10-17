<template>
  <section id="accounts" class="section" aria-labelledby="accounts-title">
    <div class="container">
      <BohrBox color="purple" class="accounts">
        <div class="accounts__intro">
          <h2 id="accounts-title" class="box-title gradient-text gradient-text--purple">{{ t('accounts.title') }}</h2>
          <p class="box-lead accounts__text">{{ t('accounts.text') }}</p>
        </div>
        <AccountsDiagram class="accounts__diagram" />
        <p class="accounts__footnote">{{ t('accounts.footnote') }}</p>
      </BohrBox>
    </div>
  </section>
</template>

<script setup lang="ts">
import { BohrBox } from '@bohr/ui';
import { useI18n } from 'vue-i18n';
import AccountsDiagram from './AccountsDiagram.vue';

const { t } = useI18n();
</script>

<style scoped>
.accounts {
  padding: clamp(24px, 7vw, 96px);
  background: linear-gradient(180deg, hsl(var(--bohr-hsl-purple) / 0.14) 0%, transparent 60%);
}

.accounts__intro {
  max-width: 760px;
  margin-inline: auto;
  text-align: center;
}

.accounts__text {
  margin-top: 20px;
}

.accounts__diagram {
  margin-top: clamp(32px, 5vw, 56px);
}

.accounts__footnote {
  max-width: 640px;
  margin: 32px auto 0;
  font-size: 15px;
  line-height: 1.5;
  text-align: center;
  color: var(--bohr-color-text-muted);
}
</style>
