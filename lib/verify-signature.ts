import { createHmac, timingSafeEqual } from 'crypto';

export function verifyRewardfulSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalized = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(normalized, 'utf8');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
