import { randomBytes } from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 6-character room-style code (no ambiguous 0/O/1/I). */
export function generateJoinCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]!;
  }
  return out;
}

export function normalizeJoinInput(raw: string): { kind: 'uuid' | 'code'; value: string } {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(compact)) {
    const uuid = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
    return { kind: 'uuid', value: uuid };
  }
  const code = trimmed.replace(/\s+/g, '').toUpperCase();
  return { kind: 'code', value: code.slice(0, 8) };
}
