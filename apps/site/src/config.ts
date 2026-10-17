// External destinations used across the site.
export const SITE_URL = 'https://bohr.io';
export const GITHUB_URL = 'https://github.com/bohr-io/bohr';
export const DEPLOY_BUTTON_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/bohr-io/bohr';
export const CLOUD_URL = 'https://app.bohr.io';
export const DISCORD_URL = 'https://discord.com/invite/p3hhfGg2Uy';
export const DOCS_URL = 'https://docs.bohr.io';

/** The documentation in the page's language: Portuguese has its own; Spanish reads the English one. */
export const docsUrl = (locale: string): string => (locale === 'pt-BR' ? `${DOCS_URL}/pt-br/` : `${DOCS_URL}/`);
export const CONTACT_EMAIL = 'contact@bohr.io';
export const CONTRIBUTORS_API_URL = 'https://api.github.com/repos/bohr-io/bohr/contributors';
