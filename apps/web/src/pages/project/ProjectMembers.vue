<template>
  <RuntimeGate v-slot="{ state }">
    <MembersPanel :feed="feed" :project-id="id" :you="state.you" />
  </RuntimeGate>
</template>

<script setup lang="ts">
import MembersPanel from '../../components/project/MembersPanel.vue';
import RuntimeGate from '../../components/project/RuntimeGate.vue';
import { useProject } from '../../composables/useProject';

const { id, feed } = useProject();
</script>
