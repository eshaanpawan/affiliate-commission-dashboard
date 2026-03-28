import { createHmac } from 'crypto';

export function verifyRewardfulSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!secret) return true; // skip verification if secret not set (dev mode)
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}
