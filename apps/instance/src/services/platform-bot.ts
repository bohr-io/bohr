import { apiTokenTemplateUrl } from '@bohr/cloudflare';
import { type Locale, normalizeLocale } from '@bohr/shared';
import {
  callbackData,
  displayName,
  inlineKeyboard,
  managedBotKeyboard,
  newWebhookSecret,
  parseCallbackData,
  parseCommand,
  type SendMessageParams,
  suggestBotUsername,
  TelegramBot,
  type TelegramUpdate,
  type TelegramUser,
} from '@bohr/telegram';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  cfConnections,
  githubInstallations,
  identities,
  projectMembers,
  projects,
  runtimes,
  users,
} from '../db/schema';
import { deps } from '../deps';
import type { Env } from '../env';
import { instanceUrl } from '../lib/app-url';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { connectionsOf, userOwner } from '../lib/owner';
import { createCheckout } from '../routes/billing';
import { agentSettings } from './agent-settings';
import { audit } from './audit';
import {
  availableRepositories,
  checkSubscription,
  chooseCloudflareAccount,
  connectCloudflare,
  installUrl,
  nextStep,
  type OnboardingState,
  readOnboarding,
  writeOnboarding,
} from './onboarding';
import { PLATFORM_COMMANDS, type PlatformMessage, pt } from './platform-messages';
import { connectProjectBot, createProject } from './provision';
import { readSealedSetting, readSetting, writeSealedSetting, writeSetting } from './settings';

type PlatformBotInfo = { username: string; canManageBots: boolean };

const REPOSITORIES_PER_PAGE = 8;

export function platformBotClient(env: Env): TelegramBot | null {
  return env.TELEGRAM_BOT_TOKEN ? new TelegramBot({ token: env.TELEGRAM_BOT_TOKEN, fetch: deps.fetch }) : null;
}

export async function platformBotInfo(db: Db): Promise<PlatformBotInfo | null> {
  return readSetting<PlatformBotInfo>(db, 'platform_bot');
}

export async function platformWebhookSecret(db: Db, env: Env): Promise<string | null> {
  return readSealedSetting<string>(db, env, 'platform_bot_secret');
}

/** Points the platform bot's webhook at this instance and sets its command menu. */
export async function setupPlatformBot(db: Db, env: Env): Promise<PlatformBotInfo & { webhookUrl: string }> {
  const bot = platformBotClient(env);
  if (bot === null) throw new HttpError(409, 'Set the TELEGRAM_BOT_TOKEN secret first.');
  const base = await instanceUrl(db, env);
  if (base === null) throw new HttpError(409, 'Finish /setup first.');
  const me = await bot.getMe();
  if (!me.username) throw new HttpError(502, 'Telegram returned a bot without a username.');
  const secret = newWebhookSecret();
  await writeSealedSetting(db, env, 'platform_bot_secret', secret);
  const webhookUrl = `${base}/api/telegram/platform`;
  await bot.setWebhook({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query', 'managed_bot'],
    drop_pending_updates: true,
  });
  const menus: [Locale, string | undefined][] = [
    ['en', undefined],
    ['pt-BR', 'pt'],
    ['es', 'es'],
  ];
  for (const [locale, languageCode] of menus) {
    const commands =
      locale === 'pt-BR'
        ? [
            ['novo', 'Cria um projeto'],
            ['status', 'Lista seus projetos'],
            ['tentar', 'Refaz o último passo que falhou'],
          ]
        : locale === 'es'
          ? [
              ['new', 'Crea un proyecto'],
              ['status', 'Lista tus proyectos'],
              ['retry', 'Repite el último paso que falló'],
            ]
          : [
              ['new', 'Create a project'],
              ['status', 'List your projects'],
              ['retry', 'Repeat the last step that failed'],
            ];
    await bot.setMyCommands(
      commands.map(([command = '', description = '']) => ({ command, description })),
      languageCode ? { language_code: languageCode } : {},
    );
  }
  const info = { username: me.username, canManageBots: me.can_manage_bots === true };
  await writeSetting(db, 'platform_bot', info);
  await audit(db, { actor: 'admin', action: 'setup.platform_bot', target: me.username, metadata: info });
  return { ...info, webhookUrl };
}

/** The user behind a Telegram account, created on first contact. */
export async function telegramUser(db: Db, from: TelegramUser) {
  const identity = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'telegram'), eq(identities.providerUserId, String(from.id))))
    .get();
  if (identity !== undefined) {
    const user = await db.select().from(users).where(eq(users.id, identity.userId)).get();
    if (user !== undefined) return user;
  }
  const user = { id: randomId('u', 12), name: displayName(from), email: null };
  await db.insert(users).values(user).run();
  await db
    .insert(identities)
    .values({
      id: randomId('i', 12),
      userId: user.id,
      provider: 'telegram',
      providerUserId: String(from.id),
      username: from.username ?? null,
    })
    .run();
  await audit(db, {
    actorUserId: user.id,
    actor: `user:${user.id}`,
    action: 'signup',
    metadata: { provider: 'telegram' },
  });
  return { ...user, createdAt: new Date() };
}

/** A deep link that attaches a Telegram account to a web user: t.me/<bot>?start=link_<code>. */
export async function telegramLinkUrl(db: Db, userId: string): Promise<string | null> {
  const info = await platformBotInfo(db);
  if (info === null) return null;
  const code = randomToken(18);
  await writeSetting(db, `telegram_link:${await sha256Hex(code)}`, { userId, expiresAt: Date.now() + 15 * 60_000 });
  return `https://t.me/${info.username}?start=link_${code}`;
}

/** /start link_<code>: shows which bohr account the Telegram account would join, and waits for a yes. */
async function confirmLink(context: Context, code: string): Promise<void> {
  const entry = await readSetting<{ userId: string; expiresAt: number }>(
    context.db,
    `telegram_link:${await sha256Hex(code)}`,
  );
  if (entry === null || entry.expiresAt < Date.now()) {
    await say(context, 'linkInvalid');
    return;
  }
  const target = await context.db.select().from(users).where(eq(users.id, entry.userId)).get();
  const github = await context.db
    .select({ username: identities.username })
    .from(identities)
    .where(and(eq(identities.userId, entry.userId), eq(identities.provider, 'github')))
    .get();
  const account = [target?.name, github?.username ? `GitHub @${github.username}` : null].filter(Boolean).join(' · ');
  await say(
    context,
    'confirmLink',
    { account: account || entry.userId },
    {
      reply_markup: inlineKeyboard([
        [{ text: pt(context.locale, 'confirmLinkButton'), data: callbackData('link', code) }],
        [{ text: pt(context.locale, 'cancelButton'), data: callbackData('nolink') }],
      ]),
    },
  );
}

async function linkTelegram(db: Db, from: TelegramUser, code: string): Promise<boolean> {
  const key = `telegram_link:${await sha256Hex(code)}`;
  const entry = await readSetting<{ userId: string; expiresAt: number }>(db, key);
  if (entry === null || entry.expiresAt < Date.now()) return false;
  await writeSetting(db, key, { userId: entry.userId, expiresAt: 0 });
  const identity = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'telegram'), eq(identities.providerUserId, String(from.id))))
    .get();
  if (identity === undefined) {
    await db
      .insert(identities)
      .values({
        id: randomId('i', 12),
        userId: entry.userId,
        provider: 'telegram',
        providerUserId: String(from.id),
        username: from.username ?? null,
      })
      .run();
    return true;
  }
  if (identity.userId === entry.userId) return true;
  // The Telegram account already has its own bohr user (created when it first wrote to the bot): move it
  // only if that user has nothing of its own yet.
  const [member, connection, installation] = await Promise.all([
    db.select().from(projectMembers).where(eq(projectMembers.userId, identity.userId)).get(),
    db.select().from(cfConnections).where(eq(cfConnections.userId, identity.userId)).get(),
    db.select().from(githubInstallations).where(eq(githubInstallations.userId, identity.userId)).get(),
  ]);
  if (member !== undefined || connection !== undefined || installation !== undefined) return false;
  await db.update(identities).set({ userId: entry.userId }).where(eq(identities.id, identity.id)).run();
  return true;
}

type Context = {
  db: Db;
  env: Env;
  bot: TelegramBot;
  info: PlatformBotInfo;
  chatId: number;
  locale: Locale;
  userId: string;
  startProvisioning: (params: { projectId: string; userId: string; locale?: string }) => Promise<void>;
};

const say = (
  context: Context,
  key: PlatformMessage,
  params: Record<string, string | number> = {},
  extra: Partial<SendMessageParams> = {},
) =>
  context.bot.sendMessage({
    chat_id: context.chatId,
    text: pt(context.locale, key, params),
    link_preview_options: { is_disabled: true },
    ...extra,
  });

async function forget(context: Context, messageId: number) {
  // Messages with tokens and keys are deleted as soon as they are read
  await context.bot.deleteMessage(context.chatId, messageId).catch(() => {});
}

async function prompt(context: Context, state: OnboardingState): Promise<void> {
  const { db, env } = context;
  switch (state.step) {
    case 'subscription': {
      const user = await db.select().from(users).where(eq(users.id, context.userId)).get();
      const base = (await instanceUrl(db, env)) ?? '';
      const url = await createCheckout(db, env, { id: context.userId, email: user?.email ?? null }, base);
      await say(
        context,
        'askSubscription',
        {},
        {
          reply_markup: inlineKeyboard([
            [{ text: pt(context.locale, 'payButton'), url }],
            [{ text: pt(context.locale, 'paidButton'), data: callbackData('paid') }],
          ]),
        },
      );
      return;
    }
    case 'cloudflare':
      await say(context, 'askCloudflare', { url: apiTokenTemplateUrl({ name: 'bohr' }) });
      return;
    case 'cloudflare_account':
      await say(
        context,
        'chooseAccount',
        {},
        {
          reply_markup: inlineKeyboard(
            (state.pendingAccounts ?? []).map((account, index) => [
              { text: account.name.slice(0, 60), data: callbackData('acct', index) },
            ]),
          ),
        },
      );
      return;
    case 'github':
      await say(
        context,
        'askGithub',
        {},
        {
          reply_markup: inlineKeyboard([
            [{ text: pt(context.locale, 'installButton'), url: await installUrl(db, env, context.userId, 'telegram') }],
            [{ text: pt(context.locale, 'installedButton'), data: callbackData('gh', 'check') }],
          ]),
        },
      );
      return;
    case 'repository':
      await showRepositories(context, state, 0);
      return;
    case 'provisioning': {
      const project = state.projectId
        ? await db.select().from(projects).where(eq(projects.id, state.projectId)).get()
        : undefined;
      await say(context, 'provisioning', { repo: project ? `${project.repoOwner}/${project.repoName}` : '' });
      return;
    }
    case 'project_bot':
      await askProjectBot(context, state);
      return;
    case 'done':
      await say(context, 'onboardingDone');
      return;
  }
}

/** After a step: the next required one, or the end of the onboarding (projects come with /new). */
async function continueOnboarding(context: Context, state: OnboardingState): Promise<void> {
  const step = await nextStep(context.db, context.env, context.userId, state);
  await writeOnboarding(context.db, context.userId, { ...state, step });
  await prompt(context, { ...state, step });
}

async function showRepositories(context: Context, state: OnboardingState, page: number): Promise<void> {
  const repositories = (await availableRepositories(context.db, context.env, context.userId)).map((repo) => ({
    id: repo.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
  }));
  if (repositories.length === 0) {
    await writeOnboarding(context.db, context.userId, { ...state, step: 'github' });
    await say(
      context,
      'noRepositories',
      {},
      {
        reply_markup: inlineKeyboard([
          [
            {
              text: pt(context.locale, 'installButton'),
              url: await installUrl(context.db, context.env, context.userId, 'telegram'),
            },
          ],
          [{ text: pt(context.locale, 'installedButton'), data: callbackData('gh', 'check') }],
        ]),
      },
    );
    return;
  }
  await writeOnboarding(context.db, context.userId, { ...state, step: 'repository', repositories });
  const start = page * REPOSITORIES_PER_PAGE;
  const rows = repositories
    .slice(start, start + REPOSITORIES_PER_PAGE)
    .map((repo) => [{ text: repo.fullName.slice(0, 60), data: callbackData('repo', repo.id) }]);
  if (start + REPOSITORIES_PER_PAGE < repositories.length) {
    rows.push([{ text: pt(context.locale, 'moreButton'), data: callbackData('repos', page + 1) }]);
  }
  await say(context, 'chooseRepository', {}, { reply_markup: inlineKeyboard(rows) });
}

async function askProjectBot(context: Context, state: OnboardingState): Promise<void> {
  const project = state.projectId
    ? await context.db.select().from(projects).where(eq(projects.id, state.projectId)).get()
    : undefined;
  if (!context.info.canManageBots || project === undefined) {
    await say(context, 'askProjectBotManual', {}, { reply_markup: { remove_keyboard: true } });
    return;
  }
  await say(
    context,
    'askProjectBot',
    {},
    {
      reply_markup: managedBotKeyboard(pt(context.locale, 'createBotButton'), {
        requestId: Math.floor(Math.random() * 2 ** 31),
        suggestedName: project.name.slice(0, 64),
        suggestedUsername: suggestBotUsername(project.name, randomId('', 4)),
      }),
    },
  );
}

async function finishWithBot(context: Context, state: OnboardingState, token: string): Promise<void> {
  if (state.projectId === undefined) return;
  const bot = await connectProjectBot(context.db, context.env, state.projectId, token);
  const agentOn = (await agentSettings(context.db, context.env, context.userId)) !== null;
  await writeOnboarding(context.db, context.userId, { ...state, step: 'done' });
  await say(
    context,
    agentOn ? 'done' : 'doneNoAgent',
    { bot: bot.username },
    { reply_markup: { remove_keyboard: true } },
  );
}

/** One update from the platform bot's webhook. */
export async function handlePlatformUpdate(
  db: Db,
  env: Env,
  update: TelegramUpdate,
  startProvisioning: Context['startProvisioning'],
): Promise<void> {
  const bot = platformBotClient(env);
  const info = await platformBotInfo(db);
  if (bot === null || info === null) return;
  const from = update.message?.from ?? update.callback_query?.from ?? update.managed_bot?.user;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? update.managed_bot?.user.id;
  if (from === undefined || chatId === undefined || from.is_bot) return;
  if (update.message !== undefined && update.message.chat.type !== 'private') return;

  const user = await telegramUser(db, from);
  const state = await readOnboarding(db, user.id);
  const context: Context = {
    db,
    env,
    bot,
    info,
    chatId,
    locale: normalizeLocale(from.language_code, normalizeLocale(state.locale, 'en')),
    userId: user.id,
    startProvisioning,
  };
  if (state.chatId !== chatId || state.locale !== context.locale) {
    state.chatId = chatId;
    state.locale = context.locale;
    await writeOnboarding(db, user.id, state);
  }

  try {
    // A bot the user just created through the platform bot (Bot API 9.6 managed bots)
    const created = update.managed_bot?.bot ?? update.message?.managed_bot_created?.bot;
    if (created !== undefined) {
      if (state.step === 'project_bot') await finishWithBot(context, state, await bot.getManagedBotToken(created.id));
      return;
    }
    if (update.callback_query !== undefined) {
      await bot.answerCallbackQuery({ callback_query_id: update.callback_query.id }).catch(() => {});
      await handleCallback(context, state, update.callback_query.data);
      return;
    }
    const message = update.message;
    if (message?.text === undefined) return;
    const command = parseCommand(message, info.username);
    if (command !== null) {
      await handleCommand(context, state, PLATFORM_COMMANDS[command.command] ?? 'help', command.args, from);
      return;
    }
    await handleText(context, state, message.text, message.message_id);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await say(context, 'error', { error: text.slice(0, 300) });
  }
}

async function handleCommand(
  context: Context,
  state: OnboardingState,
  action: string,
  args: string,
  from: TelegramUser,
): Promise<void> {
  const { db, userId } = context;
  switch (action) {
    case 'start': {
      if (args.startsWith('link_')) {
        await confirmLink(context, args.slice(5));
        return;
      }
      await say(context, 'welcome', { name: displayName(from) });
      const step = await nextStep(db, context.env, userId, state);
      await writeOnboarding(db, userId, { ...state, step });
      await prompt(context, { ...state, step });
      return;
    }
    case 'new': {
      const { projectId: _previous, repositories: _list, ...rest } = state;
      const step = await nextStep(db, context.env, userId, { ...rest, step: 'cloudflare' });
      if (step !== 'done') {
        // The onboarding first: projects need everything it sets up
        await writeOnboarding(db, userId, { ...rest, step });
        await prompt(context, { ...rest, step });
        return;
      }
      await showRepositories(context, { ...rest, step: 'repository' }, 0);
      return;
    }
    case 'status': {
      const rows = await db
        .select({ project: projects, runtime: runtimes })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .leftJoin(runtimes, eq(runtimes.projectId, projects.id))
        .where(eq(projectMembers.userId, userId))
        .all();
      if (rows.length === 0) {
        await say(context, 'noProjects');
        return;
      }
      const list = rows
        .map(({ project, runtime }) => {
          const bot = runtime?.telegramBotUsername ? ` · @${runtime.telegramBotUsername}` : '';
          return `• ${project.repoOwner}/${project.repoName}: ${runtime?.status ?? 'managed'}${bot}`;
        })
        .join('\n');
      await say(context, 'status', { list });
      return;
    }
    case 'retry': {
      if (state.projectId !== undefined) {
        const runtime = await db.select().from(runtimes).where(eq(runtimes.projectId, state.projectId)).get();
        if (runtime?.status === 'error') {
          await writeOnboarding(db, userId, { ...state, step: 'provisioning' });
          await context.startProvisioning({ projectId: state.projectId, userId, locale: context.locale });
          await prompt(context, { ...state, step: 'provisioning' });
          return;
        }
      }
      await prompt(context, state);
      return;
    }
    case 'skip':
      if (state.step === 'project_bot') {
        await writeOnboarding(db, userId, { ...state, step: 'done' });
        await say(context, 'projectBotSkipped', {}, { reply_markup: { remove_keyboard: true } });
        return;
      }
      await prompt(context, state);
      return;
    default:
      await say(context, 'help');
  }
}

async function handleText(context: Context, state: OnboardingState, text: string, messageId: number): Promise<void> {
  const { db, env, userId } = context;
  switch (state.step) {
    case 'cloudflare': {
      await forget(context, messageId);
      const result = await connectCloudflare(db, env, userId, text);
      if (result.status === 'missing') {
        await say(context, 'cloudflareMissing', { missing: result.missing.join(', ') });
        return;
      }
      if (result.status === 'choose_account') {
        await prompt(context, await readOnboarding(db, userId));
        return;
      }
      await say(context, 'cloudflareConnected', { account: result.accountName ?? '' });
      const next = await readOnboarding(db, userId);
      const step = await nextStep(db, context.env, userId, next);
      await writeOnboarding(db, userId, { ...next, step });
      await prompt(context, { ...next, step });
      return;
    }
    case 'project_bot':
      if (/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(text.trim())) {
        await forget(context, messageId);
        await finishWithBot(context, state, text.trim());
        return;
      }
      await askProjectBot(context, state);
      return;
    default:
      await prompt(context, state);
  }
}

async function handleCallback(context: Context, state: OnboardingState, data: string | undefined): Promise<void> {
  const { db, env, userId } = context;
  const parsed = parseCallbackData(data);
  if (parsed === null) return;
  switch (parsed.action) {
    case 'link': {
      const from = { id: context.chatId } as TelegramUser;
      await say(context, (await linkTelegram(db, from, parsed.args[0] ?? '')) ? 'linked' : 'linkInvalid');
      return;
    }
    case 'nolink':
      await say(context, 'linkCancelled');
      return;
    case 'paid': {
      if ((await checkSubscription(db, env, userId)).status === 'payment_required') {
        await say(context, 'notSubscribedYet');
        return;
      }
      await prompt(context, await readOnboarding(db, userId));
      return;
    }
    case 'acct': {
      const account = state.pendingAccounts?.[Number(parsed.args[0])];
      if (account === undefined) {
        await prompt(context, { ...state, step: 'cloudflare' });
        return;
      }
      const result = await chooseCloudflareAccount(db, env, userId, account.id);
      if (result.status === 'missing') {
        await say(context, 'cloudflareMissing', { missing: result.missing.join(', ') });
        return;
      }
      await say(context, 'cloudflareConnected', { account: account.name });
      const next = await readOnboarding(db, userId);
      const step = await nextStep(db, context.env, userId, next);
      await writeOnboarding(db, userId, { ...next, step });
      await prompt(context, { ...next, step });
      return;
    }
    case 'gh':
      await continueOnboarding(context, state);
      return;
    case 'repos':
      await showRepositories(context, state, Number(parsed.args[0]) || 0);
      return;
    case 'repo': {
      if (state.step !== 'repository') {
        await prompt(context, state);
        return;
      }
      const repo = state.repositories?.find((candidate) => candidate.id === Number(parsed.args[0]));
      if (repo === undefined) {
        await showRepositories(context, state, 0);
        return;
      }
      const [repoOwner = '', repoName = ''] = repo.fullName.split('/');
      const connection = await db
        .select()
        .from(cfConnections)
        .where(connectionsOf(userOwner(userId)))
        .get();
      if (connection === undefined) {
        await prompt(context, { ...state, step: 'cloudflare' });
        return;
      }
      const { projectId, runtime } = await createProject(db, env, userId, {
        repoOwner,
        repoName,
        repoId: repo.id,
        productionBranch: repo.defaultBranch,
        name: repoName,
        cfConnectionId: connection.id,
      });
      if (!runtime) {
        // A self-hosted instance whose account cannot run Containers: the project only deploys for now
        await writeOnboarding(db, userId, { ...state, step: 'done', projectId });
        await say(context, 'agentUnavailable', { repo: repo.fullName });
        return;
      }
      const next: OnboardingState = { ...state, step: 'provisioning', projectId };
      await writeOnboarding(db, userId, next);
      await context.startProvisioning({ projectId, userId, locale: context.locale });
      await prompt(context, next);
      return;
    }
  }
}

/** Called when a provisioning Workflow ends: the next step goes to the user's Telegram chat, when they have one. */
export async function notifyProvisioned(
  db: Db,
  env: Env,
  userId: string,
  projectId: string,
  error: string | null,
): Promise<void> {
  const state = await readOnboarding(db, userId);
  const followed = state.projectId === projectId && state.step === 'provisioning';
  if (followed && error === null) await writeOnboarding(db, userId, { ...state, step: 'project_bot' });
  const bot = platformBotClient(env);
  const info = await platformBotInfo(db);
  if (bot === null || info === null || state.chatId === undefined || state.projectId !== projectId) return;
  const locale = normalizeLocale(state.locale, 'en');
  if (error !== null) {
    await bot.sendMessage({
      chat_id: state.chatId,
      text: pt(locale, 'provisionFailed', { error: error.slice(0, 500) }),
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  const agentOn = (await agentSettings(db, env, userId)) !== null;
  const context: Context = {
    db,
    env,
    bot,
    info,
    chatId: state.chatId,
    locale,
    userId,
    startProvisioning: async () => {},
  };
  await say(context, agentOn ? 'provisionedAgentWorking' : 'provisionedNoAgent', {
    repo: project ? `${project.repoOwner}/${project.repoName}` : '',
  });
  if (followed) await askProjectBot(context, { ...state, step: 'project_bot' });
}

/** Sends the install-complete message after GitHub redirects a user who started in Telegram. */
export async function notifyInstallation(db: Db, env: Env, userId: string): Promise<void> {
  const bot = platformBotClient(env);
  const info = await platformBotInfo(db);
  const state = await readOnboarding(db, userId);
  if (bot === null || info === null || state.chatId === undefined) return;
  const context: Context = {
    db,
    env,
    bot,
    info,
    chatId: state.chatId,
    locale: normalizeLocale(state.locale, 'en'),
    userId,
    startProvisioning: async () => {},
  };
  await continueOnboarding(context, state);
}
