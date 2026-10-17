import type { Project } from './project';

export interface Env {
  PROJECT: DurableObjectNamespace<Project>;

  PROJECT_ID: string;
  PROJECT_NAME: string;
  REPO_OWNER: string;
  REPO_NAME: string;
  PRODUCTION_BRANCH: string;
  /** Base URL of the bohr instance that provisioned this project. */
  INSTANCE_URL: string;
  /** The instance's public JWK set (JSON); it signs the calls the web interface makes. */
  INSTANCE_JWKS: string;
  /** Preview ("homolog") URL, served by the preview Worker. */
  PREVIEW_URL: string;
  PRODUCTION_URL?: string;
  /** Member key of the owner (e.g. "tg:1001") and their name, seeded on first use. */
  OWNER_KEY: string;
  OWNER_NAME: string;
  DEFAULT_LOCALE?: string;
  /** How production deploys: "wrangler" (owner's account, Actions secrets) or "bohr-cloud" (managed hosting). */
  DEPLOY_TARGET?: string;
  CONTAINER_INSTANCE_TYPE?: string;

  /** Absent until the project bot is connected. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /**
   * Absent until the owner adds it; without it the agent stays off and pushes still deploy. With the
   * "subscription" provider it holds the owner's Claude subscription token (sk-ant-oat01-…) instead of a key.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * Which provider the owner chose in the panel: "anthropic" (API key), "compatible" (AGENT_BASE_URL) or
   * "subscription" (their Claude Pro/Max subscription through the official CLI's OAuth token).
   */
  AGENT_PROVIDER?: 'anthropic' | 'compatible' | 'subscription';
  /** An endpoint compatible with the Anthropic API instead of Anthropic's (its base URL); the key above is its key. */
  AGENT_BASE_URL?: string;
  /** The owner's model and effort from the panel's settings; bohr's defaults when absent. */
  AGENT_MODEL?: string;
  AGENT_EFFORT?: string;
  /** Shared with the instance; signs broker calls. */
  PROJECT_SECRET: string;
}
