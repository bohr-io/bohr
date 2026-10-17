/** Model the agent uses unless the project chooses another. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** Spending cap for one request, in US dollars; the agent stops when it is reached. */
export const DEFAULT_MAX_BUDGET_USD = 5;
/** Range a project's budget per request accepts (panel, API and Telegram's /budget), in US dollars. */
export const MIN_BUDGET_USD = 0.1;
export const MAX_BUDGET_USD = 1000;
/** Conversation turns allowed for one request. */
export const DEFAULT_MAX_TURNS = 200;
/** Branch the agent works on; production is the repository's default branch. */
export const WORK_BRANCH = 'homolog';
/** How long an invite code stays valid. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
