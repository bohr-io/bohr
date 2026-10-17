import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '../src/base64';

describe('base64 helpers', () => {
  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);

    const encoded = encodeBase64(all);

    expect(encoded).toBe(Buffer.from(all).toString('base64'));
    expect(decodeBase64(encoded)).toEqual(all);
  });

  it('encodes buffers larger than one chunk', () => {
    const large = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31) % 256);

    expect(encodeBase64(large)).toBe(Buffer.from(large).toString('base64'));
  });

  it('encodes an empty buffer', () => {
    expect(encodeBase64(new Uint8Array(0))).toBe('');
    expect(decodeBase64('')).toEqual(new Uint8Array(0));
  });

  it('decodes URL-safe input without padding and with line breaks', () => {
    const expected = new Uint8Array([0xfb, 0xff, 0xbf, 0x41]);

    expect(decodeBase64('-_-_QQ')).toEqual(expected);
    expect(decodeBase64('+/+/\nQQ==')).toEqual(expected);
  });
});
