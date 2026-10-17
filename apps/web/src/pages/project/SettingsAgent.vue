<template>
  <RuntimeGate v-slot="{ state }">
    <SettingsPanel
      :feed="feed"
      :project="state"
      :project-id="id"
      :bot-username="summary?.runtime?.botUsername ?? null"
      @updated="loadSummary"
    />
  </RuntimeGate>
</template>

<script setup lang="ts">
import RuntimeGate from '../../components/project/RuntimeGate.vue';
import SettingsPanel from '../../components/project/SettingsPanel.vue';
import { useProject } from '../../composables/useProject';

const { id, feed, summary, loadSummary } = useProject();
</script>
