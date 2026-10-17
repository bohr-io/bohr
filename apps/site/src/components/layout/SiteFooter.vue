<template>
  <footer class="site-footer">
    <div class="container site-footer__grid">
      <div class="site-footer__brand">
        <RouterLink :to="pathFor('home')" class="site-footer__logo" :aria-label="t('common.homeLink')">
          <BohrLogo />
        </RouterLink>
        <ul role="list" class="site-footer__social">
          <li>
            <a :href="GITHUB_URL" :aria-label="t('footer.github')" :title="t('footer.github')"><GithubIcon :size="24" /></a>
          </li>
          <li>
            <a :href="DISCORD_URL" :aria-label="t('footer.discord')" :title="t('footer.discord')">
              <DiscordIcon :size="24" />
            </a>
          </li>
        </ul>
      </div>
      <div class="site-footer__column">
        <h2 :id="ids.product" class="site-footer__heading">{{ t('footer.product') }}</h2>
        <ul role="list" :aria-labelledby="ids.product">
          <li><a :href="docsUrl(code)">{{ t('footer.docs') }}</a></li>
          <li><a :href="GITHUB_URL">{{ t('footer.github') }}</a></li>
          <li>
            <RouterLink :to="pathFor('migration')">{{ t('footer.migration') }}</RouterLink>
          </li>
        </ul>
      </div>
      <div class="site-footer__column">
        <h2 :id="ids.community" class="site-footer__heading">{{ t('footer.community') }}</h2>
        <ul role="list" :aria-labelledby="ids.community">
          <li><a :href="DISCORD_URL">{{ t('footer.discord') }}</a></li>
          <li><a :href="GITHUB_URL">{{ t('footer.github') }}</a></li>
        </ul>
      </div>
      <div class="site-footer__column">
        <h2 :id="ids.contact" class="site-footer__heading">{{ t('footer.contact') }}</h2>
        <ul role="list" :aria-labelledby="ids.contact">
          <li><a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a></li>
        </ul>
      </div>
    </div>
    <div class="container">
      <div class="site-footer__bottom">
        <p>{{ t('footer.copyright') }}</p>
        <LanguageSwitcher />
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { BohrLogo, DiscordIcon, GithubIcon } from '@bohr/ui';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSiteLocale } from '../../composables/useSiteLocale';
import { CONTACT_EMAIL, DISCORD_URL, docsUrl, GITHUB_URL } from '../../config';
import LanguageSwitcher from './LanguageSwitcher.vue';

const { t } = useI18n();
const { code, pathFor } = useSiteLocale();

const id = useId();
const ids = { product: `${id}-product`, community: `${id}-community`, contact: `${id}-contact` };
</script>

<style scoped>
/* v1's black full-bleed footer */
.site-footer {
  padding-block: 60px 32px;
  color: #fff;
  background-color: var(--bohr-color-bg-black);
}

.site-footer__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 40px 32px;
}

.site-footer__brand {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.site-footer__logo {
  display: inline-block;
  width: fit-content;
}

.site-footer__social {
  display: flex;
  gap: 8px;
}

.site-footer__social a {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--bohr-radius-full);
  color: #fff;
  transition: background-color var(--bohr-transition);
}

.site-footer__social a:hover {
  background-color: hsl(0 0% 100% / 0.1);
}

.site-footer__heading {
  margin-bottom: 16px;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.site-footer__column ul {
  display: grid;
  gap: 12px;
}

.site-footer__column a {
  color: #fff;
  overflow-wrap: anywhere;
  transition: color var(--bohr-transition);
}

.site-footer__column a:hover {
  color: var(--bohr-color-orange);
  text-decoration: underline;
}

.site-footer__bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 32px;
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid hsl(0 0% 100% / 0.12);
  font-size: 14px;
  color: var(--bohr-color-text-muted);
}
</style>
