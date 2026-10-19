import { endianness } from 'node:os';
import { MAX_EXTENSION_MESSAGE_BYTES, MAX_HOST_MESSAGE_BYTES } from '@ytdl/shared';

/**
 * Chrome Native Messaging framing: each message is a 32-bit length in native byte order
 * followed by that many bytes of UTF-8 JSON.
 */
const LITTLE_ENDIAN = endianness() === 'LE';

export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_HOST_MESSAGE_BYTES) {
    throw new Error(`Outgoing message too large (${body.length} bytes)`);
  }
  const header = Buffer.alloc(4);
  if (LITTLE_ENDIAN) header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export type DecodeError = { kind: 'too_large'; size: number } | { kind: 'bad_json'; error: unknown };

/**
 * Incremental decoder: feed it arbitrary chunks from stdin, get whole parsed messages back.
 * An oversized frame is fatal (we can't resync), so the caller should exit on 'too_large'.
 */
export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onError: (error: DecodeError) => void,
    private readonly maxBytes = MAX_EXTENSION_MESSAGE_BYTES,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = LITTLE_ENDIAN ? this.buffer.readUInt32LE(0) : this.buffer.readUInt32BE(0);
      if (size > this.maxBytes) {
        this.buffer = Buffer.alloc(0);
        this.onError({ kind: 'too_large', size });
        return;
      }
      if (this.buffer.length < 4 + size) return;
      const body = this.buffer.subarray(4, 4 + size).toString('utf8');
      this.buffer = this.buffer.subarray(4 + size);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        this.onError({ kind: 'bad_json', error });
        continue;
      }
      this.onMessage(parsed);
    }
  }
}
