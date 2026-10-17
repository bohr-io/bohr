<template>
  <aside class="project-nav">
    <BohrBox shadowless variant="outline-highlight" class="project-nav__box">
      <nav :aria-label="label">
        <ul class="project-nav__list" :class="{ 'has-back': back !== undefined }" role="list">
          <li v-if="back !== undefined" class="project-nav__back">
            <RouterLink :to="back.to" class="project-nav__link">
              <ArrowIcon direction="left" :size="12" />
              {{ back.label }}
            </RouterLink>
          </li>
          <li v-for="item in links" :key="item.label" class="project-nav__item">
            <RouterLink
              :to="item.to"
              class="project-nav__link"
              :class="{ 'is-current': item.current }"
              :aria-current="item.current ? 'page' : undefined"
            >
              {{ item.label }}
            </RouterLink>
          </li>
        </ul>
      </nav>
    </BohrBox>
  </aside>
</template>

<script lang="ts">
import type { RouteLocationRaw } from 'vue-router';

export interface NavLink {
  to: RouteLocationRaw;
  label: string;
  current: boolean;
}
</script>

<script setup lang="ts">
import { ArrowIcon, BohrBox } from '@bohr/ui';
import { RouterLink } from 'vue-router';

// bohr v1's project menu (BohrSiteBar, and SettingsSidebar with its "back" row on a darker band).
defineProps<{
  label: string;
  links: NavLink[];
  /** The settings menu starts with a way back to the project's overview. */
  back?: { to: RouteLocationRaw; label: string };
}>();
</script>

<style scoped>
.project-nav__box {
  position: sticky;
  top: 48px;
  margin-right: 48px;
}

.project-nav__list {
  min-width: 105px;
  margin: 0;
  padding: 36px 24px;
}

.project-nav__list.has-back {
  padding: 0 0 36px;
}

.project-nav__item,
.project-nav__back {
  position: relative;
}

.has-back .project-nav__item {
  padding-inline: 24px;
}

.project-nav__item:not(:last-child),
.project-nav__back {
  margin-bottom: 36px;
}

.project-nav__back {
  padding: 24px;
  border-bottom: 1px solid;
  border-image: linear-gradient(90deg, transparent 0%, #000 50%, transparent 100%) 1;
  border-top-left-radius: var(--bohr-box-radius, 8px);
  border-top-right-radius: var(--bohr-box-radius, 8px);
  background-color: hsl(0 100% 0% / 0.2);
}

.project-nav__link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  line-height: 18px;
  white-space: nowrap;
  color: inherit;
  transition: color var(--bohr-transition);
}

.project-nav__link.is-current,
.project-nav__link:hover,
.project-nav__link:focus-visible {
  color: #f26419;
}

.project-nav__link.is-current::before {
  content: "";
  position: absolute;
  top: -12px;
  bottom: -12px;
  left: -25px;
  width: 1px;
  background-image: linear-gradient(180deg, #f4cd3b 0.04%, #f16622 53.99%, #e84856 99.94%);
}

.has-back .project-nav__link.is-current::before {
  left: -1px;
}

/* Stacked above the page on smaller screens: the links in rows. */
@media (max-width: 1023px) {
  .project-nav__box {
    position: static;
    margin-right: 0;
  }

  .project-nav__list,
  .project-nav__list.has-back {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 28px;
    padding: 20px 24px;
  }

  .project-nav__item:not(:last-child),
  .project-nav__back {
    margin-bottom: 0;
  }

  .has-back .project-nav__item {
    padding-inline: 0;
  }

  .project-nav__back {
    flex-basis: 100%;
    margin: -20px -24px 0;
    padding: 16px 24px;
  }

  .project-nav__link.is-current::before,
  .has-back .project-nav__link.is-current::before {
    top: auto;
    right: 0;
    bottom: -8px;
    left: 0;
    width: auto;
    height: 1px;
    background-image: linear-gradient(90deg, #f4cd3b 0.04%, #f16622 53.99%, #e84856 99.94%);
  }
}
</style>
