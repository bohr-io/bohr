<template>
  <component :is="tag" class="bohr-typography" :style="style">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { type TypographyVariant, typographyPresets } from '../typography';

const props = withDefaults(
  defineProps<{
    variant?: TypographyVariant;
    tag?: string;
    color?: string;
    textAlign?: string;
    /** Overrides the preset's text-transform. */
    textTransform?: string;
  }>(),
  { variant: 'body1', tag: 'span' },
);

// Exposed as custom properties so a consumer class can still override any of them.
const style = computed(() => {
  const preset = typographyPresets[props.variant];
  return {
    '--bohr-typography-size': preset.fontSize,
    '--bohr-typography-weight': preset.fontWeight,
    '--bohr-typography-line-height': preset.lineHeight,
    '--bohr-typography-letter-spacing': preset.letterSpacing,
    '--bohr-typography-transform': props.textTransform ?? preset.textTransform,
    '--bohr-typography-align': props.textAlign ?? 'inherit',
    '--bohr-typography-color': props.color ?? 'inherit',
  };
});
</script>

<style scoped>
:where(.bohr-typography) {
  display: block;
  margin: 0;
  font-size: var(--bohr-typography-size);
  font-weight: var(--bohr-typography-weight);
  line-height: var(--bohr-typography-line-height);
  letter-spacing: var(--bohr-typography-letter-spacing);
  text-transform: var(--bohr-typography-transform);
  text-align: var(--bohr-typography-align);
  color: var(--bohr-typography-color);
}
</style>
