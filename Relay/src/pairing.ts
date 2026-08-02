export const PAIRING_FRAGMENT_PATTERN_SOURCE =
  "^v=1&s=([A-Za-z0-9_-]{43})&fp=([0-9a-f]{64})$";

export function parsePairingFragment(
  raw: string,
): { secret: string; fingerprint: string } | null {
  const match = new RegExp(PAIRING_FRAGMENT_PATTERN_SOURCE).exec(raw);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== match[1]) return null;
  return { secret: match[1], fingerprint: match[2] };
}
