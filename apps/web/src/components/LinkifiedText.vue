<template>
  <template v-for="(segment, index) in segments" :key="index">
    <a
      v-if="segment.type === 'link'"
      :href="segment.href"
      class="text-link"
      target="_blank"
      rel="noopener noreferrer"
    >{{ segment.text }}</a>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { linkify } from '../lib/linkify';

const props = defineProps<{ text: string }>();

const segments = computed(() => linkify(props.text));
</script>
