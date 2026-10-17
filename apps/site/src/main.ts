import '@bohr/ui/styles.css';
import './styles/site.css';
import { ViteSSG } from 'vite-ssg';
import App from './App.vue';
import { createSiteI18n } from './i18n';
import { DEFAULT_LOCALE } from './i18n/locales';
import { routes, scrollBehavior } from './router';

export const createApp = ViteSSG(
  App,
  { routes, scrollBehavior },
  ({ app, router }) => {
    const i18n = createSiteI18n();
    app.use(i18n);
    // The locale comes from the route, so prerendering and hydration always agree.
    router.beforeEach((to) => {
      i18n.global.locale.value = to.meta.locale ?? DEFAULT_LOCALE;
    });
  },
  // Hydrate the prerendered HTML; the dev server has none, so it renders from scratch.
  { hydration: !import.meta.env.DEV },
);
