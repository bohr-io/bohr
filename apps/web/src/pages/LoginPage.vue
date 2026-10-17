<template>
  <div class="login">
    <div class="login__inner">
      <BohrLogo class="login__logo" :title="t('login.logo')" />
      <h1 class="login__title" :style="{ '--line1-chars': line1.length, '--line2-chars': line2.length }">
        <span class="login__line1">{{ line1 }}</span>{{ ' ' }}<span class="login__line2">{{ line2 }}</span>
      </h1>
      <p class="login__lead">{{ t('login.lead') }}</p>

      <div v-if="farewell !== null" class="notice notice--success login__notice" role="status" data-notice="farewell">
        <strong class="notice__title">{{ t('login.farewellTitle') }}</strong>
        <p>{{ t('login.farewell') }}</p>
        <p v-if="farewell.warnings.length > 0">{{ t('login.farewellWarnings', { list: farewell.warnings.join('; ') }) }}</p>
      </div>

      <div v-if="notSetUp" class="notice notice--warn login__notice" role="status">
        <strong class="notice__title">{{ t('login.notSetUpTitle') }}</strong>
        <p>
          {{ t('login.notSetUp') }}
          <a href="/setup" class="text-link">{{ t('login.setupLink') }}</a>
        </p>
      </div>

      <div v-if="methods !== null" class="login__methods">
        <div v-if="methods.github" class="login__actions">
          <BohrButton size="lg" :href="githubHref" :disabled="notSetUp">
            <template #iconLeft><GithubIcon :size="16" /></template>
            {{ t('login.github') }}
          </BohrButton>
        </div>
        <p v-if="methods.github && methods.email" class="login__or" aria-hidden="true">
          <span>{{ t('common.or') }}</span>
        </p>
        <div v-if="methods.email" class="login__email" data-method="email">
          <EmailCodeForm
            :start="startEmail"
            :verify="verifyEmail"
            :submit-label="t('login.emailSubmit')"
            :verify-label="t('login.emailVerify')"
            :hint="demo ? t('login.demoCode', { code: DEMO_CODE }) : undefined"
            :variant="methods.github ? 'ghost' : 'default'"
            full-width
          />
        </div>
        <p v-if="!methods.github && !methods.email" class="notice notice--warn login__notice" role="status">
          {{ t('login.noMethods') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BohrButton, BohrLogo, GithubIcon } from '@bohr/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { type AuthMethods, api, type InstanceInfo, safeRedirect } from '../api';
import EmailCodeForm from '../components/EmailCodeForm.vue';
import { loadSession, takeFarewell } from '../session';

/** The code the demo instance accepts (demo/mock-api.ts). */
const DEMO_CODE = '123456';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const line1 = computed(() => t('login.line1'));
const line2 = computed(() => t('login.line2'));

/** Where to go after signing in: a same-origin path from ?redirect=, else the projects. */
const target = computed(() => safeRedirect(route.query.redirect));
const githubHref = computed(() => `/auth/github?redirect=${encodeURIComponent(target.value)}`);

/** `vite --mode demo`: the page tells which code the demo accepts. */
const demo = import.meta.env.MODE === 'demo';

/** Right after deleting the account. */
const farewell = ref(takeFarewell());
const instance = ref<InstanceInfo | null>(null);
/** null until known; offers GitHub only when the instance does not say. */
const methods = ref<AuthMethods | null>(null);
/** GitHub sign-in needs the instance's GitHub App, which the admin creates at /setup. */
const notSetUp = computed(() => instance.value?.setup.githubApp === false);

function startEmail(email: string) {
  return api.emailStart({ email, redirect: target.value, locale: locale.value });
}

/** The session cookie is set: load the user and go where the instance says. */
async function verifyEmail(email: string, code: string) {
  const { redirect } = await api.emailVerify({ email, code });
  await loadSession(true).catch(() => null);
  await router.replace(safeRedirect(redirect, target.value));
}

onMounted(async () => {
  const facts = Promise.all([
    api.instance().catch(() => null),
    api.authMethods().catch((): AuthMethods => ({ github: true, email: false })),
  ]);
  try {
    // Already signed in (e.g. the back button after signing in): go straight on.
    if ((await loadSession()) !== null) {
      await router.replace(target.value);
      return;
    }
  } catch {
    // The instance did not answer; the sign-in buttons still work.
  }
  [instance.value, methods.value] = await facts;
});
</script>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 48px var(--gutter);
  text-align: center;
}

.login__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 760px;
}

.login__logo {
  width: 150px;
  height: auto;
}

/* The site's display type, smaller: two overlapping gradient lines that shrink with their length. */
.login__title {
  --available: min(760px, calc(100vw - 2 * var(--gutter)));
  --size: min(128px, calc(var(--available) / (var(--line1-chars) * 0.52 + 0.2)));

  margin: clamp(28px, 6vw, 56px) 0 0;
  font-size: var(--size);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: var(--bohr-letter-spacing-display);
  word-spacing: 0.08em;
}

.login__line1,
.login__line2 {
  display: block;
  width: fit-content;
  margin-inline: auto;
  padding-right: 0.1em;
  padding-bottom: 0.12em;
  white-space: nowrap;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
}

.login__line1 {
  margin-bottom: -0.12em;
  background-image: var(--bohr-gradient-fire);
}

.login__line2 {
  position: relative;
  margin-top: -0.62em;
  padding-left: 0.6em;
  font-size: min(0.71em, calc(var(--available) / (var(--line2-chars) * 0.52 + 0.9)));
  background-image: var(--bohr-gradient-cool);
  filter: var(--bohr-shadow-display);
}

.login__lead {
  max-width: 560px;
  margin-top: clamp(20px, 4vw, 32px);
  font-size: clamp(16px, 2vw, 18px);
  line-height: 1.55;
  color: var(--bohr-color-text-muted);
}

.login__notice {
  max-width: 560px;
  margin-top: 28px;
  text-align: left;
}

.login__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-top: 36px;
}

.login__methods {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.login__or {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 400px;
  margin-top: 28px;
  font-size: 13px;
  text-transform: uppercase;
  color: var(--bohr-color-text-muted);
}

.login__or::before,
.login__or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: hsl(0 0% 100% / 0.15);
}

.login__email {
  width: 100%;
  max-width: 400px;
  margin-top: 28px;
}

.login__actions + .login__email {
  margin-top: 36px;
}

@media (max-width: 479px) {
  .login__actions > * {
    width: 100%;
  }
}
</style>
