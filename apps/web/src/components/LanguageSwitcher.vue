<template>
  <fieldset class="language-switcher">
    <legend class="field-label">{{ t('account.language.label') }}</legend>
    <div class="language-switcher__options">
      <label v-for="option in LOCALES" :key="option.code" class="language-switcher__option" :lang="option.code">
        <input
          type="radio"
          class="language-switcher__input"
          name="language"
          :value="option.code"
          :checked="locale === option.code"
          @change="choose(option.code)"
        />
        <span>{{ option.name }}</span>
      </label>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { changeLocale } from '../i18n';
import { LOCALES, type LocaleCode } from '../i18n/locales';

const { t, locale } = useI18n();

function choose(code: LocaleCode) {
  changeLocale({ locale }, code);
}
</script>

<style scoped>
.language-switcher {
  margin: 0;
  padding: 0;
  border: 0;
}

.language-switcher__options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.language-switcher__option {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 9px 16px;
  border: 1px solid hsl(0 0% 100% / 0.15);
  border-radius: var(--bohr-radius-full);
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color var(--bohr-transition),
    background-color var(--bohr-transition);
}

.language-switcher__option:hover {
  border-color: hsl(0 0% 100% / 0.4);
}

.language-switcher__option:has(:checked) {
  border-color: var(--bohr-color-frame);
  background-color: hsl(var(--bohr-hsl-orange) / 0.15);
}

.language-switcher__option:has(:focus-visible) {
  outline: 2px solid var(--bohr-color-yellow);
  outline-offset: 2px;
}

/* The native radio stays in the accessibility tree and keyboard order. */
.language-switcher__input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
