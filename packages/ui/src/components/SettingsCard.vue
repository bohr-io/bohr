<template>
  <section class="bohr-settings-card">
    <BohrBox :variant="danger ? 'outline-danger' : 'outline'">
      <div class="bohr-settings-card__content">
        <slot />
        <slot name="content" />
      </div>
      <div v-if="$slots.actions" class="bohr-settings-card__actions">
        <slot name="actions" />
      </div>
    </BohrBox>
  </section>
</template>

<script setup lang="ts">
import BohrBox from './BohrBox.vue';

defineProps<{
  /** Red outline, for destructive settings. */
  danger?: boolean;
}>();
</script>

<style scoped>
.bohr-settings-card__content {
  padding: 36px;
}

.bohr-settings-card__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  margin-top: 13px;
  padding: 24px 36px;
  border-top: 1px solid;
  border-image-source: linear-gradient(90deg, transparent 0%, rgb(255 255 255 / 0.2) 50%, transparent 100%);
  border-image-slice: 1;
  border-bottom-right-radius: var(--bohr-box-radius, 8px);
  border-bottom-left-radius: var(--bohr-box-radius, 8px);
  background-color: hsl(0 100% 0% / 0.2);
}

@media (max-width: 560px) {
  .bohr-settings-card__content {
    padding: 24px;
  }

  .bohr-settings-card__actions {
    padding: 20px 24px;
  }
}
</style>
