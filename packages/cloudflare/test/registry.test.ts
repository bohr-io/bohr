import { afterEach, describe, expect, it } from 'vitest';
import { copyImageToAccount, fixedLengthBody, parseImageReference, RegistryError } from '../src';
import { bodyBytes, cloudflare, fakeFetch, notRouted, ok, type RecordedRequest } from './fake-fetch';

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function imageFixture(options: { manifestType?: string; platforms?: string[] } = {}) {
  const config = encoder.encode(JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers' } }));
  const layers = [Uint8Array.from({ length: 3000 }, (_, i) => i % 251), encoder.encode('second layer')];
  const configDigest = await sha256(config);
  const layerDigests = await Promise.all(layers.map(sha256));
  const manifestType = options.manifestType ?? OCI_MANIFEST;
  // Indented on purpose: the copy must push these exact bytes, not a re-serialization
  const manifest = encoder.encode(
    JSON.stringify(
      {
        schemaVersion: 2,
        mediaType: manifestType,
        config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: configDigest, size: config.length },
        layers: layers.map((layer, i) => ({
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: layerDigests[i],
          size: layer.length,
        })),
      },
      null,
      3,
    ),
  );
  const manifestDigest = await sha256(manifest);
  const platforms = options.platforms ?? ['linux/arm64', 'linux/amd64', 'unknown/unknown'];
  const index = encoder.encode(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_INDEX,
      manifests: platforms.map((platform, i) => {
        const [os, architecture] = platform.split('/');
        return {
          mediaType: OCI_MANIFEST,
          digest: platform === 'linux/amd64' ? manifestDigest : `sha256:${String(i).repeat(64)}`,
          size: platform === 'linux/amd64' ? manifest.length : 500,
          platform: { os, architecture },
        };
      }),
    }),
  );
  return { config, configDigest, layers, layerDigests, manifest, manifestDigest, manifestType, index };
}

// Source chunks are produced only when read, so a buffered copy would show up as pulls before the upload
function lazyStream(bytes: Uint8Array, chunkSize: number) {
  const state = { pulls: 0 };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++;
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

const unauthorized = (challenge: string) =>
  Response.json(
    { errors: [{ code: 'UNAUTHORIZED', message: 'authentication required' }] },
    { status: 401, headers: { 'WWW-Authenticate': challenge } },
  );

const DEST_BASIC = `Basic ${btoa('v1:registry-jwt')}`;

// The managed registry: bearer flow (answers basic auth with a token challenge) or plain basic auth
function destination(options: { auth: 'bearer' | 'basic'; existing: string[] }) {
  const blobs = new Map<string, Uint8Array>(options.existing.map((digest) => [digest, new Uint8Array()]));
  const manifests = new Map<string, { contentType: string | null; bytes: Uint8Array }>();
  const putsSeen: { request: RecordedRequest; pullsBefore?: number }[] = [];
  let sessions = 0;
  let layerPulls: { pulls: number } | undefined;
  const expected = options.auth === 'bearer' ? 'Bearer dest-token' : DEST_BASIC;

  async function handle(request: RecordedRequest): Promise<Response> {
    const { url, method, headers } = request;
    if (url.pathname === '/token') {
      return headers.get('authorization') === DEST_BASIC
        ? Response.json({ token: 'dest-token', expires_in: 300 })
        : new Response(null, { status: 401 });
    }
    if (headers.get('authorization') !== expected) {
      return unauthorized(
        'Bearer realm="https://registry.cloudflare.com/token",service="registry.cloudflare.com",' +
          'scope="repository:acc/bohr-agent:pull"',
      );
    }
    const blob = /^\/v2\/acc\/bohr-agent\/blobs\/(sha256:[a-f0-9]{64})$/.exec(url.pathname);
    if (blob?.[1] && method === 'HEAD') return new Response(null, { status: blobs.has(blob[1]) ? 200 : 404 });
    if (url.pathname === '/v2/acc/bohr-agent/blobs/uploads/' && method === 'POST') {
      sessions++;
      // A relative Location with a query first, then an absolute one without
      const location =
        sessions === 1
          ? '/v2/acc/bohr-agent/blobs/uploads/u1?_state=s1'
          : `https://registry.cloudflare.com/v2/acc/bohr-agent/blobs/uploads/u${sessions}`;
      return new Response(null, { status: 202, headers: { Location: location } });
    }
    if (/^\/v2\/acc\/bohr-agent\/blobs\/uploads\/u\d+$/.test(url.pathname) && method === 'PUT') {
      putsSeen.push({ request, pullsBefore: layerPulls?.pulls });
      const digest = url.searchParams.get('digest') ?? '';
      const bytes = await bodyBytes(request.body);
      if (digest !== (await sha256(bytes))) {
        return Response.json({ errors: [{ code: 'DIGEST_INVALID', message: 'digest mismatch' }] }, { status: 400 });
      }
      blobs.set(digest, bytes);
      return new Response(null, { status: 201, headers: { 'Docker-Content-Digest': digest } });
    }
    const manifest = /^\/v2\/acc\/bohr-agent\/manifests\/([\w.-]+)$/.exec(url.pathname);
    if (manifest?.[1] && method === 'PUT') {
      const bytes = await bodyBytes(request.body);
      manifests.set(manifest[1], { contentType: headers.get('content-type'), bytes });
      return new Response(null, { status: 201, headers: { 'Docker-Content-Digest': await sha256(bytes) } });
    }
    return notRouted(request);
  }

  // The source stream whose read progress each upload records
  const watch = (state: { pulls: number }) => {
    layerPulls = state;
  };
  return { handle, blobs, manifests, putsSeen, watch };
}

const credentialsApi = (request: RecordedRequest) =>
  request.method === 'POST' &&
  request.url.pathname === '/client/v4/accounts/acc/containers/registries/registry.cloudflare.com/credentials'
    ? ok({ account_id: 'acc', registry_host: 'registry.cloudflare.com', username: 'v1', password: 'registry-jwt' })
    : notRouted(request);

describe('copyImageToAccount', () => {
  it('copies the amd64 image of a GHCR index into the managed registry, streaming layers', async () => {
    const image = await imageFixture();
    const dest = destination({ auth: 'bearer', existing: [image.layerDigests[1] ?? ''] });
    const cdnLayer = lazyStream(image.layers[0] ?? new Uint8Array(), 512);
    dest.watch(cdnLayer.state);
    const ghcr = 'repository:bohr-io/agent:pull';
    const { requests, fetchImpl } = fakeFetch(async (request) => {
      const { url, headers } = request;
      if (url.host === 'api.cloudflare.com') return credentialsApi(request);
      if (url.host === 'registry.cloudflare.com') return dest.handle(request);
      if (url.host === 'pkg-containers.githubusercontent.com') {
        if (headers.has('authorization')) return new Response('signed URLs take no Authorization', { status: 400 });
        return new Response(cdnLayer.stream, { headers: { 'Content-Length': String(image.layers[0]?.length) } });
      }
      if (url.host !== 'ghcr.io') return notRouted(request);
      if (url.pathname === '/token') return Response.json({ token: 'source-token' });
      if (headers.get('authorization') !== 'Bearer source-token') {
        return unauthorized(`Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="${ghcr}"`);
      }
      const path = url.pathname.replace('/v2/bohr-io/agent/', '');
      if (path === 'manifests/0.1.0') return new Response(image.index, { headers: { 'Content-Type': OCI_INDEX } });
      if (path === `manifests/${image.manifestDigest}`) {
        return new Response(image.manifest, { headers: { 'Content-Type': `${OCI_MANIFEST}; charset=utf-8` } });
      }
      if (path === `blobs/${image.configDigest}`) return new Response(image.config);
      if (path === `blobs/${image.layerDigests[0]}`) {
        const location = `https://pkg-containers.githubusercontent.com/ghcr1/blobs/${image.layerDigests[0]}?sig=x`;
        return new Response(null, { status: 307, headers: { Location: location } });
      }
      return notRouted(request);
    });

    const result = await copyImageToAccount({
      cf: cloudflare(fetchImpl),
      accountId: 'acc',
      source: 'ghcr.io/bohr-io/agent:0.1.0',
      repository: 'bohr-agent',
      tag: '0.1.0',
      fetch: fetchImpl,
    });

    expect(result).toEqual({
      reference: `registry.cloudflare.com/acc/bohr-agent@${image.manifestDigest}`,
      digest: image.manifestDigest,
    });
    const config = image.configDigest;
    const [layer1 = '', layer2 = ''] = image.layerDigests;
    const registry = 'https://registry.cloudflare.com/v2/acc/bohr-agent';
    expect(requests.map((request) => `${request.method} ${request.url.origin}${request.url.pathname}`)).toEqual([
      'GET https://ghcr.io/v2/bohr-io/agent/manifests/0.1.0',
      'GET https://ghcr.io/token',
      'GET https://ghcr.io/v2/bohr-io/agent/manifests/0.1.0',
      `GET https://ghcr.io/v2/bohr-io/agent/manifests/${image.manifestDigest}`,
      'POST https://api.cloudflare.com/client/v4/accounts/acc/containers/registries/registry.cloudflare.com/credentials',
      `HEAD ${registry}/blobs/${config}`,
      'GET https://registry.cloudflare.com/token',
      `HEAD ${registry}/blobs/${config}`,
      `GET https://ghcr.io/v2/bohr-io/agent/blobs/${config}`,
      `POST ${registry}/blobs/uploads/`,
      `PUT ${registry}/blobs/uploads/u1`,
      `HEAD ${registry}/blobs/${layer1}`,
      `POST ${registry}/blobs/uploads/`,
      `GET https://ghcr.io/v2/bohr-io/agent/blobs/${layer1}`,
      `GET https://pkg-containers.githubusercontent.com/ghcr1/blobs/${layer1}`,
      `PUT ${registry}/blobs/uploads/u2`,
      `HEAD ${registry}/blobs/${layer2}`,
      `PUT ${registry}/manifests/0.1.0`,
    ]);

    // Source: anonymous token for the challenge's scope, then bearer
    const accept = requests[0]?.headers.get('accept') ?? '';
    for (const type of [OCI_INDEX, OCI_MANIFEST, DOCKER_MANIFEST, 'manifest.list.v2+json']) {
      expect(accept).toContain(type);
    }
    expect(requests[0]?.headers.has('authorization')).toBe(false);
    expect(requests[1]?.headers.has('authorization')).toBe(false);
    expect(requests[1]?.url.searchParams.get('service')).toBe('ghcr.io');
    expect(requests[1]?.url.searchParams.getAll('scope')).toEqual([ghcr]);
    expect(requests[2]?.headers.get('authorization')).toBe('Bearer source-token');
    expect(requests[14]?.headers.has('authorization')).toBe(false);

    // Destination: push + pull credentials, basic auth exchanged for a token
    expect(JSON.parse(String(requests[4]?.body))).toEqual({ expiration_minutes: 15, permissions: ['push', 'pull'] });
    expect(requests[5]?.headers.get('authorization')).toBe(DEST_BASIC);
    expect(requests[6]?.headers.get('authorization')).toBe(DEST_BASIC);
    expect(requests[6]?.url.searchParams.getAll('scope')).toEqual([
      'repository:acc/bohr-agent:pull',
      'repository:acc/bohr-agent:pull,push',
    ]);
    expect(requests.slice(7).filter((request) => request.url.host === 'registry.cloudflare.com')).toHaveLength(8);
    for (const request of requests.slice(7)) {
      if (request.url.host === 'registry.cloudflare.com') {
        expect(request.headers.get('authorization')).toBe('Bearer dest-token');
      }
    }

    // Config: buffered (small), uploaded to the relative Location with the digest appended to its query
    const configPut = requests[10];
    expect(configPut?.url.search).toBe(`?_state=s1&digest=${encodeURIComponent(config)}`);
    expect(configPut?.headers.get('content-type')).toBe('application/octet-stream');
    expect(dest.blobs.get(config)).toEqual(image.config);

    // Layer: the source stream goes straight into the PUT with its length, unread until the upload reads it
    const layerPut = requests[15];
    expect(layerPut?.url.search).toBe(`?digest=${encodeURIComponent(layer1)}`);
    expect(layerPut?.body).toBeInstanceOf(ReadableStream);
    expect(layerPut?.duplex).toBe('half');
    expect(layerPut?.headers.get('content-length')).toBe(String(image.layers[0]?.length));
    expect(layerPut?.headers.get('content-type')).toBe('application/octet-stream');
    expect(dest.putsSeen[1]?.pullsBefore).toBe(0);
    expect(dest.blobs.get(layer1)).toEqual(image.layers[0]);
    expect(cdnLayer.state.pulls).toBeGreaterThan(5);

    // Manifest: the exact source bytes, tagged, with the media type stripped of parameters
    expect(dest.manifests.get('0.1.0')).toEqual({ contentType: OCI_MANIFEST, bytes: image.manifest });
  });

  it('copies a single-platform Docker Hub image with plain basic auth, skipping existing blobs', async () => {
    const image = await imageFixture({ manifestType: DOCKER_MANIFEST });
    const dest = destination({ auth: 'basic', existing: [image.configDigest, ...image.layerDigests] });
    const { requests, fetchImpl } = fakeFetch(async (request) => {
      const { url, headers } = request;
      if (url.host === 'api.cloudflare.com') return credentialsApi(request);
      if (url.host === 'registry.cloudflare.com') return dest.handle(request);
      if (url.host === 'auth.docker.io') return Response.json({ token: 'hub-token', access_token: 'hub-token' });
      if (url.host !== 'registry-1.docker.io') return notRouted(request);
      if (headers.get('authorization') !== 'Bearer hub-token') {
        return unauthorized(
          'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/node:pull"',
        );
      }
      if (url.pathname === '/v2/library/node/manifests/22') {
        return new Response(image.manifest, { headers: { 'Content-Type': DOCKER_MANIFEST } });
      }
      return notRouted(request);
    });

    const result = await copyImageToAccount({
      cf: cloudflare(fetchImpl),
      accountId: 'acc',
      source: 'docker.io/node:22',
      repository: 'bohr-agent',
      tag: '22',
      fetch: fetchImpl,
    });

    expect(result.digest).toBe(image.manifestDigest);
    expect(requests.map((request) => `${request.method} ${request.url.host}`)).toEqual([
      'GET registry-1.docker.io',
      'GET auth.docker.io',
      'GET registry-1.docker.io',
      'POST api.cloudflare.com',
      'HEAD registry.cloudflare.com',
      'HEAD registry.cloudflare.com',
      'HEAD registry.cloudflare.com',
      'PUT registry.cloudflare.com',
    ]);
    expect(requests[1]?.url.searchParams.get('service')).toBe('registry.docker.io');
    expect(requests.slice(4).every((request) => request.headers.get('authorization') === DEST_BASIC)).toBe(true);
    expect(dest.manifests.get('22')).toEqual({ contentType: DOCKER_MANIFEST, bytes: image.manifest });
  });

  it('fails when the source has no image for the platform', async () => {
    const image = await imageFixture({ platforms: ['linux/arm64', 'linux/arm/v7'] });
    const { requests, fetchImpl } = fakeFetch(
      () => new Response(image.index, { headers: { 'Content-Type': OCI_INDEX } }),
    );

    const error = await copyImageToAccount({
      cf: cloudflare(fetchImpl),
      accountId: 'acc',
      source: 'ghcr.io/bohr-io/agent:0.1.0',
      repository: 'bohr-agent',
      tag: '0.1.0',
      fetch: fetchImpl,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).message).toContain('has no linux/amd64 image (found: linux/arm64, linux/arm)');
    expect(requests).toHaveLength(1);
  });

  it('throws RegistryError with the registry error codes', async () => {
    const image = await imageFixture();
    const { fetchImpl } = fakeFetch(async (request) => {
      const { url } = request;
      if (url.host === 'api.cloudflare.com') return credentialsApi(request);
      if (url.host === 'ghcr.io') return new Response(image.manifest, { headers: { 'Content-Type': OCI_MANIFEST } });
      if (request.method === 'HEAD') return new Response(null, { status: 200 });
      return Response.json(
        { errors: [{ code: 'MANIFEST_BLOB_UNKNOWN', message: 'blob unknown to registry', detail: {} }] },
        { status: 400 },
      );
    });

    const error = await copyImageToAccount({
      cf: cloudflare(fetchImpl),
      accountId: 'acc',
      source: `ghcr.io/bohr-io/agent@${image.manifestDigest}`,
      repository: 'bohr-agent',
      tag: '0.1.0',
      fetch: fetchImpl,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).status).toBe(400);
    expect((error as RegistryError).codes).toEqual(['MANIFEST_BLOB_UNKNOWN']);
    expect((error as RegistryError).message).toContain('MANIFEST_BLOB_UNKNOWN blob unknown to registry');
  });

  it('rejects a manifest whose bytes do not match the requested digest', async () => {
    const image = await imageFixture();
    const { fetchImpl } = fakeFetch(() => new Response(image.manifest, { headers: { 'Content-Type': OCI_MANIFEST } }));

    const error = await copyImageToAccount({
      cf: cloudflare(fetchImpl),
      accountId: 'acc',
      source: `ghcr.io/bohr-io/agent@sha256:${'0'.repeat(64)}`,
      repository: 'bohr-agent',
      tag: '0.1.0',
      fetch: fetchImpl,
    }).catch((e: unknown) => e);

    expect((error as RegistryError).codes).toEqual(['DIGEST_INVALID']);
  });

  it('validates the destination repository and tag before any request', async () => {
    const { requests, fetchImpl } = fakeFetch(notRouted);
    const copy = (repository: string, tag: string) =>
      copyImageToAccount({
        cf: cloudflare(fetchImpl),
        accountId: 'acc',
        source: 'x/y:1',
        repository,
        tag,
        fetch: fetchImpl,
      });

    await expect(copy('Bohr Agent', '1')).rejects.toMatchObject({ codes: ['NAME_INVALID'] });
    await expect(copy('bohr-agent', 'bad/tag')).rejects.toMatchObject({ codes: ['TAG_INVALID'] });
    expect(requests).toHaveLength(0);
  });
});

describe('parseImageReference', () => {
  it('maps Docker Hub names and keeps other registries as they are', () => {
    expect(parseImageReference('docker.io/bohrio/agent:0.1.0')).toEqual({
      host: 'registry-1.docker.io',
      repository: 'bohrio/agent',
      reference: '0.1.0',
    });
    expect(parseImageReference('node')).toEqual({
      host: 'registry-1.docker.io',
      repository: 'library/node',
      reference: 'latest',
    });
    expect(parseImageReference('ghcr.io/bohr-io/agent:0.1.0')).toEqual({
      host: 'ghcr.io',
      repository: 'bohr-io/agent',
      reference: '0.1.0',
    });
    const digest = `sha256:${'c'.repeat(64)}`;
    expect(parseImageReference(`localhost:5000/team/agent:1@${digest}`)).toEqual({
      host: 'localhost:5000',
      repository: 'team/agent',
      reference: digest,
    });
    expect(() => parseImageReference('ghcr.io/Bohr/Agent:1')).toThrow(RegistryError);
  });
});

describe('fixedLengthBody', () => {
  const globals = globalThis as { FixedLengthStream?: unknown };
  afterEach(() => {
    delete globals.FixedLengthStream;
  });

  it('passes the stream with an explicit length in Node', () => {
    const stream = new ReadableStream();

    expect(fixedLengthBody(stream, 42)).toEqual({ body: stream, headers: { 'Content-Length': '42' }, duplex: 'half' });
  });

  it('pipes through a FixedLengthStream on Workers', async () => {
    const lengths: number[] = [];
    globals.FixedLengthStream = class extends TransformStream {
      constructor(length: number) {
        super();
        lengths.push(length);
      }
    };
    const { stream } = lazyStream(encoder.encode('hello world'), 4);

    const upload = fixedLengthBody(stream, 11);

    expect(lengths).toEqual([11]);
    expect(upload.headers).toEqual({});
    expect(upload.duplex).toBeUndefined();
    expect(upload.body).not.toBe(stream);
    expect(new TextDecoder().decode(await bodyBytes(upload.body))).toBe('hello world');
  });
});
