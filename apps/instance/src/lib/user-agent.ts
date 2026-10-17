import { BOHR_VERSION } from '../generated/version';

/** Sent with every call to the Cloudflare and GitHub APIs, so account owners can tell bohr's calls apart. */
export const USER_AGENT = `bohr/${BOHR_VERSION} (+https://bohr.io)`;
