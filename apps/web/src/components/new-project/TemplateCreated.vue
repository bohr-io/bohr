<template>
  <div v-if="result !== null" class="notice notice--success template-created" data-notice="admin-password">
    <strong class="notice__title">{{ t('newProject.created.title') }}</strong>
    <p>{{ t('newProject.created.text') }}</p>
    <p class="template-created__password">
      <code class="inline-code" data-password>{{ result.password }}</code>
      <CopyButton :value="result.password" />
    </p>
    <p v-if="result.url !== null">
      <I18nT keypath="newProject.created.site" scope="global">
        <template #url>
          <a :href="result.url" target="_blank" rel="noopener noreferrer" class="text-link">{{ result.url }}</a>
        </template>
      </I18nT>
    </p>
    <p>{{ t('newProject.created.variable', { name: 'ADMIN_PASSWORD' }) }}</p>
  </div>
  <p v-else-if="gone" class="notice template-created" data-notice="admin-password-gone">
    {{ t('newProject.created.gone', { name: 'ADMIN_PASSWORD' }) }}
  </p>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { I18nT, useI18n } from 'vue-i18n';
import { ApiError, api, type TemplatePassword } from '../../api';
import CopyButton from '../CopyButton.vue';

// The admin password of a project just created from a template. The instance answers it once, so it stays in
// this component while the page shows the setup; after a reload only the way to change it remains.
const props = defineProps<{ projectId: string }>();

const { t } = useI18n();
const result = ref<TemplatePassword | null>(null);
const gone = ref(false);

onMounted(async () => {
  try {
    result.value = await api.templatePassword(props.projectId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) gone.value = true;
  }
});
</script>

<style scoped>
.template-created {
  margin-bottom: 20px;
}

.template-created__password {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.template-created__password code {
  font-size: 16px;
  word-break: break-all;
}
</style>
