import { describe, expect, it } from 'vitest';
import { encodeMessage, MessageDecoder, type DecodeError } from './stdio.js';

function collect() {
  const messages: unknown[] = [];
  const errors: DecodeError[] = [];
  const decoder = new MessageDecoder(
    (m) => messages.push(m),
    (e) => errors.push(e),
    1024,
  );
  return { messages, errors, decoder };
}

describe('Native Messaging framing', () => {
  it('round-trips a message', () => {
    const { messages, decoder } = collect();
    decoder.push(encodeMessage({ id: '1', type: 'hello', text: 'héllo ✓' }));
    expect(messages).toEqual([{ id: '1', type: 'hello', text: 'héllo ✓' }]);
  });

  it('prefixes a 4-byte length', () => {
    const buf = encodeMessage({ a: 1 });
    expect(buf.readUInt32LE(0)).toBe(Buffer.byteLength('{"a":1}'));
    expect(buf.subarray(4).toString()).toBe('{"a":1}');
  });

  it('handles messages split across chunks and several per chunk', () => {
    const { messages, decoder } = collect();
    const all = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 }), encodeMessage({ n: 3 })]);
    for (let i = 0; i < all.length; i += 3) decoder.push(all.subarray(i, i + 3));
    expect(messages).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('reports bad JSON and keeps going', () => {
    const { messages, errors, decoder } = collect();
    const bad = Buffer.from('{nope');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length);
    decoder.push(Buffer.concat([header, bad, encodeMessage({ ok: true })]));
    expect(errors[0]?.kind).toBe('bad_json');
    expect(messages).toEqual([{ ok: true }]);
  });

  it('rejects oversized frames', () => {
    const { errors, decoder } = collect();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(5000);
    decoder.push(header);
    expect(errors).toEqual([{ kind: 'too_large', size: 5000 }]);
  });

  it('refuses to encode messages over 1 MB', () => {
    expect(() => encodeMessage({ big: 'x'.repeat(1024 * 1024) })).toThrow(/too large/);
  });
});
