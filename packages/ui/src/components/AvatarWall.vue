<template>
  <ul class="bohr-avatar-wall" role="list" :aria-label="label" :style="{ '--avatar-size': `${size}px` }">
    <li v-for="(person, index) in people" :key="`${person.name}-${index}`" class="bohr-avatar-wall__item">
      <component
        :is="person.href ? 'a' : 'span'"
        :href="person.href"
        class="bohr-avatar-wall__ring"
        :class="`is-${person.ring ?? RINGS[index % RINGS.length]}`"
        :title="person.name"
      >
        <img
          class="bohr-avatar-wall__image"
          :src="person.avatarUrl"
          :alt="person.name"
          :width="size"
          :height="size"
          loading="lazy"
          decoding="async"
        />
      </component>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { AvatarRing, AvatarWallPerson } from '../types';

withDefaults(
  defineProps<{
    people: AvatarWallPerson[];
    /** Avatar diameter in pixels, without the ring. */
    size?: number;
    /** Accessible name of the list. */
    label?: string;
  }>(),
  { size: 64 },
);

// People without an explicit ring cycle through v1's plan colors.
const RINGS: readonly AvatarRing[] = ['green', 'fire', 'pink', 'steel'];
</script>

<style scoped>
.bohr-avatar-wall {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bohr-avatar-wall__ring {
  --ring: var(--bohr-gradient-secondary);
  --glow: var(--bohr-color-green);

  display: block;
  padding: 3px;
  border-radius: var(--bohr-radius-full);
  background: var(--ring);
  box-shadow: 0 10px 10px rgb(0 0 0 / 0.3);
  transition:
    transform var(--bohr-transition),
    box-shadow var(--bohr-transition);
}

.bohr-avatar-wall__ring.is-pink {
  --ring: linear-gradient(180deg, #55dde0, #cc5ab3);
  --glow: var(--bohr-color-pink);
}

.bohr-avatar-wall__ring.is-fire {
  --ring: linear-gradient(180deg, #f6ae2d, #f26419, #e84855);
  --glow: var(--bohr-color-orange);
}

.bohr-avatar-wall__ring.is-steel {
  --ring: linear-gradient(180deg, #e84855, #365c73);
  --glow: var(--bohr-color-red);
}

a.bohr-avatar-wall__ring:hover,
a.bohr-avatar-wall__ring:focus-visible {
  box-shadow: 0 0 24px 2px var(--glow);
  transform: translateY(-2px) scale(1.05);
}

.bohr-avatar-wall__image {
  width: var(--avatar-size);
  height: var(--avatar-size);
  border: 2px solid var(--bohr-color-bg);
  border-radius: var(--bohr-radius-full);
  object-fit: cover;
  background-color: var(--bohr-color-bg);
}
</style>
