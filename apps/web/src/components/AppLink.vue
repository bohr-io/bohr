<template>
  <a :href="href" @click="navigate"><slot /></a>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

// An anchor that navigates inside the app. BohrMainBarLink renders its `as` component with `href`
// only (attributes such as `to` land on its <li>), so RouterLink cannot be used there.
const props = defineProps<{ href: string }>();
const router = useRouter();

function navigate(event: MouseEvent) {
  const target = (event.currentTarget as HTMLAnchorElement | null)?.target;
  // New tabs, downloads and other modified clicks stay with the browser.
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  if (target && target !== '_self') return;
  event.preventDefault();
  void router.push(props.href);
}
</script>
