import { MAX_BUDGET_USD, MIN_BUDGET_USD, memberKey, normalizeLocale } from '@bohr/shared';
import {
  displayName,
  parseCallbackData,
  parseCommand,
  type TelegramBot,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
} from '@bohr/telegram';
import { COMMANDS, formatCost, t } from './messages';
import type { Actor, Origin, Project } from './project';

/** Turns one update from the project bot's webhook into project actions and replies. */
export async function handleTelegramUpdate(project: Project, update: TelegramUpdate): Promise<void> {
  const bot = project.bot();
  if (bot === null) return;
  const username = await project.ensureBotSetup(bot);
  if (update.callback_query !== undefined) {
    await handleCallback(project, bot, update.callback_query);
    return;
  }
  const message = update.message;
  if (message?.from === undefined || message.from.is_bot || message.text === undefined) return;
  await handleMessage(project, bot, message, message.from, message.text, username);
}

function isForThisBot(message: TelegramMessage, username: string | null, botId: number): boolean {
  if (message.chat.type === 'private') return true;
  if (message.reply_to_message?.from?.id === botId) return true;
  return username !== null && (message.text ?? '').toLowerCase().includes(`@${username.toLowerCase()}`);
}

async function handleMessage(
  project: Project,
  bot: TelegramBot,
  message: TelegramMessage,
  from: TelegramUser,
  messageText: string,
  username: string | null,
): Promise<void> {
  const locale = normalizeLocale(from.language_code, project.locale);
  const origin: Origin = { source: 'telegram', chatId: message.chat.id, messageId: message.message_id, locale };
  const key = memberKey({ telegramUserId: from.id });
  const name = displayName(from);
  const reply = async (text: string) => {
    try {
      await bot.sendMessage({
        chat_id: message.chat.id,
        text,
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error('[telegram] Reply failed:', error instanceof Error ? error.message : error);
    }
  };

  const command = parseCommand(message, username ?? undefined);
  const action = command === null ? null : (COMMANDS[command.command] ?? 'help');
  if (command === null && !isForThisBot(message, username, bot.id)) return;

  if (action === 'join') {
    const result = await project.join({ key, name }, command?.args ?? '');
    if (result === 'joined') {
      await reply(t(locale, 'joined', { name, project: project.projectName }));
    } else {
      await reply(t(locale, result === 'member' ? 'alreadyMember' : 'inviteInvalid'));
    }
    return;
  }

  const actor = await project.actorForTelegram(key, name);
  if (actor === null) {
    // In groups, stay quiet unless someone talks to the bot directly with a command.
    if (message.chat.type === 'private' || command !== null) {
      await reply(t(locale, 'noAccess', { project: project.projectName }));
    }
    return;
  }
  project.rememberNoticeChat(actor, message.chat.id);

  if (command === null) {
    // Usernames are case-insensitive: "@Loja_Bot" and "@loja_bot" both address the bot.
    const text = username === null ? messageText : messageText.replace(new RegExp(`@${username}\\b`, 'gi'), '');
    const result = await project.submit(actor, text, origin);
    if (!result.posted) await reply(result.text);
    return;
  }

  await runCommand(project, actor, action ?? 'help', command.args, origin, reply, username);
}

async function runCommand(
  project: Project,
  actor: Actor,
  action: string,
  args: string,
  origin: Origin & { source: 'telegram' },
  reply: (text: string) => Promise<void>,
  username: string | null,
): Promise<void> {
  const locale = origin.locale;
  switch (action) {
    case 'start':
      await reply(
        `${t(locale, 'welcome', { name: actor.name, project: project.projectName })}\n\n${t(locale, 'help')}`,
      );
      await project.offerPendingDecision(origin.chatId, locale);
      return;
    case 'status':
      await reply(project.statusText(locale));
      await project.offerPendingDecision(origin.chatId, locale);
      return;
    case 'approve':
    case 'discard':
      // A typed command does not say which version the member reviewed: show the current one with its buttons
      if (!(await project.offerPendingDecision(origin.chatId, locale))) {
        await reply(t(locale, project.homolog().status === 'publishing' ? 'publishing' : 'nothingToApprove'));
      }
      return;
    case 'cancel':
      await reply(await project.cancel(actor, null, origin));
      return;
    case 'rollback':
      await reply(await project.rollback(actor, origin));
      return;
    case 'invite': {
      const invite = await project.createInvite(actor);
      await reply(
        invite === null
          ? t(locale, 'ownerOnly')
          : t(locale, 'inviteCreated', { code: invite.code, bot: username === null ? 'bot' : `@${username}` }),
      );
      return;
    }
    case 'members': {
      const lines = project.store.members().map((member, index) =>
        t(locale, 'memberLine', {
          index: index + 1,
          name: member.name,
          role: t(locale, member.role === 'owner' ? 'roleOwner' : 'roleMember'),
        }),
      );
      await reply([t(locale, 'membersTitle', { project: project.projectName }), ...lines].join('\n'));
      return;
    }
    case 'revoke': {
      const { result, name } = project.revoke(actor, args.trim());
      const key = {
        revoked: 'revoked',
        owner_only: 'ownerOnly',
        not_found: 'memberNotFound',
        owner: 'cannotRevokeOwner',
      } as const;
      await reply(t(locale, key[result], { name: name ?? '' }));
      return;
    }
    case 'model': {
      const model = args.trim();
      if (model.length === 0 || model.length > 100 || /\s/.test(model)) {
        await reply(t(locale, 'modelUsage', { model: project.state(actor).settings.model }));
        return;
      }
      await reply(project.updateSettings(actor, { model }) ? t(locale, 'modelSet', { model }) : t(locale, 'ownerOnly'));
      return;
    }
    case 'budget': {
      const budget = Number(
        args
          .trim()
          .replace(',', '.')
          .replace(/^US\$\s*|^\$/i, ''),
      );
      if (!Number.isFinite(budget) || budget < MIN_BUDGET_USD || budget > MAX_BUDGET_USD) {
        await reply(
          t(locale, 'invalidBudget', {
            min: formatCost(locale, MIN_BUDGET_USD),
            max: formatCost(locale, MAX_BUDGET_USD),
          }),
        );
        return;
      }
      await reply(
        project.updateSettings(actor, { maxBudgetUsd: budget })
          ? t(locale, 'budgetSet', { budget: formatCost(locale, budget) })
          : t(locale, 'ownerOnly'),
      );
      return;
    }
    default:
      await reply(t(locale, 'help'));
  }
}

async function handleCallback(project: Project, bot: TelegramBot, query: TelegramCallbackQuery): Promise<void> {
  const locale = normalizeLocale(query.from.language_code, project.locale);
  const answer = async (text: string, alert = false) => {
    try {
      await bot.answerCallbackQuery({ callback_query_id: query.id, text: text.slice(0, 200), show_alert: alert });
    } catch (error) {
      console.error('[telegram] Callback answer failed:', error instanceof Error ? error.message : error);
    }
  };
  const actor = await project.actorForTelegram(memberKey({ telegramUserId: query.from.id }), displayName(query.from));
  if (actor === null) {
    await answer(t(locale, 'noAccess', { project: project.projectName }), true);
    return;
  }
  const data = parseCallbackData(query.data);
  const chatId = query.message?.chat.id;
  if (data === null || chatId === undefined) {
    await answer(t(locale, 'error'));
    return;
  }
  const origin: Origin = { source: 'telegram', chatId, locale };
  switch (data.action) {
    case 'approve':
    case 'discard':
      await answer(await project.decide(actor, data.action, Number(data.args[0]), origin));
      return;
    case 'answer':
      await answer((await project.answer(actor, data.args[0] ?? '', Number(data.args[1]), origin)).text);
      return;
    case 'cancel':
      await answer(await project.cancel(actor, data.args[0] ?? null, origin));
      return;
    default:
      await answer(t(locale, 'error'));
  }
}
