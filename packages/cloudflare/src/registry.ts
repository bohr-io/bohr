import type { CloudflareClient } from './client';
import { createRegistryCredentials } from './containers';

// Copies one platform of a public image into the account's managed registry over the OCI distribution API, so the
// instance never needs docker. Blobs stream from the source registry (or its CDN) straight into the upload.

export type ImageCopyResult = { reference: string; digest: string };

export class RegistryError extends Error {
  constructor(
    // HTTP status of the failed registry call; 0 when the failure is not an HTTP one (bad manifest, wrong platform…)
    readonly status: number,
    // OCI error codes from the response body (BLOB_UNKNOWN, DENIED, UNAUTHORIZED…)
    readonly codes: string[],
    message: string,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

type Platform = { os: string; architecture: string };
type Descriptor = { mediaType?: string; digest: string; size: number; platform?: Partial<Platform> };
type ManifestJson = { mediaType?: string; manifests?: unknown[]; config?: unknown; layers?: unknown[] };
type Manifest = { bytes: Uint8Array; mediaType: string; json: ManifestJson };
type StreamingInit = RequestInit & { duplex?: 'half' };

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const DOCKER_LIST = 'application/vnd.docker.distribution.manifest.list.v2+json';
const DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
const MANIFEST_TYPES = [OCI_INDEX, OCI_MANIFEST, DOCKER_LIST, DOCKER_MANIFEST];

// OCI distribution spec grammar for repository names, tags and digests
const REPOSITORY = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^[a-z0-9]+(?:[+._-][a-z0-9]+)*:[a-zA-Z0-9=_-]+$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type ImageReference = { host: string; repository: string; reference: string };

// "docker.io/bohrio/agent:0.1.0" → registry-1.docker.io, bohrio/agent, 0.1.0; "node" → library/node:latest
export function parseImageReference(source: string): ImageReference {
  let name = source.trim();
  let reference: string | undefined;
  const at = name.indexOf('@');
  if (at !== -1) {
    reference = name.slice(at + 1);
    name = name.slice(0, at);
  }
  const colon = name.lastIndexOf(':');
  if (colon > name.lastIndexOf('/')) {
    reference ??= name.slice(colon + 1);
    name = name.slice(0, colon);
  }
  const slash = name.indexOf('/');
  const first = slash === -1 ? '' : name.slice(0, slash);
  let host = 'docker.io';
  if (first.includes('.') || first.includes(':') || first === 'localhost') {
    host = first;
    name = name.slice(slash + 1);
  }
  if (host === 'docker.io' || host === 'index.docker.io' || host === 'registry-1.docker.io') {
    host = 'registry-1.docker.io';
    if (!name.includes('/')) name = `library/${name}`;
  }
  if (!REPOSITORY.test(name)) throw new RegistryError(0, ['NAME_INVALID'], `Invalid image name in "${source}"`);
  reference ??= 'latest';
  if (!TAG.test(reference) && !DIGEST.test(reference)) {
    throw new RegistryError(0, ['TAG_INVALID'], `Invalid tag or digest in "${source}"`);
  }
  return { host, repository: name, reference };
}

// A streamed request body with a known length. Workers only send Content-Length for a FixedLengthStream body (a
// plain stream goes out chunked); Node's fetch takes the stream with duplex: 'half' and an explicit Content-Length.
export function fixedLengthBody(
  stream: ReadableStream,
  length: number,
): { body: ReadableStream; headers: Record<string, string>; duplex?: 'half' } {
  const FixedLength = (globalThis as { FixedLengthStream?: typeof FixedLengthStream }).FixedLengthStream;
  if (FixedLength !== undefined) {
    const fixed = new FixedLength(length);
    // A source failure errors the fixed stream, which fails the upload request that reads it
    stream.pipeTo(fixed.writable).catch(() => undefined);
    return { body: fixed.readable, headers: {} };
  }
  return { body: stream, headers: { 'Content-Length': String(length) }, duplex: 'half' };
}

async function discard(response: Response) {
  if (response.body !== null && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
}

async function registryError(response: Response, url: string, action: string): Promise<RegistryError> {
  const text = await response.text().catch(() => '');
  let errors: { code?: unknown; message?: unknown }[] = [];
  try {
    const parsed = JSON.parse(text) as { errors?: unknown } | null;
    if (Array.isArray(parsed?.errors)) errors = parsed.errors;
  } catch {
    errors = [];
  }
  const codes = errors.flatMap((error) => (typeof error.code === 'string' ? [error.code] : []));
  const details = errors.length
    ? errors.map((error) => [error.code, error.message].filter((part) => typeof part === 'string').join(' ')).join('; ')
    : text.slice(0, 200);
  return new RegistryError(
    response.status,
    codes,
    `Registry ${response.status} ${action} (${url})${details ? `: ${details}` : ''}`,
    url,
  );
}

async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function parseChallenge(header: string | null) {
  const match = header === null ? null : /^\s*(\w+)\s+(.*)$/.exec(header);
  if (!match?.[1] || match[2] === undefined) return undefined;
  const params: Record<string, string> = {};
  for (const param of match[2].matchAll(/([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/g)) {
    if (param[1]) params[param[1].toLowerCase()] = param[2]?.replace(/\\(.)/g, '$1') ?? param[3] ?? '';
  }
  return { scheme: match[1].toLowerCase(), params };
}

// GET/HEAD with redirects followed by hand: blob downloads redirect to presigned storage URLs on another host, which
// must not receive the registry credentials
async function followRedirects(fetchImpl: typeof fetch, url: string, init: RequestInit & { headers: Headers }) {
  let current = new URL(url);
  let headers = init.headers;
  for (let hops = 0; hops <= 5; hops++) {
    const response = await fetchImpl(current.toString(), { ...init, headers, redirect: 'manual' });
    const location = response.headers.get('Location');
    if (!REDIRECTS.has(response.status) || location === null) return response;
    await discard(response);
    const next = new URL(location, current);
    if (next.origin !== current.origin) {
      headers = new Headers(headers);
      headers.delete('Authorization');
    }
    current = next;
  }
  throw new RegistryError(0, [], `Too many redirects for ${url}`, url);
}

class Registry {
  private authorization: string | undefined;

  constructor(
    private readonly fetchImpl: typeof fetch,
    readonly host: string,
    readonly repository: string,
    private readonly actions: string,
    private readonly basic?: string,
  ) {
    this.authorization = basic === undefined ? undefined : `Basic ${basic}`;
  }

  url(path: string) {
    return `https://${this.host}/v2/${this.repository}/${path}`;
  }

  // Sends with the current credentials. A Bearer challenge is answered with a token exchange and one retry, unless
  // the body is a stream that can't be replayed (uploads follow a POST that already settled the auth).
  async send(url: string, init: StreamingInit = {}): Promise<Response> {
    const response = await this.attempt(url, init);
    if (response.status !== 401 || init.body instanceof ReadableStream) return response;
    const challenge = parseChallenge(response.headers.get('WWW-Authenticate'));
    const realm = challenge?.params.realm;
    if (challenge?.scheme !== 'bearer' || realm === undefined) return response;
    await discard(response);
    this.authorization = `Bearer ${await this.exchangeToken(realm, challenge.params)}`;
    return this.attempt(url, init);
  }

  private attempt(url: string, init: StreamingInit) {
    const headers = new Headers(init.headers);
    if (this.authorization !== undefined && new URL(url).host === this.host) {
      headers.set('Authorization', this.authorization);
    }
    const method = init.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') return followRedirects(this.fetchImpl, url, { ...init, headers });
    return this.fetchImpl(url, { ...init, headers, redirect: 'manual' });
  }

  // Token endpoint of the Bearer flow (Docker Hub, GHCR…): anonymous for public sources, basic auth otherwise
  private async exchangeToken(realm: string, params: Record<string, string>): Promise<string> {
    const url = new URL(realm);
    if (params.service) url.searchParams.set('service', params.service);
    const scopes = new Set([params.scope, `repository:${this.repository}:${this.actions}`]);
    for (const scope of scopes) if (scope) url.searchParams.append('scope', scope);
    const headers = new Headers({ Accept: 'application/json' });
    if (this.basic !== undefined) headers.set('Authorization', `Basic ${this.basic}`);
    const response = await this.fetchImpl(url.toString(), { headers });
    if (!response.ok) throw await registryError(response, url.toString(), 'requesting a registry token');
    const body = (await response.json().catch(() => ({}))) as { token?: string; access_token?: string };
    const token = body.token || body.access_token;
    if (!token) throw new RegistryError(response.status, [], `No token from ${url.origin}`, url.toString());
    return token;
  }
}

function isDescriptor(value: unknown): value is Descriptor {
  const descriptor = value as Descriptor | null;
  return (
    typeof descriptor === 'object' &&
    descriptor !== null &&
    typeof descriptor.digest === 'string' &&
    DIGEST.test(descriptor.digest) &&
    typeof descriptor.size === 'number'
  );
}

async function getManifest(registry: Registry, reference: string): Promise<Manifest> {
  const url = registry.url(`manifests/${reference}`);
  const response = await registry.send(url, { headers: { Accept: MANIFEST_TYPES.join(', ') } });
  if (!response.ok) throw await registryError(response, url, `fetching manifest ${reference}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let json: ManifestJson | null;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as ManifestJson | null;
  } catch {
    json = null;
  }
  if (typeof json !== 'object' || json === null) {
    throw new RegistryError(0, ['MANIFEST_INVALID'], `Manifest ${reference} is not JSON`, url);
  }
  if (reference.startsWith('sha256:') && (await sha256Digest(bytes)) !== reference) {
    throw new RegistryError(0, ['DIGEST_INVALID'], `Manifest ${reference} does not match its digest`, url);
  }
  const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '';
  const mediaType = MANIFEST_TYPES.includes(contentType)
    ? contentType
    : (json.mediaType ?? (Array.isArray(json.manifests) ? OCI_INDEX : OCI_MANIFEST));
  return { bytes, mediaType, json };
}

const isIndex = (manifest: Manifest) => manifest.mediaType === OCI_INDEX || manifest.mediaType === DOCKER_LIST;

function pickPlatform(index: Manifest, platform: Platform, source: string): Descriptor {
  const entries = (index.json.manifests ?? []).filter(isDescriptor);
  const match = entries.find(
    (entry) => entry.platform?.os === platform.os && entry.platform?.architecture === platform.architecture,
  );
  if (match === undefined) {
    const available = entries.map((entry) => `${entry.platform?.os}/${entry.platform?.architecture}`).join(', ');
    throw new RegistryError(
      0,
      ['MANIFEST_UNKNOWN'],
      `${source} has no ${platform.os}/${platform.architecture} image (found: ${available || 'none'})`,
    );
  }
  return match;
}

async function blobExists(registry: Registry, digest: string): Promise<boolean> {
  const url = registry.url(`blobs/${digest}`);
  const response = await registry.send(url, { method: 'HEAD' });
  if (response.ok || response.status === 404) {
    await discard(response);
    return response.ok;
  }
  throw await registryError(response, url, `checking blob ${digest}`);
}

async function startUpload(registry: Registry): Promise<string> {
  const url = registry.url('blobs/uploads/');
  const response = await registry.send(url, { method: 'POST' });
  const location = response.headers.get('Location');
  if (!response.ok || location === null) throw await registryError(response, url, 'starting a blob upload');
  await discard(response);
  return new URL(location, url).toString();
}

// Monolithic upload: one PUT to the session's Location with the digest appended to its query
async function finishUpload(
  registry: Registry,
  location: string,
  digest: string,
  upload: { body: BodyInit; headers?: Record<string, string>; duplex?: 'half' },
) {
  const url = `${location}${location.includes('?') ? '&' : '?'}digest=${encodeURIComponent(digest)}`;
  const init: StreamingInit = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...upload.headers },
    body: upload.body,
  };
  if (upload.duplex !== undefined) init.duplex = upload.duplex;
  const response = await registry.send(url, init);
  if (!response.ok) throw await registryError(response, url, `uploading blob ${digest}`);
  await discard(response);
}

// The config is small JSON: read it whole and check the platform it declares before uploading it
async function copyConfig(source: Registry, destination: Registry, config: Descriptor, platform: Platform) {
  if (await blobExists(destination, config.digest)) return;
  const url = source.url(`blobs/${config.digest}`);
  const response = await source.send(url);
  if (!response.ok) throw await registryError(response, url, `fetching config ${config.digest}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let declared: Partial<Platform> = {};
  try {
    declared = (JSON.parse(new TextDecoder().decode(bytes)) as Partial<Platform> | null) ?? {};
  } catch {
    declared = {};
  }
  if (
    (declared.os !== undefined && declared.os !== platform.os) ||
    (declared.architecture !== undefined && declared.architecture !== platform.architecture)
  ) {
    const expected = `${platform.os}/${platform.architecture}`;
    throw new RegistryError(0, [], `Image is ${declared.os}/${declared.architecture}, expected ${expected}`, url);
  }
  const location = await startUpload(destination);
  await finishUpload(destination, location, config.digest, { body: bytes });
}

async function copyLayer(source: Registry, destination: Registry, layer: Descriptor) {
  if (await blobExists(destination, layer.digest)) return;
  const location = await startUpload(destination);
  const url = source.url(`blobs/${layer.digest}`);
  const response = await source.send(url);
  if (!response.ok || response.body === null) {
    throw await registryError(response, url, `fetching layer ${layer.digest}`);
  }
  const length = response.headers.get('Content-Length');
  if (length !== null && Number(length) !== layer.size) {
    await discard(response);
    throw new RegistryError(0, ['SIZE_INVALID'], `Layer is ${length} bytes, expected ${layer.size}`, url);
  }
  await finishUpload(destination, location, layer.digest, fixedLengthBody(response.body, layer.size));
}

async function putManifest(registry: Registry, tag: string, manifest: Manifest): Promise<string> {
  const url = registry.url(`manifests/${tag}`);
  const response = await registry.send(url, {
    method: 'PUT',
    headers: { 'Content-Type': manifest.mediaType },
    body: manifest.bytes,
  });
  if (!response.ok) throw await registryError(response, url, `pushing manifest ${tag}`);
  const digest = await sha256Digest(manifest.bytes);
  const stored = response.headers.get('Docker-Content-Digest');
  await discard(response);
  if (stored !== null && stored !== digest) {
    throw new RegistryError(0, ['DIGEST_INVALID'], `Registry stored manifest ${stored}, expected ${digest}`, url);
  }
  return digest;
}

export async function copyImageToAccount(options: {
  cf: CloudflareClient;
  accountId: string;
  source: string;
  repository: string;
  tag: string;
  platform?: { os: string; architecture: string };
  fetch?: typeof fetch;
}): Promise<ImageCopyResult> {
  const baseFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  // Registry calls carry the same User-Agent as the account's API calls
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('User-Agent')) headers.set('User-Agent', options.cf.userAgent);
    return baseFetch(input, { ...init, headers });
  };
  const platform = options.platform ?? { os: 'linux', architecture: 'amd64' };
  if (!REPOSITORY.test(options.repository)) {
    throw new RegistryError(0, ['NAME_INVALID'], `Invalid repository name "${options.repository}"`);
  }
  if (!TAG.test(options.tag)) throw new RegistryError(0, ['TAG_INVALID'], `Invalid tag "${options.tag}"`);

  const image = parseImageReference(options.source);
  const source = new Registry(fetchImpl, image.host, image.repository, 'pull');
  let manifest = await getManifest(source, image.reference);
  if (isIndex(manifest)) {
    manifest = await getManifest(source, pickPlatform(manifest, platform, options.source).digest);
    if (isIndex(manifest)) throw new RegistryError(0, ['MANIFEST_INVALID'], `Nested image index in ${options.source}`);
  }
  const { config, layers } = manifest.json;
  if (!isDescriptor(config) || !Array.isArray(layers) || !layers.every(isDescriptor)) {
    throw new RegistryError(0, ['MANIFEST_INVALID'], `${options.source} has no image config or layers`);
  }

  const credentials = await createRegistryCredentials(options.cf, options.accountId, { permissions: ['push', 'pull'] });
  const repository = `${options.accountId}/${options.repository}`;
  // wrangler's own HTTP calls to the managed registry authenticate as Basic "v1:<password>"
  const destination = new Registry(
    fetchImpl,
    credentials.registry,
    repository,
    'pull,push',
    btoa(`v1:${credentials.password}`),
  );

  await copyConfig(source, destination, config, platform);
  for (const layer of layers) await copyLayer(source, destination, layer);
  const digest = await putManifest(destination, options.tag, manifest);
  return { reference: `${credentials.registry}/${repository}@${digest}`, digest };
}
