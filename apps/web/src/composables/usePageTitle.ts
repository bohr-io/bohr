import { onBeforeUnmount, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

// A page can name itself (a project's name); otherwise the route's translated title is used.
const pageTitle = ref<string | null>(null);

export function usePageTitle(source: () => string | null | undefined): void {
  watchEffect(() => {
    pageTitle.value = source() || null;
  });
  onBeforeUnmount(() => {
    pageTitle.value = null;
  });
}

/** Keeps document.title in sync with the route, the page and the language. Used once, by App.vue. */
export function useDocumentTitle(): void {
  const route = useRoute();
  const { t } = useI18n();
  watchEffect(() => {
    const title = pageTitle.value ?? (route.meta.title ? t(route.meta.title) : null);
    document.title = title ? `${title} · bohr` : 'bohr';
  });
}
