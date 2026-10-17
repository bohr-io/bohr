// Site protection (Basic Auth) for projects that run in their owner's Cloudflare account.
//
// The deploy workflow wraps the site's Worker in a small gate module before `wrangler deploy`: the gate
// answers 401 unless the request carries valid credentials, then hands the request to the site (or to
// its static assets). The credentials live in the Worker secret BOHR_SITE_AUTH, which the instance sets
// and removes; without it the gate lets everything through, so turning protection on or off needs no deploy.

/** The Worker secret holding the protection settings (JSON of SiteProtection). */
export const SITE_AUTH_SECRET = 'BOHR_SITE_AUTH';
/** PBKDF2-SHA256 iterations for site passwords (workerd allows up to 100,000). */
export const SITE_PASSWORD_ITERATIONS = 20_000;

export type SiteAuthUser = { username: string; salt: string; hash: string; iterations: number };
export type SiteProtection = { users: SiteAuthUser[]; bypassPaths?: string[] };

/** A path that skips protection: exact, or a prefix when it ends with "*" (e.g. "/api/public/*"). */
export function isBypassed(pathname: string, bypassPaths: readonly string[] = []): boolean {
  return bypassPaths.some((path) => (path.endsWith('*') ? pathname.startsWith(path.slice(0, -1)) : pathname === path));
}

/**
 * The gate module (plain JavaScript). `__SITE__` is replaced by the import path of the site's entry module,
 * or the gate serves the static assets alone when the site has none.
 */
export const GATE_MODULE = `// Written by bohr's deploy workflow: Basic Auth in front of the site (secret BOHR_SITE_AUTH).
__IMPORT__
const encoder = new TextEncoder();
const verified = new Map();

function decodeBase64(text) {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function bypassed(pathname, paths) {
  return (paths || []).some((path) => (path.endsWith('*') ? pathname.startsWith(path.slice(0, -1)) : pathname === path));
}

async function authorized(header, users) {
  const match = /^basic +([A-Za-z0-9+/]+={0,2})$/i.exec((header || '').trim());
  const bytes = match ? decodeBase64(match[1]) : null;
  if (bytes === null) return false;
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  const cached = verified.get(header);
  if (cached !== undefined && cached > Date.now()) return true;
  for (const user of users || []) {
    if (user.username !== username) continue;
    const salt = decodeBase64(user.salt);
    const expected = decodeBase64(user.hash);
    if (salt === null || expected === null || expected.byteLength !== 32) continue;
    const actual = await pbkdf2(password, salt, user.iterations);
    if (crypto.subtle.timingSafeEqual(actual, expected)) {
      verified.set(header, Date.now() + 5 * 60_000);
      return true;
    }
  }
  return false;
}

/** A 401 when the request needs credentials it does not have; null to let it through. */
async function denied(request, env) {
  const raw = env && env.BOHR_SITE_AUTH;
  if (!raw) return null;
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    return new Response('Site protection is misconfigured.', { status: 500 });
  }
  const url = new URL(request.url);
  if (bypassed(url.pathname, settings.bypassPaths)) return null;
  if (await authorized(request.headers.get('Authorization'), settings.users)) return null;
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="' + url.hostname + '", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

const handler = typeof site === 'undefined' ? undefined : site.default;
let gate;
if (typeof handler === 'function') {
  // A WorkerEntrypoint class
  gate = class extends handler {
    async fetch(request) {
      return (await denied(request, this.env)) || super.fetch(request);
    }
  };
} else {
  gate = {
    ...(handler || {}),
    async fetch(request, env, ctx) {
      const answer = await denied(request, env);
      if (answer) return answer;
      if (handler && typeof handler.fetch === 'function') return handler.fetch(request, env, ctx);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    },
  };
}
export default gate;
`;

/**
 * A `strip(text)` function for the workflow's node scripts: removes // and /* *\/ comments outside strings, so
 * a wrangler.jsonc parses as JSON.
 */
export const JSONC_STRIP_SCRIPT = `const strip = (text) => {
  let out = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      out += c;
      if (c === '\\\\') out += text[++i] ?? '';
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\\n') i++;
      out += '\\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out;
};
`;

/**
 * The script the deploy workflow runs (with node, from the deploy folder): it finds the deployable wrangler
 * config (a JSON one; the Cloudflare Vite plugin's generated config wins), writes the gate next to it and a
 * copy of the config that uses it, and prints the copy's path. It prints nothing when the site cannot be
 * wrapped (a TOML config, or a non-JavaScript entry), and the workflow then deploys it as it is.
 */
export function gateSetupScript(): string {
  const gate = btoa(String.fromCharCode(...new TextEncoder().encode(GATE_MODULE)));
  return `const fs = require('node:fs');
const path = require('node:path');
${JSONC_STRIP_SCRIPT}let config = ['wrangler.jsonc', 'wrangler.json'].find((file) => fs.existsSync(file));
const redirect = path.join('.wrangler', 'deploy', 'config.json');
if (fs.existsSync(redirect)) {
  const target = JSON.parse(fs.readFileSync(redirect, 'utf8')).configPath;
  if (target) config = path.join(path.dirname(redirect), target);
}
if (!config) process.exit(0);
const dir = path.dirname(config);
const settings = JSON.parse(strip(fs.readFileSync(config, 'utf8')));
if (settings.main && !/\\.(m?[jt]s|[jt]sx)$/.test(settings.main)) process.exit(0);
const entry = settings.main ? './' + path.posix.normalize(settings.main.replaceAll('\\\\', '/')).replace(/^\\.\\//, '') : null;
const imports = entry ? "import * as site from '" + entry + "';\\nexport * from '" + entry + "';" : '';
const gate = Buffer.from('${gate}', 'base64').toString('utf8').replace('__IMPORT__', imports);
fs.writeFileSync(path.join(dir, '.bohr-gate.mjs'), gate);
settings.main = '.bohr-gate.mjs';
if (settings.assets) {
  settings.assets.binding = settings.assets.binding || 'ASSETS';
  // Static files must pass through the gate too
  settings.assets.run_worker_first = true;
}
const out = path.join(dir, 'wrangler.bohr-gate.json');
fs.writeFileSync(out, JSON.stringify(settings, null, 2));
process.stdout.write(out);
`;
}
