import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src';

const SECRET = 'whsec-0123456789abcdef';
const PAYLOAD = JSON.stringify({
  action: 'opened',
  number: 7,
  pull_request: { title: 'Cabeçalho azul ✓', head: { ref: 'homolog' } },
  repository: { full_name: 'acme/site' },
});

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  it("accepts GitHub's documented test vector", async () => {
    expect(
      await verifyWebhookSignature(
        'Hello, World!',
        'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
        "It's a Secret to Everybody",
      ),
    ).toBe(true);
  });

  it('accepts the signature of a payload with non-ASCII text', async () => {
    expect(await verifyWebhookSignature(PAYLOAD, sign(PAYLOAD, SECRET), SECRET)).toBe(true);
    expect(
      await verifyWebhookSignature(PAYLOAD, sign(PAYLOAD, SECRET).toUpperCase().replace('SHA256=', 'sha256='), SECRET),
    ).toBe(true);
  });

  it('rejects a modified body or another secret', async () => {
    const signature = sign(PAYLOAD, SECRET);

    expect(await verifyWebhookSignature(PAYLOAD.replace('opened', 'closed'), signature, SECRET)).toBe(false);
    expect(await verifyWebhookSignature(`${PAYLOAD}\n`, signature, SECRET)).toBe(false);
    expect(await verifyWebhookSignature(PAYLOAD, signature, `${SECRET}x`)).toBe(false);
  });

  it('rejects missing and malformed signatures', async () => {
    const hex = sign(PAYLOAD, SECRET).slice('sha256='.length);

    for (const header of [
      null,
      '',
      'sha256=',
      hex,
      `sha1=${createHmac('sha1', SECRET).update(PAYLOAD).digest('hex')}`,
      `sha256=${hex.slice(0, 62)}`,
      `sha256=${hex}00`,
      `sha256=${'z'.repeat(64)}`,
    ]) {
      expect(await verifyWebhookSignature(PAYLOAD, header, SECRET)).toBe(false);
    }
  });

  it('never verifies with an empty secret', async () => {
    expect(await verifyWebhookSignature(PAYLOAD, sign(PAYLOAD, ''), '')).toBe(false);
  });
});
