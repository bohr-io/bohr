// Formats the instance checks before calling Cloudflare, Anthropic or Telegram. Checking them here
// gives a translated message right away; the instance still has the last word.
export { BOT_TOKEN_PATTERN } from './telegram';

export const CLOUDFLARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{30,100}$/;
export const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
/** The long-lived token `claude setup-token` creates for a Claude subscription. */
export const CLAUDE_TOKEN_PATTERN = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/;
/** The authorization code claude.ai shows: no spaces or control characters. */
export const CLAUDE_CODE_PATTERN = /^[^\s\p{Cc}]{1,512}$/u;
/** Longest chat message the runtime accepts. */
export const MAX_MESSAGE_LENGTH = 20_000;

/** Environment variable names the instance accepts. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

/** Names the platform uses itself (GitHub's, the deploy credentials and bohr's); the instance refuses them. */
export function reservedVariable(key: string): boolean {
  return /^(GITHUB_|CLOUDFLARE_|BOHR_)/.test(key) || key === 'CI';
}

/** Basic Auth usernames: no spaces and no ":". */
export const SITE_USERNAME = /^[^:\s]{1,100}$/;

/** Paths that skip the site's protection: they start with "/" and have no spaces. */
export const BYPASS_PATH = /^\/\S{0,299}$/;

/** A domain name (no wildcards), as the instance checks it. */
export const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
