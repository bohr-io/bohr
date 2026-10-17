import { z } from 'zod';

// The subset of Bot API types bohr reads from updates. Unknown fields are dropped.

export const userSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  /** Returned only by getMe: other bots can be created to be managed by this one. */
  can_manage_bots: z.boolean().optional(),
});
export type TelegramUser = z.infer<typeof userSchema>;

export const chatSchema = z.object({
  id: z.number().int(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
  username: z.string().optional(),
});
export type TelegramChat = z.infer<typeof chatSchema>;

export const entitySchema = z.object({
  type: z.string(),
  offset: z.number().int(),
  length: z.number().int(),
});

export const messageSchema = z.object({
  message_id: z.number().int(),
  message_thread_id: z.number().int().optional(),
  date: z.number().int(),
  chat: chatSchema,
  from: userSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(entitySchema).optional(),
  /** Only who wrote the replied-to message is kept. */
  reply_to_message: z.object({ message_id: z.number().int(), from: userSchema.optional() }).optional(),
  /** Service message: the user created a bot managed by this bot (Bot API 9.6). */
  managed_bot_created: z.object({ bot: userSchema }).optional(),
});
export type TelegramMessage = z.infer<typeof messageSchema>;

export const callbackQuerySchema = z.object({
  id: z.string(),
  from: userSchema,
  // An inaccessible message only carries chat, message_id and date 0.
  message: z.object({ message_id: z.number().int(), chat: chatSchema, date: z.number().int() }).optional(),
  data: z.string().optional(),
});
export type TelegramCallbackQuery = z.infer<typeof callbackQuerySchema>;

export const managedBotUpdatedSchema = z.object({ user: userSchema, bot: userSchema });
export type ManagedBotUpdated = z.infer<typeof managedBotUpdatedSchema>;

export const updateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
  /** A managed bot was created, or its token or owner changed (Bot API 9.6). */
  managed_bot: managedBotUpdatedSchema.optional(),
});
export type TelegramUpdate = z.infer<typeof updateSchema>;

export type InlineKeyboardButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][] };
export type KeyboardButton = {
  text: string;
  request_managed_bot?: { request_id: number; suggested_name?: string; suggested_username?: string };
};
export type ReplyKeyboardMarkup = {
  keyboard: KeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};
export type ReplyKeyboardRemove = { remove_keyboard: true };
export type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

export type BotCommand = { command: string; description: string };
export type BotCommandScope =
  | { type: 'default' }
  | { type: 'all_private_chats' }
  | { type: 'all_group_chats' }
  | { type: 'chat'; chat_id: number };

export type WebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};
