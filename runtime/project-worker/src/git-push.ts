// Reads the ref updates at the start of a git-receive-pack request (smart HTTP), so the Gateway can refuse
// pushes to anything but the work branch. The body is a run of pkt-lines ("<old> <new> <ref>", the first
// one followed by NUL and the client's capabilities), a flush packet ("0000"), then the packfile.

const MAX_COMMANDS_BYTES = 64 * 1024;
const decoder = new TextDecoder();

export type PushCommand = { oldSha: string; newSha: string; ref: string };
export type PushCommands = { commands: PushCommand[]; body: ReadableStream<Uint8Array> };

export class PushParseError extends Error {}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** The ref updates a push asks for, and a stream that replays the whole body unchanged. */
export async function readPushCommands(body: ReadableStream<Uint8Array>): Promise<PushCommands> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let commands: PushCommand[] | null = null;
  while (commands === null) {
    const { done, value } = await reader.read();
    if (done) throw new PushParseError('The push ended before its commands.');
    chunks.push(value);
    length += value.length;
    commands = parseCommands(concat(chunks, length));
    if (commands === null && length > MAX_COMMANDS_BYTES) throw new PushParseError('The push commands are too long.');
  }
  const buffered = concat(chunks, length);
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buffered);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { commands, body: replay };
}

/** The commands before the first flush packet, or null when the flush has not arrived yet. */
export function parseCommands(bytes: Uint8Array): PushCommand[] | null {
  const commands: PushCommand[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const size = Number.parseInt(decoder.decode(bytes.subarray(offset, offset + 4)), 16);
    if (Number.isNaN(size) || (size > 0 && size < 4)) throw new PushParseError('Malformed push.');
    if (size === 0) return commands;
    if (offset + size > bytes.length) return null;
    const line =
      decoder
        .decode(bytes.subarray(offset + 4, offset + size))
        .split('\0')[0]
        ?.replace(/\n$/, '') ?? '';
    offset += size;
    if (line.startsWith('shallow ')) continue;
    const match = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (\S+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      throw new PushParseError('Unsupported push command.');
    }
    commands.push({ oldSha: match[1], newSha: match[2], ref: match[3] });
  }
  return null;
}
