import '@bohr/ui/styles.css';
import './styles/app.css';
import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './api';
import { createWebI18n } from './i18n';
import { initialLocale } from './i18n/locales';
import { createAppRouter } from './router';
import { handleUnauthorized } from './session';

const i18n = createWebI18n(initialLocale());
const router = createAppRouter();
// A 401 from any call: back to the sign-in page if the session really ended.
setUnauthorizedHandler(() => void handleUnauthorized(router));

createApp(App).use(i18n).use(router).mount('#app');
