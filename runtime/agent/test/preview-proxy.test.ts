import http from 'node:http';
import type net from 'node:net';
import type { AddressInfo } from 'node:net';
import { AGENT_PORT } from '@bohr/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { connectLoopback, createPreviewProxy } from '../src/preview-proxy';

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A dev server that, like wrangler dev or Vite, only listens on one loopback address. */
async function devServer(host: string): Promise<number> {
  const server = http.createServer((request, response) => response.end(`dev ${request.url}`));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return (server.address() as AddressInfo).port;
}

async function proxy(target: () => number | undefined): Promise<number> {
  const server = createPreviewProxy({ port: 0, host: '127.0.0.1', target });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return (server.address() as AddressInfo).port;
}

const get = (port: number, path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`).then(
    async (response) => `${response.status} ${await response.text()}`,
    () => 'refused',
  );

describe('preview proxy', () => {
  it('relays to a dev server that only listens on localhost', async () => {
    const dev = await devServer('127.0.0.1');
    const port = await proxy(() => dev);
    expect(await get(port, '/produtos?x=1')).toBe('200 dev /produtos?x=1');
  });

  it('reaches dev servers on the IPv6 loopback too', async (context) => {
    let dev: number;
    try {
      dev = await devServer('::1');
    } catch {
      context.skip();
      return;
    }
    const socket = await connectLoopback(dev);
    expect(socket).not.toBeNull();
    socket?.destroy();
    const port = await proxy(() => dev);
    expect(await get(port, '/')).toBe('200 dev /');
  });

  it('closes connections while no preview runs, and never reaches the runner control port', async () => {
    const dev = await devServer('127.0.0.1');
    let target: number | undefined;
    const port = await proxy(() => target);
    expect(await get(port, '/')).toBe('refused');
    target = AGENT_PORT;
    expect(await get(port, '/jobs')).toBe('refused');
    target = dev;
    expect(await get(port, '/')).toBe('200 dev /');
  });
});
