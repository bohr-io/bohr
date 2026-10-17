import { onBeforeUnmount, onMounted, type Ref, ref } from 'vue';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Tracks the user's reduced motion preference. It is false during SSR and the first client
 * render (so hydration matches) and updates right after mount.
 */
export function usePrefersReducedMotion(): Ref<boolean> {
  const prefersReducedMotion = ref(false);
  let media: MediaQueryList | undefined;

  const update = () => {
    prefersReducedMotion.value = Boolean(media?.matches);
  };

  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return;
    media = window.matchMedia(QUERY);
    update();
    media.addEventListener('change', update);
  });

  onBeforeUnmount(() => media?.removeEventListener('change', update));

  return prefersReducedMotion;
}
