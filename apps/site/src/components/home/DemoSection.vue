<template>
  <section id="demo" class="section demo-section" aria-labelledby="demo-title">
    <div class="container">
      <h2 id="demo-title" class="section-title">{{ t('demo.title') }}</h2>
      <DemoConversation />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DemoConversation from './DemoConversation.vue';

const { t } = useI18n();
</script>

<style scoped>
.demo-section {
  padding-top: 0;
}
</style>
