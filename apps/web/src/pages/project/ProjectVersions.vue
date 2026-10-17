<template>
  <RuntimeGate v-slot="{ state }">
    <VersionsPanel :feed="feed" :project="state" />
  </RuntimeGate>
</template>

<script setup lang="ts">
import RuntimeGate from '../../components/project/RuntimeGate.vue';
import VersionsPanel from '../../components/project/VersionsPanel.vue';
import { useProject } from '../../composables/useProject';

const { feed } = useProject();
</script>
