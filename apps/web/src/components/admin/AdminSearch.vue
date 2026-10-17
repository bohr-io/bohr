<template>
  <form class="admin-search" role="search" @submit.prevent="emit('search', text)">
    <label :for="id" class="bohr-visually-hidden">{{ label }}</label>
    <input
      :id="id"
      v-model="text"
      class="control admin-search__input"
      type="search"
      name="q"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
    />
    <BohrButton type="submit" variant="ghost">{{ t('admin.search') }}</BohrButton>
  </form>
</template>

<script setup lang="ts">
import { BohrButton } from '@bohr/ui';
import { ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ value: string; label: string; placeholder: string }>();
const emit = defineEmits<{ search: [text: string] }>();

const { t } = useI18n();
const id = `admin-search-${useId()}`;
const text = ref(props.value);

// Back and forward change the search in the URL.
watch(
  () => props.value,
  (value) => {
    text.value = value;
  },
);
</script>

<style scoped>
.admin-search {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.admin-search__input {
  flex: 1;
  min-width: 200px;
}
</style>
