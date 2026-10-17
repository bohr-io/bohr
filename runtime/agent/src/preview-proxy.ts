import net from 'node:net';
import { AGENT_PORT } from '@bohr/shared';
import { type Logger, silentLogger } from './log';

// The project Worker reaches the preview through the container's network interface, but dev servers usually
// listen on localhost only (wrangler dev, Vite, Next): this proxy listens on every interface at a fixed port
// and relays each connection to the dev server on the loopback, IPv4 or IPv6, whichever it listens on.

const LOOPBACK = ['127.0.0.1', '::1'] as const;

/** Connects to the first loopback address that accepts `port`, or null. */
export function connectLoopback(port: number, timeoutMs = 2000): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    let index = 0;
    const attempt = () => {
      const host = LOOPBACK[index];
      if (host === undefined) {
        resolve(null);
        return;
      }
      const socket = net.connect({ port, host });
      const fail = () => {
        socket.destroy();
        index++;
        attempt();
      };
      socket.setTimeout(timeoutMs, fail);
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.removeListener('error', fail);
        resolve(socket);
      });
    };
    attempt();
  });
}

export interface PreviewProxyOptions {
  /** The fixed port the project Worker connects to. */
  port: number;
  /** The dev server's port while the preview runs; undefined closes incoming connections. */
  target: () => number | undefined;
  host?: string;
  log?: Logger;
}

export function createPreviewProxy(options: PreviewProxyOptions): net.Server {
  const log = options.log ?? silentLogger;
  const server = net.createServer((client) => {
    client.on('error', () => client.destroy());
    const port = options.target();
    // The runner's control port is never reachable from the public preview
    if (port === undefined || port === AGENT_PORT || port === options.port) {
      client.destroy();
      return;
    }
    client.pause();
    void connectLoopback(port).then((upstream) => {
      if (upstream === null) {
        log.info('preview proxy: dev server not reachable', { port });
        client.destroy();
        return;
      }
      upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  });
  server.listen(options.port, options.host ?? '0.0.0.0');
  return server;
}
