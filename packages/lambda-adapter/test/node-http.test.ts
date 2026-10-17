import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { tolerateAssignSocket } from '../src/node-http';

class Response extends EventEmitter {
  socket: unknown = null;
}

describe('ServerResponse.assignSocket on workerd', () => {
  it('keeps the in-memory socket when the runtime does not implement assignSocket', () => {
    const prototype = Response.prototype as unknown as { assignSocket: (socket: unknown) => void };
    prototype.assignSocket = () => {
      throw new Error('The assignSocket method is not implemented');
    };
    tolerateAssignSocket(prototype as never);
    tolerateAssignSocket(prototype as never);
    const response = new Response();
    const socket = { write: () => true };
    const seen: unknown[] = [];
    response.on('socket', (given) => seen.push(given));
    (response as unknown as { assignSocket: (socket: unknown) => void }).assignSocket(socket);
    expect(response.socket).toBe(socket);
    expect(seen).toEqual([socket]);
    expect((socket as { _httpMessage?: unknown })._httpMessage).toBe(response);
  });

  it("uses the runtime's own assignSocket when it works, and passes other errors on", () => {
    const calls: unknown[] = [];
    const prototype = {
      assignSocket(socket: unknown) {
        if (socket === 'bad') throw new Error('socket already assigned');
        calls.push(socket);
      },
    };
    tolerateAssignSocket(prototype as never);
    prototype.assignSocket('good');
    expect(calls).toEqual(['good']);
    expect(() => prototype.assignSocket('bad')).toThrow('socket already assigned');
  });
});
