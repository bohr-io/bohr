<template>
  <li ref="root" class="context-switcher" data-context-switcher>
    <button
      ref="toggle"
      type="button"
      class="context-switcher__toggle"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-label="t('orgs.switcher.label', { context: currentName })"
      :title="currentName"
      @click="toggleMenu"
    >
      <OrgAvatar v-if="current !== null" :name="current.name" :url="current.avatarUrl" :size="36" />
      <span v-else class="context-switcher__personal"><UserIcon :size="20" /></span>
    </button>
    <!-- The context's name under it, like the bar's other captions; the button's label already says it -->
    <span class="context-switcher__caption" aria-hidden="true" @click="toggleMenu">{{ currentName }}</span>

    <div v-if="open" :id="menuId" class="context-switcher__menu" :style="position" @keydown.esc.stop="close(true)">
      <p class="context-switcher__heading">{{ t('orgs.switcher.heading') }}</p>
      <ul class="context-switcher__list" role="list">
        <li>
          <RouterLink
            to="/projects"
            class="context-switcher__item"
            :aria-current="current === null ? 'true' : undefined"
            data-context="personal"
            @click="choose(null)"
          >
            <span class="context-switcher__personal context-switcher__personal--small"><UserIcon :size="16" /></span>
            <span class="context-switcher__name">{{ t('orgs.switcher.personal') }}</span>
          </RouterLink>
        </li>
        <li v-for="org in list" :key="org.slug">
          <RouterLink
            :to="{ name: 'org', params: { slug: org.slug } }"
            class="context-switcher__item"
            :aria-current="current?.slug === org.slug ? 'true' : undefined"
            :data-context="org.slug"
            @click="choose(org.slug)"
          >
            <OrgAvatar :name="org.name" :url="org.avatarUrl" :size="28" />
            <span class="context-switcher__name">{{ org.name }}</span>
            <span v-if="org.role === 'admin'" class="context-switcher__role">{{ t('orgs.role.admin') }}</span>
          </RouterLink>
        </li>
      </ul>
      <RouterLink :to="{ name: 'org-new' }" class="context-switcher__item context-switcher__new" data-context="new" @click="close()">
        <PlusIcon :size="16" />
        <span class="context-switcher__name">{{ t('orgs.switcher.new') }}</span>
      </RouterLink>
    </div>
  </li>
</template>

<script setup lang="ts">
import { PlusIcon } from '@bohr/ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { useCurrentOrg } from '../../composables/useCurrentOrg';
import { loadOrgs, orgs, setContext } from '../../orgs';
import { UserIcon } from '../icons';
import OrgAvatar from './OrgAvatar.vue';

// The main bar's context switcher: the personal account, the user's organizations and a new organization.
const { t } = useI18n();
const route = useRoute();
const root = useTemplateRef<HTMLElement>('root');
const toggle = useTemplateRef<HTMLButtonElement>('toggle');
const menuId = `context-${useId()}`;

const open = ref(false);
const position = ref<Record<string, string>>({});
const list = computed(() => orgs.list ?? []);
const current = useCurrentOrg();
const currentName = computed(() => current.value?.name ?? t('orgs.switcher.personal'));

function toggleMenu() {
  if (open.value) {
    close();
    return;
  }
  // The menu opens beside the thin bar, which clips anything inside it.
  const rect = toggle.value?.getBoundingClientRect();
  position.value = rect ? { top: `${Math.max(8, rect.top)}px`, left: `${rect.right + 12}px` } : {};
  open.value = true;
  void loadOrgs(true);
  void nextTick(() => root.value?.querySelector<HTMLElement>('.context-switcher__item')?.focus());
}

function close(focusToggle = false) {
  open.value = false;
  if (focusToggle) toggle.value?.focus();
}

function choose(slug: string | null) {
  setContext(slug);
  close();
}

function onPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close();
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (open.value && next !== null && !root.value?.contains(next)) close();
}

watch(
  () => route.fullPath,
  () => close(),
);

onMounted(() => {
  void loadOrgs();
  document.addEventListener('pointerdown', onPointerDown);
  root.value?.addEventListener('focusout', onFocusOut);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  root.value?.removeEventListener('focusout', onFocusOut);
});
</script>

<style scoped>
.context-switcher {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.context-switcher__caption {
  max-width: calc(var(--bohr-sidebar-width) - 12px);
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: hsl(0 0% 100% / 0.72);
  cursor: pointer;
}

.context-switcher__toggle {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid hsl(0 0% 100% / 0.2);
  border-radius: 12px;
  color: #fff;
  background: hsl(0 0% 0% / 0.25);
  cursor: pointer;
  transition: border-color var(--bohr-transition);
}

.context-switcher__toggle:hover,
.context-switcher__toggle[aria-expanded="true"] {
  border-color: var(--bohr-color-frame);
}

.context-switcher__toggle:focus-visible {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

.context-switcher__personal {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.context-switcher__personal--small {
  width: 28px;
  height: 28px;
  background: hsl(0 0% 100% / 0.1);
}

/* Fixed beside the bar: the bar's panel and its list clip their overflow. */
.context-switcher__menu {
  position: fixed;
  z-index: 1;
  display: grid;
  gap: 4px;
  width: min(300px, calc(100vw - 120px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid hsl(0 0% 100% / 0.14);
  border-radius: var(--bohr-radius-md);
  background: #111b22;
  box-shadow: 0 16px 40px hsl(0 0% 0% / 0.5);
}

.context-switcher__heading {
  padding: 4px 8px 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bohr-color-text-muted);
}

.context-switcher__list {
  display: grid;
  gap: 2px;
}

.context-switcher__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 8px;
  border-radius: var(--bohr-radius-sm);
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.context-switcher__item:hover,
.context-switcher__item:focus-visible {
  background: hsl(0 0% 100% / 0.08);
}

.context-switcher__item[aria-current="true"] {
  background: hsl(var(--bohr-hsl-orange) / 0.15);
}

.context-switcher__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.context-switcher__role {
  font-size: 11px;
  color: var(--bohr-color-text-muted);
}

.context-switcher__new {
  margin-top: 4px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 0 0 var(--bohr-radius-sm) var(--bohr-radius-sm);
  color: var(--bohr-color-amber);
}
</style>
