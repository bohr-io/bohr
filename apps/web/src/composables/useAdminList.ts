// A searchable, paged list of the admin area (users, projects). The search and the page live in the
// URL (?q=&page=), so a list can be shared, reloaded and reached with the back button.
import { computed, ref, watch } from 'vue';
import { type LocationQueryRaw, useRoute, useRouter } from 'vue-router';
import { MANAGE_PAGE_SIZE } from '../api';

export interface AdminPage<T> {
  items: T[];
  total: number;
}

export function useAdminList<T>(fetchPage: (query: { query?: string; page: number }) => Promise<AdminPage<T>>) {
  const route = useRoute();
  const router = useRouter();
  /** The list's own route: leaving it changes the query too, which must not reload the list. */
  const routeName = route.name;

  const query = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
  const page = computed(() => {
    const value = Number(route.query.page);
    return Number.isInteger(value) && value >= 1 ? value : 1;
  });

  const items = ref<T[] | null>(null) as { value: T[] | null };
  const total = ref(0);
  const error = ref<unknown>(null);
  const loading = ref(false);
  let latest = 0;

  async function load() {
    const call = ++latest;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchPage({ query: query.value || undefined, page: page.value });
      if (call !== latest) return;
      items.value = result.items;
      total.value = result.total;
    } catch (caught) {
      if (call === latest) error.value = caught;
    } finally {
      if (call === latest) loading.value = false;
    }
  }

  watch(
    [query, page],
    () => {
      if (route.name === routeName) void load();
    },
    { immediate: true },
  );

  const pages = computed(() => Math.max(1, Math.ceil(total.value / MANAGE_PAGE_SIZE)));

  /** A new search starts at the first page. */
  function search(text: string) {
    const q = text.trim();
    void router.push({ query: q ? { q } : {} });
  }

  function pageQuery(target: number): LocationQueryRaw {
    return { ...(query.value ? { q: query.value } : {}), ...(target > 1 ? { page: String(target) } : {}) };
  }

  return { query, page, pages, items, total, error, loading, load, search, pageQuery };
}
