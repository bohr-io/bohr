// workerd's node:http does not implement ServerResponse.assignSocket ("The assignSocket method is not
// implemented"), which serverless-http (an Express app behind a Lambda handler) calls with its own in-memory
// socket for every request. The response keeps that socket instead, which is all serverless-http needs: it reads
// what the app writes through the socket it gave. Elsewhere (Node, or a workerd that implements it) nothing changes.
import type { ServerResponse } from 'node:http';

type AssignSocket = ServerResponse['assignSocket'];

/** Wraps assignSocket on `prototype` once; the original runs first, the fallback only when it is not implemented. */
export function tolerateAssignSocket(prototype: { assignSocket: AssignSocket }): void {
  const native = prototype.assignSocket as AssignSocket & { bohrTolerant?: true };
  if (native.bohrTolerant) return;
  const tolerant = function (this: ServerResponse, socket: Parameters<AssignSocket>[0]) {
    try {
      native.call(this, socket);
    } catch (error) {
      if (!/not implemented/i.test(error instanceof Error ? error.message : String(error))) throw error;
      (socket as unknown as { _httpMessage?: unknown })._httpMessage = this;
      try {
        (this as unknown as { socket: unknown }).socket = socket;
      } catch {
        // A read-only socket property: the "socket" event below still hands it over
      }
      this.emit('socket', socket);
    }
  } as AssignSocket & { bohrTolerant?: true };
  tolerant.bohrTolerant = true;
  prototype.assignSocket = tolerant;
}

let ready: Promise<void> | null = null;

/** Applies tolerateAssignSocket to node:http's ServerResponse, once; without node:http there is nothing to do. */
export function prepareNodeHttp(): Promise<void> {
  ready ??= import('node:http').then(
    ({ ServerResponse }) => tolerateAssignSocket(ServerResponse.prototype),
    () => {},
  );
  return ready;
}
