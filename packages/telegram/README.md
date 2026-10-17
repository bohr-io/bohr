# @bohr/telegram

A small Telegram Bot API client for Workers, used by the platform bot (instance) and the project bots (project Workers).

- `TelegramBot`: the methods bohr calls (messages, edits, callback answers, webhooks, command menus) and the managed bot methods from Bot API 9.6 and 10.0 (`getManagedBotToken`, `replaceManagedBotToken`, `setManagedBotAccessSettings`). It waits once when Telegram asks to slow down, and treats "message is not modified" as success.
- `readWebhookUpdate`: checks `X-Telegram-Bot-Api-Secret-Token` in constant time and parses the subset of updates bohr reads.
- `parseCommand`, `splitMessage`, `escapeHtml`, `displayName`: message helpers.
- `inlineKeyboard`, `callbackData`, `managedBotKeyboard`, `newManagedBotLink`, `suggestBotUsername`: keyboards and links, including the button that asks a user to create a bot managed by the platform bot.
